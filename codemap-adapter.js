// src/builder/codemap-adapter.js
//
// Компонент "builder / алгоритмика" — конвертирует формат codemap
// (windsurf-style: traces[].locations[], mermaidDiagram) в формат .canvas,
// который уже умеет рендерить существующий canvas-движок (nodes/edges).
//
// Чистая функция: вход JSON → выход JSON, без DOM, без fs, без Electron.
// Это то, что подразумевал план: "алгоритмика построителя" отдельно от
// "канваса" — данный файл не знает о рендере вообще.

const ROW_HEIGHT = 260;
const COL_WIDTH = 360;
const NODE_WIDTH = 320;
const NODE_HEIGHT = 210;

/**
 * Извлекает межтрейсовые связи из mermaid-текста, потому что в исходном
 * codemap-формате они существуют ТОЛЬКО как строка mermaid, не как JSON.
 * Мы переводим их в явный edges[] один раз здесь, а не парсим mermaid
 * заново при каждом рендере.
 */
function extractMermaidEdges(mermaidText) {
  if (!mermaidText) return [];
  const pattern = /(\w+)\s*-->\s*\|([^|]*)\|\s*(\w+)/g;
  const edges = [];
  let match;
  while ((match = pattern.exec(mermaidText)) !== null) {
    edges.push({ from: match[1], to: match[3], label: match[2].trim() });
  }
  return edges;
}

/**
 * Основная конвертация. Каждая location становится нодой типа 'code'
 * (реальный path+line — открывается в редакторе из прошлого шага),
 * локации внутри trace соединяются цепочкой (той же, что была в
 * исходном traceTextDiagram: a→b→c...), плюс поверх — межтрейсовые
 * рёбра, извлечённые из mermaidDiagram.
 *
 * Намеренно НЕ создаём отдельную "нода-контейнер" на trace — принцип
 * "не усложнять": группировка видна и так, через subtitle с trace.title
 * и через саму цепочку связей.
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
      const nodeId = `node-${location.id}`;
      locationIdToNodeId.set(location.id, nodeId);

      nodes.push({
        id: nodeId,
        type: 'code',
        title: location.title || location.id,
        subtitle: `${trace.title} · ${location.path.split('/').pop()}:${location.lineNumber}`,
        path: options.rewritePath ? options.rewritePath(location.path) : location.path,
        anchorLine: location.lineNumber,
        content: [location.lineContent, location.description].filter(Boolean).join('\n'),
        x: locIndex * COL_WIDTH,
        y: traceIndex * ROW_HEIGHT,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      });

      if (locIndex > 0) {
        const prevId = locationIdToNodeId.get(locations[locIndex - 1].id);
        edges.push({
          id: `edge-chain-${locations[locIndex - 1].id}-${location.id}`,
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
    const fromNode = locationIdToNodeId.get(edge.from);
    const toNode = locationIdToNodeId.get(edge.to);
    if (!fromNode || !toNode) continue; // ссылка на id вне traces — пропускаем, не падаем
    edges.push({
      id: `edge-cross-${edge.from}-${edge.to}`,
      fromNode,
      fromSide: 'bottom',
      toNode,
      toSide: 'top',
      label: edge.label
    });
  }

  return {
    version: '1.0',
    metadata: {
      name: codemap.title || codemap.metadata?.name || 'codemap',
      sourceFolder: options.sourceFolder || null,
      generatedFromCodemapId: codemap.id || codemap.stableId || null
    },
    viewport: { x: 0, y: 0, scale: 1 },
    nodes,
    edges
  };
}

module.exports = { codemapToCanvas, extractMermaidEdges };
