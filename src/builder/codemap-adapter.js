// src/builder/codemap-adapter.js
//
// Pure transform: windsurf-style codemap JSON → .canvas nodes/edges.
// Groups nodes into colored area regions (one per trace), like Mermaid subgraphs.

const COL_WIDTH = 360;
const NODE_WIDTH = 320;
const NODE_HEIGHT = 210;
const AREA_PAD_X = 40;
const AREA_PAD_Y = 28;
const AREA_TITLE_H = 44;
const AREA_GAP_Y = 72;
const AREA_GAP_X = 48;

/**
 * Windsurf-like rainbow cycle for area fills (dark UI, translucent).
 * Matches mermaidColorize / mermaidPlaceholders order.
 */
const TRACE_AREA_PALETTE = [
  { accent: '#a5d8ff', fill: 'rgba(165, 216, 255, 0.14)', border: 'rgba(165, 216, 255, 0.42)' },
  { accent: '#ffd8a8', fill: 'rgba(255, 216, 168, 0.14)', border: 'rgba(255, 216, 168, 0.42)' },
  { accent: '#d0bfff', fill: 'rgba(208, 191, 255, 0.14)', border: 'rgba(208, 191, 255, 0.42)' },
  { accent: '#b2f2bb', fill: 'rgba(178, 242, 187, 0.14)', border: 'rgba(178, 242, 187, 0.42)' },
  { accent: '#fcc2d7', fill: 'rgba(252, 194, 215, 0.14)', border: 'rgba(252, 194, 215, 0.42)' },
  { accent: '#ffec99', fill: 'rgba(255, 236, 153, 0.14)', border: 'rgba(255, 236, 153, 0.42)' },
  { accent: '#99e9f2', fill: 'rgba(153, 233, 242, 0.14)', border: 'rgba(153, 233, 242, 0.42)' },
  { accent: '#eebefa', fill: 'rgba(238, 190, 250, 0.14)', border: 'rgba(238, 190, 250, 0.42)' }
];

function paletteForIndex(index) {
  return TRACE_AREA_PALETTE[index % TRACE_AREA_PALETTE.length];
}

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
  if (/^\d+[a-z]$/i.test(token)) return token.toLowerCase();
  return token;
}

/**
 * Extract edges from mermaid flowchart text.
 */
