// src/builder/codemap-adapter.js
//
// Pure transform: windsurf-style codemap JSON → .canvas nodes/edges.
// No DOM, no fs, no Electron.

const ROW_HEIGHT = 260;
const COL_WIDTH = 360;
const NODE_WIDTH = 320;
const NODE_HEIGHT = 210;

/**
 * Map mermaid node ids (i1, f2) → location ids (1a, 2b) from labels:
 *   i1["1a: Process start"]
 */
function buildMermaidIdToLocationId(mermaidText) {
  const map = new Map();
  if (!mermaidText) return map;
  const re = /(\w+)\s*\[\s*["'](\d+[a-zA-Z])\s*:/g;
  let match;
  while ((match = re.exec(mermaidText)) !== null) {
    map.set(match[1], match[2].toLowerCase());
  }
  return map;
}

function resolveLocationRef(token, idMap) {
  if (!token) return token;
  if (idMap.has(token)) return idMap.get(token);
  // Already a location id like 1a / 2b
  if (/^\d+[a-z]$/i.test(token)) return token.toLowerCase();
  return token;
}

/**
 * Extract edges from mermaid flowchart text.
 * Supports: -->, ---, -.->, ==>, with optional |label|.
 * from/to are resolved to location ids when possible.
 */
function extractMermaidEdges(mermaidText) {
  if (!mermaidText) return [];

  const idMap = buildMermaidIdToLocationId(mermaidText);
  const edges = [];
  const seen = new Set();

  // A -->|label| B  |  A --> B  |  A -.->|label| B  |  A -.-> B  |  A ==> B
  const pattern = /(\w+)\s*(?:-->|---|-\.->|==>)\s*(?:\|([^|]*)\|\s*)?(\w+)/g;
  let match;
  while ((match = pattern.exec(mermaidText)) !== null) {
    const from = resolveLocationRef(match[1], idMap);
    const to = resolveLocationRef(match[3], idMap);
    let label = (match[2] || '').trim();
    // strip wrapping quotes from mermaid edge labels: |"loads"| or |\"loads\"|
    label = label.replace(/^["']|["']$/g, '').replace(/\\"/g, '"');
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, label });
  }

  return edges;
}

/**
 * Each location → code node; chain edges within trace; cross edges from mermaid.
 */
function codemapToCanvas(codemap, options = {}) {
  if (!codemap || !Array.isArray(codemap.traces)) {
    throw new Error('codemapToCanvas: ожидается объект с полем traces[]');
  }

  const nodes = [];
  const edges = [];
  const locationIdToNodeId = new Map();

  codemap.traces.forEach((trace, traceIndex) => {
    const locations = trace.locations || [];

    locations.forEach((location, locIndex) => {
      const locationId = String(location.id || `${trace.id}${String.fromCharCode(97 + locIndex)}`).toLowerCase();
      const nodeId = `node-${locationId}`;
      locationIdToNodeId.set(locationId, nodeId);
      // also allow original id casing
      if (location.id) locationIdToNodeId.set(String(location.id), nodeId);

      const fileName = location.path ? location.path.split(/[\\/]/).pop() : '';
      nodes.push({
        id: nodeId,
        type: 'code',
        title: location.title || locationId,
        subtitle: `${trace.title || `Trace ${trace.id}`} · ${fileName}:${location.lineNumber ?? ''}`,
        path: options.rewritePath ? options.rewritePath(location.path) : location.path,
        anchorLine: location.lineNumber ?? null,
        locationId,
        traceId: String(trace.id ?? traceIndex + 1),
        language: guessLanguage(location.path),
        content: [location.lineContent, location.description].filter(Boolean).join('\n'),
        x: locIndex * COL_WIDTH,
        y: traceIndex * ROW_HEIGHT,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      });

      if (locIndex > 0) {
        const prevLoc = locations[locIndex - 1];
        const prevId = locationIdToNodeId.get(String(prevLoc.id).toLowerCase())
          || locationIdToNodeId.get(String(prevLoc.id));
        edges.push({
          id: `edge-chain-${prevLoc.id}-${location.id}`,
          fromNode: prevId,
          fromSide: 'right',
          toNode: nodeId,
          toSide: 'left',
          label: 'flow'
        });
      }
    });
  });

  const crossTraceEdges = extractMermaidEdges(codemap.mermaidDiagram);
  for (const edge of crossTraceEdges) {
    const fromKey = String(edge.from).toLowerCase();
    const toKey = String(edge.to).toLowerCase();
    const fromNode = locationIdToNodeId.get(fromKey) || locationIdToNodeId.get(edge.from);
    const toNode = locationIdToNodeId.get(toKey) || locationIdToNodeId.get(edge.to);
    if (!fromNode || !toNode) continue;
    edges.push({
      id: `edge-cross-${edge.from}-${edge.to}`,
      fromNode,
      fromSide: 'bottom',
      toNode,
      toSide: 'top',
      label: edge.label || ''
    });
  }

  return {
    version: '1.0',
    metadata: {
      name: codemap.title || codemap.metadata?.name || 'codemap',
      sourceFolder: options.sourceFolder || null,
      query: codemap.query || options.query || null,
      generatedAt: options.generatedAt || new Date().toISOString(),
      generatedFromCodemapId: codemap.id || codemap.stableId || null,
      cacheVersion: 1
    },
    viewport: { x: 0, y: 0, scale: 1 },
    nodes,
    edges
  };
}

function guessLanguage(filePath) {
  if (!filePath) return '';
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map = {
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    md: 'markdown',
    json: 'json'
  };
  return map[ext] || ext;
}

module.exports = {
  codemapToCanvas,
  extractMermaidEdges,
  buildMermaidIdToLocationId
};
