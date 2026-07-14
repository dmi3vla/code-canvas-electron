/**
 * Multi-stage codemap agent (ported from windsurf-codemap, no vscode).
 *
 * Stage 1 Research → Stage 2 CODEMAP structure
 *   ├─ Stage 6 Mermaid (parallel)
 *   └─ per trace Stages 3–5 (tree, decorations, guide)
 */

const { generateText } = require('ai');
const { getOpenAIClient, getModelName, isConfigured, getLanguage } = require('./baseClient');
const {
  loadPrompt,
  loadStagePrompt,
  loadTraceStagePrompt,
  loadMermaidPrompt,
  loadMaximizeParallelToolCallsAddon
} = require('./prompts');
const { allTools } = require('./tools');
const {
  generateWorkspaceLayout,
  extractCodemapFromResponse,
  extractTraceDiagram,
  extractTraceGuide,
  extractMermaidDiagram,
  isResearchComplete,
  formatCurrentDate,
  getUserOs
} = require('./utils');

function log(...args) {
  console.log('[codemapAgent]', ...args);
}

function buildSystemPrompt(mode, variables) {
  const base = loadPrompt('smart', 'system', variables);
  if (mode === 'fast') {
    return `${base}\n\n${loadMaximizeParallelToolCallsAddon()}`;
  }
  return base;
}