function extractMermaidEdges(mermaidText) {
  if (!mermaidText) return [];

  const idMap = buildMermaidIdToLocationId(mermaidText);
  const edges = [];
  const seen = new Set();

  const pattern = /(\w+)\s*(?:-->|---|-\.->|==>)\s*(?:\|([^|]*)\|\s*)?(\w+)/g;
  let match;
  while ((match = pattern.exec(mermaidText)) !== null) {
    const from = resolveLocationRef(match[1], idMap);
    const to = resolveLocationRef(match[3], idMap);
    let label = (match[2] || '').trim();
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
 * Parse mermaid subgraphs: { id, label, locationIds[] }
 * Used only for nicer area titles when available.
 */
function extractMermaidSubgraphs(mermaidText) {
  if (!mermaidText) return [];
  const idMap = buildMermaidIdToLocationId(mermaidText);
  const subgraphs = [];
  const lines = mermaidText.replace(/\r\n/g, '\n').split('\n');
  let current = null;

  for (const line of lines) {
    const start = line.match(/^\s*subgraph\s+([^\s\[]+)\s*(?:\[\s*"?([^\]"]+)"?\s*\]|\["([^"]+)"\])?\s*$/i);
    if (start) {
      const rawId = start[1].replace(/^["']|["']$/g, '');
      const label = (start[2] || start[3] || rawId).trim();
      current = { id: rawId, label, locationIds: [] };
      subgraphs.push(current);
      continue;
    }
    if (/^\s*end\s*$/i.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    // node defs inside subgraph: i1["1a: ..."] or bare location ids
    const nodeDef = line.match(/(\w+)\s*\[\s*["']/);
    if (nodeDef) {
      const loc = idMap.get(nodeDef[1]) || null;
      if (loc && !current.locationIds.includes(loc)) current.locationIds.push(loc);
    }
  }
  return subgraphs;
}

/**
 * Each trace → colored area group + location code nodes inside it.
 * Layout: vertical stack of areas (Windsurf hub regions), locations left→right inside area.
 */
function codemapToCanvas(codemap, options = {}) {
  if (!codemap || !Array.isArray(codemap.traces)) {
    throw new Error('codemapToCanvas: ожидается объект с полем traces[]');
  }

  const nodes = [];
  const edges = [];
  const locationIdToNodeId = new Map();
  let cursorY = 0;

  codemap.traces.forEach((trace, traceIndex) => {
    const locations = trace.locations || [];
    if (locations.length === 0) return;

    const palette = paletteForIndex(traceIndex);
    const traceId = String(trace.id ?? traceIndex + 1);
    const areaId = `area-trace-${traceId}`;

    const contentWidth = Math.max(1, locations.length) * COL_WIDTH - (COL_WIDTH - NODE_WIDTH);
    const areaWidth = contentWidth + AREA_PAD_X * 2;
    const areaHeight = AREA_TITLE_H + AREA_PAD_Y * 2 + NODE_HEIGHT;
    const areaX = 0;
    const areaY = cursorY;

    nodes.push({
      id: areaId,
      type: 'group',
      title: `${traceId}. ${trace.title || `Trace ${traceId}`}`,
      subtitle: trace.description || '',
      content: trace.description || '',
      x: areaX,
      y: areaY,
      width: areaWidth,
      height: areaHeight,
      traceId,
      color: palette.accent,
      fill: palette.fill,
      border: palette.border,
      zIndex: 0
    });

    locations.forEach((location, locIndex) => {
      const locationId = String(
        location.id || `${trace.id}${String.fromCharCode(97 + locIndex)}`
      ).toLowerCase();
      const nodeId = `node-${locationId}`;
      locationIdToNodeId.set(locationId, nodeId);
      if (location.id) locationIdToNodeId.set(String(location.id), nodeId);

      const fileName = location.path ? location.path.split(/[\\/]/).pop() : '';
      nodes.push({
        id: nodeId,
        type: 'code',
        title: location.title || locationId,
        subtitle: `${fileName}:${location.lineNumber ?? ''}`,
        path: options.rewritePath ? options.rewritePath(location.path) : location.path,
        anchorLine: location.lineNumber ?? null,
        locationId,
        traceId,
        color: palette.accent,
        language: guessLanguage(location.path),
        content: [location.lineContent, location.description].filter(Boolean).join('\n'),
        x: areaX + AREA_PAD_X + locIndex * COL_WIDTH,
        y: areaY + AREA_TITLE_H + AREA_PAD_Y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        zIndex: 1
      });

      if (locIndex > 0) {
        const prevLoc = locations[locIndex - 1];
        const prevId =
          locationIdToNodeId.get(String(prevLoc.id).toLowerCase()) ||
          locationIdToNodeId.get(String(prevLoc.id));
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

    cursorY += areaHeight + AREA_GAP_Y;
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
      cacheVersion: 2,
      layout: 'trace-areas'
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

/**
 * Recompute group bounds from child nodes that share traceId.
 * Useful after drag or when loading old caches without group nodes.
 */
function recomputeAreaBounds(nodes, options = {}) {
  const padX = options.padX ?? AREA_PAD_X;
  const padY = options.padY ?? AREA_PAD_Y;
  const titleH = options.titleH ?? AREA_TITLE_H;
  const byTrace = new Map();

  for (const node of nodes) {
    if (node.type === 'group' || !node.traceId) continue;
    const list = byTrace.get(String(node.traceId)) || [];
    list.push(node);
    byTrace.set(String(node.traceId), list);
  }

  const groups = nodes.filter((n) => n.type === 'group');
  const result = [...nodes];

  // Update existing groups
  for (const group of groups) {
    const children = byTrace.get(String(group.traceId)) || [];
    if (!children.length) continue;
    const minX = Math.min(...children.map((n) => n.x));
    const minY = Math.min(...children.map((n) => n.y));
    const maxX = Math.max(...children.map((n) => n.x + (n.width || NODE_WIDTH)));
    const maxY = Math.max(...children.map((n) => n.y + (n.height || NODE_HEIGHT)));
    group.x = minX - padX;
    group.y = minY - titleH - padY;
    group.width = maxX - minX + padX * 2;
    group.height = maxY - minY + titleH + padY * 2;
  }

  // Synthesize missing groups for traces that have nodes but no group
  let synthIndex = groups.length;
  for (const [traceId, children] of byTrace) {
    if (groups.some((g) => String(g.traceId) === traceId)) continue;
    const palette = paletteForIndex(synthIndex++);
    const minX = Math.min(...children.map((n) => n.x));
    const minY = Math.min(...children.map((n) => n.y));
    const maxX = Math.max(...children.map((n) => n.x + (n.width || NODE_WIDTH)));
    const maxY = Math.max(...children.map((n) => n.y + (n.height || NODE_HEIGHT)));
    const title = children[0]?.subtitle?.split('·')[0]?.trim() || `Trace ${traceId}`;
    result.push({
      id: `area-trace-${traceId}`,
      type: 'group',
      title: `${traceId}. ${title}`,
      subtitle: '',
      content: '',
      x: minX - padX,
      y: minY - titleH - padY,
      width: maxX - minX + padX * 2,
      height: maxY - minY + titleH + padY * 2,
      traceId,
      color: palette.accent,
      fill: palette.fill,
      border: palette.border,
      zIndex: 0
    });
    for (const child of children) {
      if (!child.color) child.color = palette.accent;
    }
  }

  return result;
}

module.exports = {
  TRACE_AREA_PALETTE,
  paletteForIndex,
  codemapToCanvas,
  extractMermaidEdges,
  extractMermaidSubgraphs,
  buildMermaidIdToLocationId,
  recomputeAreaBounds
};
