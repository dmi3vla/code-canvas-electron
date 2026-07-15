/**
 * Mermaid post-processing: rotating placeholder fills on subgraphs.
 * Ported from windsurf-codemap (no TypeScript / vscode).
 */

const SUBGRAPH_FILL_PLACEHOLDER_CYCLE = [
  '#a5d8ff',
  '#ffd8a8',
  '#d0bfff',
  '#b2f2bb',
  '#fcc2d7',
  '#ffec99',
  '#99e9f2',
  '#eebefa'
];

function normalizeLineEndings(input) {
  return String(input || '').replace(/\r\n/g, '\n');
}

function extractSubgraphIds(diagram) {
  const ids = [];
  const seen = new Set();
  const lines = normalizeLineEndings(diagram).split('\n');
  const re = /^\s*subgraph\s+([^\s\[]+)\s*(?:\[[^\]]*\]|\["[^"]*"\])?\s*$/i;

  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const raw = (m[1] || '').trim();
    const id = raw.replace(/^"(.+)"$/, '$1').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function stripFillFromLine(line, keyword) {
  const pattern =
    keyword === 'style'
      ? /^\s*style\s+([^\s]+)\s+(.+)\s*$/i
      : /^\s*classDef\s+([^\s]+)\s+(.+)\s*$/i;

  const m = line.match(pattern);
  if (!m) return line;

  const name = m[1];
  const styles = m[2];
  const parts = styles
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => !/^fill\s*:/i.test(p) && !/^fill-opacity\s*:/i.test(p));
  if (kept.length === 0) return null;
  return `${keyword} ${name} ${kept.join(',')}`;
}

/**
 * Apply rotating fills to all subgraphs and return updated Mermaid code.
 */
function colorizeMermaidDiagram(diagram) {
  const normalized = normalizeLineEndings(diagram).trim();
  if (!normalized) return normalized;

  const subgraphIds = extractSubgraphIds(normalized);
  const sanitizedLines = [];

  for (const line of normalized.split('\n')) {
    let processed = stripFillFromLine(line, 'style');
    if (processed === null) {
      if (/^\s*style\s+/i.test(line)) continue;
      processed = line;
    }
    processed = stripFillFromLine(processed, 'classDef');
    if (processed === null) {
      if (/^\s*classDef\s+/i.test(line)) continue;
      processed = line;
    }
    sanitizedLines.push(processed);
  }

  const sanitized = sanitizedLines.join('\n').trim();
  if (subgraphIds.length === 0) return sanitized;

  const styleLines = subgraphIds.map((id, idx) => {
    const color = SUBGRAPH_FILL_PLACEHOLDER_CYCLE[idx % SUBGRAPH_FILL_PLACEHOLDER_CYCLE.length];
    return `style ${id} fill:${color}`;
  });

  return `${sanitized}\n\n${styleLines.join('\n')}`.trim();
}

module.exports = {
  SUBGRAPH_FILL_PLACEHOLDER_CYCLE,
  colorizeMermaidDiagram,
  extractSubgraphIds
};
