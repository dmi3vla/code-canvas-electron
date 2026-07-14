// src/builder/codemap-adapter.js
//
// Pure transform: windsurf-style codemap JSON → .canvas nodes/edges.
//
// Areas (colored regions) come from mermaid subgraphs (Stage 6), matching
// Windsurf: subgraph id [Label] { nodes labeled "1a: …" }.
// Fallback: one area per trace when mermaid is missing.

const COL_WIDTH = 360;
const NODE_WIDTH = 320;
const NODE_HEIGHT = 210;
const AREA_PAD_X = 40;
const AREA_PAD_Y = 28;
const AREA_TITLE_H = 44;
const AREA_GAP_Y = 72;

/**
 * Windsurf rainbow cycle for area fills (dark UI, translucent).
 * Order matches mermaidColorize / mermaidPlaceholders.
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
 * Map mermaid node ids (e1, a2) → location ids (1a, 2b) from labels:
 *   e1["1a: Process start"]
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
 * from/to resolved to location ids when possible.
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
    // skip non-location technical ids that didn't resolve
    if (!/^\d+[a-z]$/i.test(from) || !/^\d+[a-z]$/i.test(to)) continue;
    const key = `${from}->${to}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: from.toLowerCase(), to: to.toLowerCase(), label });
  }

  return edges;
}

/**
 * Parse mermaid subgraphs into areas:
 *   { id, label, locationIds: ['1a','1b',...] }
 *
 * Membership = location ids found in node labels inside the subgraph block.
 * This is how Windsurf "generalizes" locations into colored regions.
 */
