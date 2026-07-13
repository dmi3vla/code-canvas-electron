const fs = require('fs');
const path = require('path');

const templateCache = new Map();

function getPromptsDir() {
  // Prefer project-root/prompts (dev + packaged relative to main)
  const candidates = [
    path.join(__dirname, '..', '..', 'prompts'),
    path.join(process.cwd(), 'prompts'),
    path.join(__dirname, 'prompts')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`Prompts directory not found. Tried: ${candidates.join(', ')}`);
}

function loadCachedFile(cacheKey, filePath, stripMarkdownHeader = true) {
  if (templateCache.has(cacheKey)) return templateCache.get(cacheKey);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Template file not found: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf-8');
  if (stripMarkdownHeader) {
    content = content.replace(/^#[^\n]*\n+/, '').trim();
  } else {
    content = content.trim();
  }

  templateCache.set(cacheKey, content);
  return content;
}

function substituteVariables(template, variables) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, varName) => {
    if (varName in variables) return variables[varName];
    console.warn(`Template variable not provided: ${varName}`);
    return match;
  });
}

function loadPrompt(type, role, variables = {}) {
  const promptsDir = getPromptsDir();
  const filePath = path.join(promptsDir, type, `${role}.md`);
  const template = loadCachedFile(`${type}/${role}`, filePath);
  return substituteVariables(template, variables);
}

function loadStagePrompt(stageNumber, variables = {}) {
  if (stageNumber < 1 || stageNumber > 5) {
    throw new Error(`Invalid stage number: ${stageNumber}`);
  }
  const promptsDir = getPromptsDir();
  const filePath = path.join(promptsDir, 'smart', `stage${stageNumber}.md`);
  const template = loadCachedFile(`smart/stage${stageNumber}`, filePath);
  return substituteVariables(template, variables);
}

function loadMermaidPrompt(variables = {}) {
  const promptsDir = getPromptsDir();
  const filePath = path.join(promptsDir, 'smart', 'mermaid.md');
  const template = loadCachedFile('smart/mermaid', filePath);
  return substituteVariables(template, variables);
}

function loadTraceStagePrompt(stageNumber, traceId, variables = {}) {
  if (stageNumber < 3 || stageNumber > 5) {
    throw new Error(`Invalid stage number for trace processing: ${stageNumber}`);
  }
  return loadStagePrompt(stageNumber, { ...variables, trace_id: traceId });
}

function loadMaximizeParallelToolCallsAddon() {
  const promptsDir = getPromptsDir();
  const filePath = path.join(promptsDir, 'fast', 'maximize_parallel_tool_calls.md');
  return loadCachedFile('fast/maximize_parallel_tool_calls', filePath, false);
}

module.exports = {
  loadPrompt,
  loadStagePrompt,
  loadMermaidPrompt,
  loadTraceStagePrompt,
  loadMaximizeParallelToolCallsAddon,
  getPromptsDir
};
