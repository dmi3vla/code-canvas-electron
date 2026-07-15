/**
 * Suggestion agent — topics from recent file activity.
 * Ported from windsurf-codemap (no vscode).
 */

const { generateText } = require('ai');
const { getOpenAIClient, getModelName, isConfigured, getLanguage } = require('./baseClient');
const { loadPrompt } = require('./prompts');

/**
 * @param {string[]} recentFiles
 * @returns {Promise<Array<{ id: string, text: string, sub?: string, startingPoints?: string[] }>>}
 */
async function generateSuggestions(recentFiles) {
  if (!isConfigured()) return [];
  if (!Array.isArray(recentFiles) || recentFiles.length < 2) return [];

  const client = getOpenAIClient();
  const userPrompt = loadPrompt('suggestion', 'user', {
    recent_files: recentFiles.map((f, i) => `${i + 1}. ${f}`).join('\n'),
    language: getLanguage()
  });

  try {
    const result = await generateText({
      model: client(getModelName()),
      prompt: userPrompt,
      maxTokens: 500
    });

    const jsonMatch = result.text && result.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const suggestions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(suggestions)) return [];

    return suggestions.slice(0, 3).map((s, i) => ({
      id: `suggestion-${i}`,
      text: s.title || s.text || '',
      sub: s.subtitle || s.sub || '',
      startingPoints: s.starting_points || s.startingPoints || [],
      timestamp: Date.now()
    })).filter((s) => s.text);
  } catch (error) {
    console.error('[suggestionAgent]', error instanceof Error ? error.message : error);
    return [];
  }
}

module.exports = { generateSuggestions };