function extractMermaidSubgraphs(mermaidText) {
  if (!mermaidText) return [];

  const idMap = buildMermaidIdToLocationId(mermaidText);
  const subgraphs = [];
  const lines = mermaidText.replace(/\r\n/g, '\n').split('\n');
  let current = null;

  for (const line of lines) {
    const start = line.match(
      /^\s*subgraph\s+([^\s\[]+)\s*(?:\[\s*"?([^\]"]+)"?\s*\]|\["([^"]+)"\])?\s*$/i
    );
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

    // Direct location in label: anything["1a: ..."]
    const labelLoc = line.match(/\[\s*["'](\d+[a-zA-Z])\s*:/);
    if (labelLoc) {
      const loc = labelLoc[1].toLowerCase();
      if (!current.locationIds.includes(loc)) current.locationIds.push(loc);
      continue;
    }

    // Bare mermaid id that was mapped globally
    const nodeDef = line.match(/^\s*(\w+)\s*\[/);
    if (nodeDef) {
      const loc = idMap.get(nodeDef[1]);
      if (loc && !current.locationIds.includes(loc)) current.locationIds.push(loc);
    }
  }

  return subgraphs.filter((sg) => sg.locationIds.length > 0);
}

/**
 * Flatten all locations from traces with parent metadata.
 */
function collectLocations(codemap) {
  const byId = new Map();
  const order = [];

  (codemap.traces || []).forEach((trace, traceIndex) => {
    const traceId = String(trace.id ?? traceIndex + 1);
    (trace.locations || []).forEach((location, locIndex) => {
      const locationId = String(
        location.id || `${traceId}${String.fromCharCode(97 + locIndex)}`
      ).toLowerCase();
      const entry = {
        locationId,
        location,
        traceId,
        traceTitle: trace.title || `Trace ${traceId}`,
        traceDescription: trace.description || '',
        orderIndex: order.length
      };
      byId.set(locationId, entry);
      order.push(entry);
    });
  });

  return { byId, order };
}

/**
 * Build area list from mermaid subgraphs, fallback to traces.
 * Unassigned locations (not in any subgraph) form extra areas by their trace.
 */
function buildAreas(codemap) {
  const { byId, order } = collectLocations(codemap);
  const subgraphs = extractMermaidSubgraphs(codemap.mermaidDiagram);
  const assigned = new Set();
  const areas = [];

  if (subgraphs.length > 0) {
    subgraphs.forEach((sg, index) => {
      const locationIds = sg.locationIds.filter((id) => byId.has(id));
      locationIds.forEach((id) => assigned.add(id));
      if (locationIds.length === 0) return;
      areas.push({
        areaId: `area-sg-${sg.id}`,
        mermaidSubgraphId: sg.id,
        title: sg.label || sg.id,
        subtitle: '',
        locationIds,
        index
      });
    });

    // leftovers: group by original trace so nothing is dropped
    const leftoversByTrace = new Map();
    for (const entry of order) {
      if (assigned.has(entry.locationId)) continue;
      if (!leftoversByTrace.has(entry.traceId)) leftoversByTrace.set(entry.traceId, []);
      leftoversByTrace.get(entry.traceId).push(entry.locationId);
    }
    for (const [traceId, locationIds] of leftoversByTrace) {
      const sample = byId.get(locationIds[0]);
      areas.push({
        areaId: `area-trace-${traceId}`,
        mermaidSubgraphId: null,
        title: sample?.traceTitle || `Trace ${traceId}`,
        subtitle: sample?.traceDescription || '',
        locationIds,
        index: areas.length
      });
    }

    return { areas, byId, source: 'mermaid-subgraphs' };
  }

  // Fallback: one area per trace (no mermaid)
  (codemap.traces || []).forEach((trace, index) => {
    const traceId = String(trace.id ?? index + 1);
    const locationIds = (trace.locations || []).map((loc, locIndex) =>
      String(loc.id || `${traceId}${String.fromCharCode(97 + locIndex)}`).toLowerCase()
    );
    if (!locationIds.length) return;
    areas.push({
      areaId: `area-trace-${traceId}`,
      mermaidSubgraphId: null,
      title: `${traceId}. ${trace.title || `Trace ${traceId}`}`,
      subtitle: trace.description || '',
      locationIds,
      index
    });
  });

  return { areas, byId, source: 'traces' };
}

/**
 * Codemap → canvas with Windsurf-style colored areas.
 * Primary grouping = mermaid subgraphs; edges from mermaid + in-area chains.
 */
function codemapToCanvas(codemap, options = {}) {
  if (!codemap || !Array.isArray(codemap.traces)) {
    throw new Error('codemapToCanvas: ожидается объект с полем traces[]');
  }

  const { areas, byId, source } = buildAreas(codemap);
  const nodes = [];
  const edges = [];
  const locationIdToNodeId = new Map();
  let cursorY = 0;

  areas.forEach((area) => {
    const palette = paletteForIndex(area.index);
    const locations = area.locationIds
      .map((id) => byId.get(id))
      .filter(Boolean);

    if (!locations.length) return;

    const contentWidth =
      Math.max(1, locations.length) * COL_WIDTH - (COL_WIDTH - NODE_WIDTH);
    const areaWidth = contentWidth + AREA_PAD_X * 2;
    const areaHeight = AREA_TITLE_H + AREA_PAD_Y * 2 + NODE_HEIGHT;
    const areaX = 0;
    const areaY = cursorY;

    nodes.push({
      id: area.areaId,
      type: 'group',
      title: area.title,
      subtitle: area.subtitle || '',
      content: area.subtitle || '',
      x: areaX,
      y: areaY,
      width: areaWidth,
      height: areaHeight,
      areaId: area.areaId,
      mermaidSubgraphId: area.mermaidSubgraphId,
      // keep first location's trace for act-sidebar linking
      traceId: locations[0].traceId,
      color: palette.accent,
      fill: palette.fill,
      border: palette.border,
      zIndex: 0
    });

    locations.forEach((entry, locIndex) => {
      const { location, locationId, traceId } = entry;
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
        areaId: area.areaId,
        mermaidSubgraphId: area.mermaidSubgraphId,
        color: palette.accent,
        language: guessLanguage(location.path),
        content: [location.lineContent, location.description].filter(Boolean).join('\n'),
        x: areaX + AREA_PAD_X + locIndex * COL_WIDTH,
        y: areaY + AREA_TITLE_H + AREA_PAD_Y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        zIndex: 1
      });

      // chain within area (order as listed in subgraph / locations)
      if (locIndex > 0) {
        const prev = locations[locIndex - 1];
        const prevId = locationIdToNodeId.get(prev.locationId);
        edges.push({
          id: `edge-chain-${prev.locationId}-${locationId}`,
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

  // Cross-area (and any labeled) edges from mermaid — prefer these over pure linear glue
  const mermaidEdges = extractMermaidEdges(codemap.mermaidDiagram);
  const seenEdge = new Set(edges.map((e) => `${e.fromNode}->${e.toNode}`));

  for (const edge of mermaidEdges) {
    const fromNode = locationIdToNodeId.get(edge.from);
    const toNode = locationIdToNodeId.get(edge.to);
    if (!fromNode || !toNode) continue;
    const key = `${fromNode}->${toNode}`;
    if (seenEdge.has(key)) {
      // upgrade label if mermaid has a better one
      const existing = edges.find((e) => e.fromNode === fromNode && e.toNode === toNode);
      if (existing && edge.label && existing.label === 'flow') {
        existing.label = edge.label;
      }
      continue;
    }
    seenEdge.add(key);

    const fromEntry = byId.get(edge.from);
    const toEntry = byId.get(edge.to);
    const sameArea =
      fromEntry &&
      toEntry &&
      nodes.find((n) => n.locationId === edge.from)?.areaId ===
        nodes.find((n) => n.locationId === edge.to)?.areaId;

    edges.push({
      id: `edge-mermaid-${edge.from}-${edge.to}`,
      fromNode,
      fromSide: sameArea ? 'right' : 'bottom',
      toNode,
      toSide: sameArea ? 'left' : 'top',
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
      cacheVersion: 3,
      layout: source === 'mermaid-subgraphs' ? 'mermaid-areas' : 'trace-areas',
      areaSource: source
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
 * Recompute group bounds from child nodes that share areaId (or legacy traceId).
 */
function recomputeAreaBounds(nodes, options = {}) {
  const padX = options.padX ?? AREA_PAD_X;
  const padY = options.padY ?? AREA_PAD_Y;
  const titleH = options.titleH ?? AREA_TITLE_H;

  const areaKey = (node) => {
    if (node.areaId) return String(node.areaId);
    if (node.traceId) return `legacy-trace-${node.traceId}`;
    return null;
  };

  const byArea = new Map();
  for (const node of nodes) {
    if (node.type === 'group') continue;
    const key = areaKey(node);
    if (!key) continue;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(node);
  }

  const groups = nodes.filter((n) => n.type === 'group');
  const result = [...nodes];

  for (const group of groups) {
    const key = areaKey(group) || (group.traceId ? `legacy-trace-${group.traceId}` : null);
    const children = (key && byArea.get(key)) || [];
    if (!children.length) continue;
    const minX = Math.min(...children.map((n) => n.x));
    const minY = Math.min(...children.map((n) => n.y));
    const maxX = Math.max(...children.map((n) => n.x + (n.width || NODE_WIDTH)));
    const maxY = Math.max(...children.map((n) => n.y + (n.height || NODE_HEIGHT)));
    group.x = minX - padX;
    group.y = minY - titleH - padY;
    group.width = maxX - minX + padX * 2;
    group.height = maxY - minY + titleH + padY * 2;
    if (!group.areaId && key) group.areaId = key;
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
  buildAreas,
  recomputeAreaBounds
};