async function processTraceStages(traceId, systemPrompt, baseMessages, currentDate, language, callbacks = {}) {
  const client = getOpenAIClient();
  const messages = [...baseMessages];
  let diagram;
  let guide;

  try {
    callbacks.onTraceProcessing?.(traceId, 3, 'start');
    messages.push({
      role: 'user',
      content: loadTraceStagePrompt(3, traceId, { current_date: currentDate, language })
    });
    const stage3 = await generateText({
      model: client(getModelName()),
      system: systemPrompt,
      messages
    });
    if (stage3.text) messages.push({ role: 'assistant', content: stage3.text });
    callbacks.onTraceProcessing?.(traceId, 3, 'complete');

    callbacks.onTraceProcessing?.(traceId, 4, 'start');
    messages.push({
      role: 'user',
      content: loadTraceStagePrompt(4, traceId, { current_date: currentDate, language })
    });
    const stage4 = await generateText({
      model: client(getModelName()),
      system: systemPrompt,
      messages
    });
    if (stage4.text) {
      messages.push({ role: 'assistant', content: stage4.text });
      diagram = extractTraceDiagram(stage4.text) || undefined;
    }
    callbacks.onTraceProcessing?.(traceId, 4, 'complete');

    callbacks.onTraceProcessing?.(traceId, 5, 'start');
    messages.push({
      role: 'user',
      content: loadTraceStagePrompt(5, traceId, { current_date: currentDate, language })
    });
    const stage5 = await generateText({
      model: client(getModelName()),
      system: systemPrompt,
      messages
    });
    if (stage5.text) {
      guide = extractTraceGuide(stage5.text) || undefined;
    }
    callbacks.onTraceProcessing?.(traceId, 5, 'complete');

    return { traceId, diagram, guide };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Trace ${traceId} error:`, errorMsg);
    return { traceId, error: errorMsg };
  }
}

async function processMermaidDiagram(systemPrompt, baseMessages, currentDate, language, callbacks = {}) {
  const client = getOpenAIClient();
  const messages = [...baseMessages];
  try {
    callbacks.onPhaseChange?.('Mermaid Diagram', 6);
    messages.push({
      role: 'user',
      content: loadMermaidPrompt({ current_date: currentDate, language })
    });
    const result = await generateText({
      model: client(getModelName()),
      system: systemPrompt,
      messages
    });
    if (!result.text) return { error: 'No text in mermaid response' };
    const diagram = extractMermaidDiagram(result.text) || undefined;
    return { diagram };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {string} query
 * @param {string} workspaceRoot
 * @param {'smart'|'fast'} mode
 * @param {object} callbacks
 */
async function generateCodemap(query, workspaceRoot, mode = 'smart', callbacks = {}) {
  log(`START mode=${mode} workspace=${workspaceRoot}`);
  log(`query=${query}`);

  if (!isConfigured()) {
    throw new Error('OpenAI API key not configured (~/.cometix/codemap/settings.json)');
  }

  const client = getOpenAIClient();
  const workspaceLayout = generateWorkspaceLayout(workspaceRoot);
  const workspaceUri = workspaceRoot.replace(/\\/g, '\\\\');
  const corpusName = workspaceRoot.replace(/\\/g, '/');
  const currentDate = formatCurrentDate();
  const language = getLanguage();

  const systemPrompt = buildSystemPrompt(mode, {
    workspace_root: workspaceRoot,
    workspace_layout: workspaceLayout,
    workspace_uri: workspaceUri,
    corpus_name: corpusName,
    user_os: getUserOs(),
    language
  });

  const messages = [];
  let resultCodemap = null;
  let mermaidPromise = null;

  callbacks.onMessage?.('system', `Starting ${mode} codemap generation...`);

  try {
    // Stage 1 — ONE multi-step generateText with maxSteps.
    // Bug before: outer while() never appended tool results → model re-researched
    // from the same user prompt every iteration (20× API "DDoS").
    callbacks.onPhaseChange?.('Research', 1);
    messages.push({
      role: 'user',
      content: loadStagePrompt(1, { query, current_date: currentDate, language })
    });

    const RESEARCH_MAX_STEPS = 12;
    let researchStep = 0;
    let researchStoppedEarly = false;

    log(`Research start (maxSteps=${RESEARCH_MAX_STEPS})`);
    const researchResult = await generateText({
      model: client(getModelName()),
      system: systemPrompt,
      messages,
      tools: allTools,
      // Multi-step agentic loop: tool calls + results stay in one trajectory.
      maxSteps: RESEARCH_MAX_STEPS,
      onStepFinish: (step) => {
        researchStep += 1;
        const nTools = step.toolCalls?.length || 0;
        log(
          `Research step ${researchStep}/${RESEARCH_MAX_STEPS}` +
            ` tools=${nTools}` +
            (step.text ? ` text=${String(step.text).slice(0, 80).replace(/\s+/g, ' ')}` : '')
        );

        if (step.text) {
          callbacks.onMessage?.('assistant', step.text);
          if (isResearchComplete(step.text)) {
            researchStoppedEarly = true;
            log('Research complete phrase detected');
          }
        }
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            const toolResult = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
            callbacks.onToolCall?.(
              tc.toolName,
              JSON.stringify(tc.args ?? tc.input ?? {}, null, 2),
              toolResult ? String(toolResult.result ?? toolResult.output ?? '').slice(0, 500) : ''
            );
          }
        }
      }
    });

    // Keep full tool transcript for Stage 2+ (assistant + tool messages)
    if (researchResult.response?.messages?.length) {
      messages.push(...researchResult.response.messages);
    } else if (researchResult.text) {
      messages.push({ role: 'assistant', content: researchResult.text });
    }

    log(
      `Research done steps=${researchStep}` +
        ` earlyStop=${researchStoppedEarly}` +
        ` finalText=${Boolean(researchResult.text)}` +
        ` histMsgs=${messages.length}`
    );

    // Stage 2
    callbacks.onPhaseChange?.('Codemap Generation', 2);
    messages.push({
      role: 'user',
      content: loadStagePrompt(2, { query, current_date: currentDate, language })
    });

    const stage2Result = await generateText({
      model: client(getModelName()),
      system: systemPrompt,
      messages,
      // no tools — structure only
      maxSteps: 1
    });

    if (stage2Result.text) {
      messages.push({ role: 'assistant', content: stage2Result.text });
      callbacks.onMessage?.('assistant', stage2Result.text.slice(0, 2000));

      const extracted = extractCodemapFromResponse(stage2Result.text);
      if (extracted) {
        resultCodemap = {
          ...extracted,
          query,
          workspacePath: workspaceRoot,
          mode
        };
        callbacks.onCodemapUpdate?.(resultCodemap);

        callbacks.onStage12ContextReady?.({
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          query,
          mode,
          workspaceRoot,
          currentDate,
          language,
          systemPrompt,
          baseMessages: messages.map((m) => ({
            role: m.role,
            content: String(m.content)
          }))
        });

        // Mermaid in parallel: as soon as it lands, push layout update (subgraph areas)
        mermaidPromise = processMermaidDiagram(
          systemPrompt,
          messages,
          currentDate,
          language,
          callbacks
        ).then((result) => {
          if (result?.diagram && resultCodemap) {
            resultCodemap.mermaidDiagram = result.diagram;
            callbacks.onCodemapUpdate?.(resultCodemap);
            log('Mermaid ready — area layout update emitted');
          } else if (result?.error) {
            callbacks.onMessage?.('error', `Mermaid: ${result.error}`);
          }
          return result;
        });
      } else {
        log('FAILED to extract codemap from stage 2');
        throw new Error('Failed to extract CODEMAP JSON from model response');
      }
    } else {
      throw new Error('Stage 2 returned empty response');
    }

    // Stages 3–5 + 6
    if (resultCodemap.traces?.length) {
      callbacks.onPhaseChange?.('Trace Processing', 3);
      const tracePromises = resultCodemap.traces.map((trace) =>
        processTraceStages(trace.id, systemPrompt, messages, currentDate, language, callbacks)
      );

      const [traceResults, mermaidResult] = await Promise.all([
        Promise.all(tracePromises),
        mermaidPromise || Promise.resolve(null)
      ]);

      for (const result of traceResults) {
        if (result.error) {
          callbacks.onMessage?.('error', `Trace ${result.traceId}: ${result.error}`);
          continue;
        }
        const trace = resultCodemap.traces.find((t) => t.id === result.traceId);
        if (!trace) continue;
        if (result.diagram) trace.traceTextDiagram = result.diagram;
        if (result.guide) trace.traceGuide = result.guide;
      }

      // mermaid already applied in .then above when ready; ensure still attached
      if (mermaidResult?.diagram && !resultCodemap.mermaidDiagram) {
        resultCodemap.mermaidDiagram = mermaidResult.diagram;
      }

      // Final structural update (guides/diagrams on traces + mermaid areas)
      callbacks.onCodemapUpdate?.(resultCodemap);
    }

    callbacks.onPhaseChange?.('Complete', 7);
    callbacks.onMessage?.('system', 'Codemap generation complete.');
    log('COMPLETE', resultCodemap.title, 'traces=', resultCodemap.traces?.length);
    return resultCodemap;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    callbacks.onMessage?.('error', errorMsg);
    throw error;
  }
}

module.exports = { generateCodemap };
