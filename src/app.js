const root = document.getElementById('canvas-root');
const contentLayer = document.getElementById('canvas-content');
const edgesLayer = document.getElementById('edges-layer');
const nodeTemplate = document.getElementById('node-template');
const statusText = document.getElementById('status-text');
const viewText = document.getElementById('view-text');
const leftSidebar = document.getElementById('left-sidebar');
const rightSidebar = document.getElementById('right-sidebar');
const leftSidebarRailBtn = document.getElementById('left-sidebar-rail-btn');
const rightSidebarRailBtn = document.getElementById('right-sidebar-rail-btn');

const inspectorEmpty = document.getElementById('inspector-empty');
const inspectorNode = document.getElementById('inspector-node');
const inspectorEdge = document.getElementById('inspector-edge');
const nodeTitleInput = document.getElementById('node-title-input');
const nodeTypeInput = document.getElementById('node-type-input');
const nodeSubtitleInput = document.getElementById('node-subtitle-input');
const nodeContentInput = document.getElementById('node-content-input');
const edgeLabelInput = document.getElementById('edge-label-input');

const buttons = {
  newCanvas: document.getElementById('new-canvas-btn'),
  openCanvas: document.getElementById('open-canvas-btn'),
  saveCanvas: document.getElementById('save-canvas-btn'),
  importProject: document.getElementById('import-project-btn'),
  addNote: document.getElementById('add-note-btn'),
  addCode: document.getElementById('add-code-btn'),
  autoLayout: document.getElementById('auto-layout-btn'),
  fitView: document.getElementById('fit-view-btn'),
  panMode: document.getElementById('pan-mode-btn'),
  linkMode: document.getElementById('link-mode-btn'),
  selectMode: document.getElementById('select-mode-btn'),
  toggleLeftSidebar: document.getElementById('toggle-left-sidebar-btn'),
  toggleRightSidebar: document.getElementById('toggle-right-sidebar-btn')
};

const state = {
  nodes: [],
  edges: [],
  view: {
    x: 220,
    y: 120,
    scale: 1
  },
  selection: {
    type: null,
    id: null
  },
  interaction: {
    pan: null,
    drag: null,
    link: null,
    resize: null
  },
  mode: 'pan',
  ui: {
    leftSidebarCollapsed: false,
    rightSidebarCollapsed: false
  },
  meta: {
    sourceFolder: null,
    name: 'Untitled.canvas'
  }
};

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCanvas() {
  return {
    nodes: [
      {
        id: createId('node'),
        type: 'text',
        title: 'Product Map',
        subtitle: 'double click empty space to add note',
        content: '# Desktop canvas\n- Notes\n- Architecture\n- Research\n- Code links',
        x: 0,
        y: 0,
        width: 290,
        height: 200
      },
      {
        id: createId('node'),
        type: 'code',
        title: 'app.ts',
        subtitle: 'src/app.ts',
        content: "export function boot() {\n  canvas.mount('#app');\n  graph.connect();\n}",
        x: 380,
        y: 40,
        width: 320,
        height: 200
      },
      {
        id: createId('node'),
        type: 'text',
        title: 'Flow',
        subtitle: 'idea expansion',
        content: '## Next\nConnect notes with code panels and save as `.canvas`.',
        x: 180,
        y: 280,
        width: 280,
        height: 170
      }
    ],
    edges: []
  };
}

function setStatus(message) {
  statusText.textContent = message;
}

function updateSidebarUI() {
  leftSidebar.classList.toggle('collapsed', state.ui.leftSidebarCollapsed);
  rightSidebar.classList.toggle('collapsed', state.ui.rightSidebarCollapsed);
  leftSidebarRailBtn.classList.toggle('hidden', !state.ui.leftSidebarCollapsed);
  rightSidebarRailBtn.classList.toggle('hidden', !state.ui.rightSidebarCollapsed);
  buttons.toggleLeftSidebar.textContent = state.ui.leftSidebarCollapsed ? '▶' : '◀';
  buttons.toggleRightSidebar.textContent = state.ui.rightSidebarCollapsed ? '◀' : '▶';
}

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMarkdown(input = '') {
  const lines = escapeHtml(input).split('\n');
  const html = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h3>${line.slice(4)}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h2>${line.slice(3)}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h1>${line.slice(2)}</h1>`);
      continue;
    }
    if (line.startsWith('- ')) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${line.slice(2)}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    if (!line.trim()) {
      html.push('<p></p>');
      continue;
    }
    html.push(`<p>${line}</p>`);
  }

  if (inList) html.push('</ul>');

  return html
    .join('')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function applyViewTransform() {
  const transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
  contentLayer.style.transform = transform;
  edgesLayer.style.transform = transform;
  viewText.textContent = `${Math.round(state.view.scale * 100)}%`;
}

function getNodeById(id) {
  return state.nodes.find((node) => node.id === id);
}

function getEdgeById(id) {
  return state.edges.find((edge) => edge.id === id);
}

function worldFromClient(clientX, clientY) {
  const rect = root.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.view.x) / state.view.scale,
    y: (clientY - rect.top - state.view.y) / state.view.scale
  };
}

function connectorPoint(node, side) {
  const width = node.width || 320;
  const height = node.height || 180;
  return {
    x:
      side === 'left'
        ? node.x
        : side === 'right'
          ? node.x + width
          : node.x + width / 2,
    y:
      side === 'top'
        ? node.y
        : side === 'bottom'
          ? node.y + height
          : node.y + height / 2
  };
}

function edgePath(from, to) {
  const dx = Math.max(80, Math.abs(to.x - from.x) * 0.42);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

function select(selectionType, id) {
  state.selection = { type: selectionType, id };
  renderInspector();
  render();
}

function clearSelection() {
  state.selection = { type: null, id: null };
  renderInspector();
  render();
}

function addNode(partial) {
  const node = {
    id: createId('node'),
    type: partial.type || 'text',
    title: partial.title || 'New node',
    subtitle: partial.subtitle || '',
    content: partial.content || '',
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width || 300,
    height: partial.height || 180
  };
  state.nodes.push(node);
  select('node', node.id);
  setStatus(`Создана нода: ${node.title}`);
  return node;
}

function removeSelected() {
  if (state.selection.type === 'node') {
    const nodeId = state.selection.id;
    state.nodes = state.nodes.filter((node) => node.id !== nodeId);
    state.edges = state.edges.filter((edge) => edge.fromNode !== nodeId && edge.toNode !== nodeId);
    clearSelection();
    setStatus('Нода удалена');
    return;
  }

  if (state.selection.type === 'edge') {
    state.edges = state.edges.filter((edge) => edge.id !== state.selection.id);
    clearSelection();
    setStatus('Связь удалена');
  }
}

function renderEdges() {
  edgesLayer.innerHTML = '';

  for (const edge of state.edges) {
    const fromNode = getNodeById(edge.fromNode);
    const toNode = getNodeById(edge.toNode);
    if (!fromNode || !toNode) continue;

    const from = connectorPoint(fromNode, edge.fromSide || 'right');
    const to = connectorPoint(toNode, edge.toSide || 'left');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', edgePath(from, to));
    pathEl.setAttribute('class', `edge-path ${state.selection.type === 'edge' && state.selection.id === edge.id ? 'selected' : ''}`);
    pathEl.dataset.edgeId = edge.id;
    pathEl.style.pointerEvents = 'stroke';
    pathEl.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      select('edge', edge.id);
    });
    pathEl.addEventListener('click', (event) => {
      event.stopPropagation();
      select('edge', edge.id);
    });
    edgesLayer.appendChild(pathEl);

    if (edge.label) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'edge-label');
      label.setAttribute('x', String((from.x + to.x) / 2));
      label.setAttribute('y', String((from.y + to.y) / 2 - 10));
      label.textContent = edge.label;
      edgesLayer.appendChild(label);
    }
  }

  if (state.interaction.link) {
    const { fromNodeId, fromSide, toPoint } = state.interaction.link;
    const node = getNodeById(fromNodeId);
    if (!node) return;
    const from = connectorPoint(node, fromSide);
    const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    temp.setAttribute('d', edgePath(from, toPoint));
    temp.setAttribute('class', 'edge-path temp-link');
    edgesLayer.appendChild(temp);
  }
}

function renderNode(node) {
  const fragment = nodeTemplate.content.cloneNode(true);
  const element = fragment.querySelector('.node');
  const title = fragment.querySelector('.node-title');
  const subtitle = fragment.querySelector('.node-subtitle');
  const tag = fragment.querySelector('.node-tag');
  const body = fragment.querySelector('.node-body');
  const leftConnector = fragment.querySelector('.connector-left');
  const rightConnector = fragment.querySelector('.connector-right');
  const resizeHandle = fragment.querySelector('.node-resize-handle');

  element.classList.add(node.type);
  if (state.selection.type === 'node' && state.selection.id === node.id) {
    element.classList.add('selected');
  }

  element.dataset.nodeId = node.id;
  element.style.left = `${node.x}px`;
  element.style.top = `${node.y}px`;
  element.style.setProperty('--node-width', `${node.width || 300}px`);
  element.style.height = `${node.height || 180}px`;

  title.textContent = node.title || 'Untitled';
  subtitle.textContent = node.subtitle || node.path || '';
  tag.textContent = node.type;

  if (node.type === 'text') {
    body.innerHTML = renderMarkdown(node.content || '');
  } else {
    body.innerHTML = `<pre>${escapeHtml(node.content || '')}</pre>`;
  }

  const onConnectorDown = (event, side) => {
    event.stopPropagation();
    const world = worldFromClient(event.clientX, event.clientY);
    state.interaction.link = {
      fromNodeId: node.id,
      fromSide: side,
      toPoint: world
    };
    renderEdges();
  };

  leftConnector.addEventListener('mousedown', (event) => onConnectorDown(event, 'left'));
  rightConnector.addEventListener('mousedown', (event) => onConnectorDown(event, 'right'));
  resizeHandle.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    const world = worldFromClient(event.clientX, event.clientY);
    select('node', node.id);
    state.interaction.resize = {
      nodeId: node.id,
      startWidth: node.width || 300,
      startHeight: node.height || 180,
      startX: world.x,
      startY: world.y
    };
  });

  element.addEventListener('mousedown', (event) => {
    if (event.target.classList.contains('connector') || event.target.classList.contains('node-resize-handle')) return;
    event.stopPropagation();
    const world = worldFromClient(event.clientX, event.clientY);
    select('node', node.id);
    state.interaction.drag = {
      nodeId: node.id,
      offsetX: world.x - node.x,
      offsetY: world.y - node.y
    };
  });

  element.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    select('node', node.id);
    if (node.type === 'file' || node.type === 'code') {
      nodeContentInput.focus();
      nodeContentInput.setSelectionRange(nodeContentInput.value.length, nodeContentInput.value.length);
    }
  });

  contentLayer.appendChild(fragment);
}

function renderInspector() {
  inspectorEmpty.classList.add('hidden');
  inspectorNode.classList.add('hidden');
  inspectorEdge.classList.add('hidden');

  if (state.selection.type === 'node') {
    const node = getNodeById(state.selection.id);
    if (!node) return;
    inspectorNode.classList.remove('hidden');
    nodeTitleInput.value = node.title || '';
    nodeTypeInput.value = node.type || 'text';
    nodeSubtitleInput.value = node.subtitle || node.path || '';
    nodeContentInput.value = node.content || '';
    return;
  }

  if (state.selection.type === 'edge') {
    const edge = getEdgeById(state.selection.id);
    if (!edge) return;
    inspectorEdge.classList.remove('hidden');
    edgeLabelInput.value = edge.label || '';
    return;
  }

  inspectorEmpty.classList.remove('hidden');
}

function render() {
  updateSidebarUI();
  applyViewTransform();
  contentLayer.innerHTML = '';
  for (const node of state.nodes) {
    renderNode(node);
  }
  renderEdges();
}

function setMode(mode) {
  state.mode = mode;
  buttons.panMode.classList.toggle('active', mode === 'pan');
  buttons.linkMode.classList.toggle('active', mode === 'link');
  buttons.selectMode.classList.toggle('active', mode === 'select');
  setStatus(`Режим: ${mode}`);
}

function toggleSidebar(side, collapsed) {
  const nextValue =
    typeof collapsed === 'boolean'
      ? collapsed
      : side === 'left'
        ? !state.ui.leftSidebarCollapsed
        : !state.ui.rightSidebarCollapsed;

  if (side === 'left') state.ui.leftSidebarCollapsed = nextValue;
  if (side === 'right') state.ui.rightSidebarCollapsed = nextValue;
  updateSidebarUI();
  setStatus(
    side === 'left'
      ? nextValue ? 'Левая панель скрыта' : 'Левая панель раскрыта'
      : nextValue ? 'Инспектор скрыт' : 'Инспектор раскрыт'
  );
}

function autoLayout() {
  const columns = Math.max(1, Math.floor(root.clientWidth / 360));
  state.nodes.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    node.x = col * 360;
    node.y = row * 240;
  });
  render();
  setStatus('Авто-раскладка применена');
}

function fitView() {
  if (!state.nodes.length) return;

  const minX = Math.min(...state.nodes.map((node) => node.x));
  const minY = Math.min(...state.nodes.map((node) => node.y));
  const maxX = Math.max(...state.nodes.map((node) => node.x + (node.width || 300)));
  const maxY = Math.max(...state.nodes.map((node) => node.y + (node.height || 180)));
  const boundsWidth = maxX - minX;
  const boundsHeight = maxY - minY;
  const padding = 100;
  const scaleX = (root.clientWidth - padding) / Math.max(1, boundsWidth);
  const scaleY = (root.clientHeight - padding) / Math.max(1, boundsHeight);
  const scale = Math.min(1, scaleX, scaleY);

  state.view.scale = Math.max(0.35, Math.min(1.4, scale));
  state.view.x = root.clientWidth / 2 - (minX + boundsWidth / 2) * state.view.scale;
  state.view.y = root.clientHeight / 2 - (minY + boundsHeight / 2) * state.view.scale;
  render();
  setStatus('Вид подогнан под содержимое');
}

function addEdge(fromNodeId, toNodeId, fromSide = 'right', toSide = 'left', label = '') {
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
  const exists = state.edges.some((edge) => edge.fromNode === fromNodeId && edge.toNode === toNodeId);
  if (exists) {
    setStatus('Такая связь уже существует');
    return;
  }
  state.edges.push({
    id: createId('edge'),
    fromNode: fromNodeId,
    fromSide,
    toNode: toNodeId,
    toSide,
    label
  });
  setStatus('Связь создана');
}

function serializeCanvas() {
  return {
    version: '1.0',
    metadata: {
      name: state.meta.name,
      sourceFolder: state.meta.sourceFolder
    },
    viewport: { ...state.view },
    nodes: state.nodes.map((node) => ({
      ...node,
      text: node.type === 'text' ? node.content : undefined
    })),
    edges: state.edges.map((edge) => ({ ...edge }))
  };
}

function loadCanvas(payload) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];

  state.nodes = nodes.map((node, index) => ({
    id: node.id || createId(`node${index}`),
    type: node.type || 'text',
    title: node.title || node.file || `Node ${index + 1}`,
    subtitle: node.subtitle || node.path || '',
    content: node.content || node.text || '',
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width || 300,
    height: node.height || 180,
    path: node.path || ''
  }));
  state.edges = edges.map((edge, index) => ({
    id: edge.id || createId(`edge${index}`),
    fromNode: edge.fromNode || edge.fromNodeId || edge.from,
    fromSide: edge.fromSide || 'right',
    toNode: edge.toNode || edge.toNodeId || edge.to,
    toSide: edge.toSide || 'left',
    label: edge.label || ''
  }));
  state.view = {
    x: payload.viewport?.x ?? 220,
    y: payload.viewport?.y ?? 120,
    scale: payload.viewport?.scale ?? 1
  };
  state.meta = {
    name: payload.metadata?.name || state.meta.name,
    sourceFolder: payload.metadata?.sourceFolder || null
  };
  clearSelection();
  render();
}

async function saveCanvas() {
  try {
    const result = await window.electronAPI.saveCanvas(serializeCanvas());
    if (result.canceled) return;
    state.meta.name = result.filePath.split(/[\\/]/).pop();
    setStatus(`Сохранено: ${state.meta.name}`);
  } catch (error) {
    setStatus(`Ошибка сохранения: ${error.message}`);
  }
}

async function openCanvas() {
  try {
    const result = await window.electronAPI.openCanvas();
    if (result.canceled) return;
    loadCanvas(result.data);
    state.meta.name = result.filePath.split(/[\\/]/).pop();
    setStatus(`Открыт canvas: ${state.meta.name}`);
  } catch (error) {
    setStatus(`Ошибка открытия: ${error.message}`);
  }
}

async function importProject() {
  try {
    const result = await window.electronAPI.pickProject();
    if (result.canceled) return;
    state.nodes = result.nodes || [];
    state.edges = result.edges || [];
    state.meta.sourceFolder = result.folderPath;
    state.meta.name = `${result.folderName || 'workspace'}.canvas`;
    clearSelection();
    autoLayout();
    fitView();
    setStatus(`Импортировано файлов: ${state.nodes.length}`);
  } catch (error) {
    setStatus(`Ошибка импорта: ${error.message}`);
  }
}

function resetCanvas() {
  const fresh = defaultCanvas();
  state.nodes = fresh.nodes;
  state.edges = fresh.edges;
  state.view = { x: 220, y: 120, scale: 1 };
  state.meta = { sourceFolder: null, name: 'Untitled.canvas' };
  clearSelection();
  render();
  setStatus('Создан новый canvas');
}

buttons.newCanvas.addEventListener('click', resetCanvas);
buttons.openCanvas.addEventListener('click', openCanvas);
buttons.saveCanvas.addEventListener('click', saveCanvas);
buttons.importProject.addEventListener('click', importProject);
buttons.autoLayout.addEventListener('click', autoLayout);
buttons.fitView.addEventListener('click', fitView);
buttons.addNote.addEventListener('click', () => {
  addNode({
    type: 'text',
    title: 'New note',
    subtitle: 'markdown',
    content: '## Note\nНапишите здесь идею или описание.',
    x: 120,
    y: 90,
    width: 300,
    height: 180
  });
  render();
});
buttons.addCode.addEventListener('click', () => {
  addNode({
    type: 'code',
    title: 'snippet.ts',
    subtitle: 'manual code node',
    content: "function example() {\n  return 'canvas';\n}",
    x: 220,
    y: 140,
    width: 320,
    height: 190
  });
  render();
});

buttons.panMode.addEventListener('click', () => setMode('pan'));
buttons.linkMode.addEventListener('click', () => setMode('link'));
buttons.selectMode.addEventListener('click', () => setMode('select'));
buttons.toggleLeftSidebar.addEventListener('click', () => toggleSidebar('left'));
buttons.toggleRightSidebar.addEventListener('click', () => toggleSidebar('right'));
leftSidebarRailBtn.addEventListener('click', () => toggleSidebar('left', false));
rightSidebarRailBtn.addEventListener('click', () => toggleSidebar('right', false));

nodeTitleInput.addEventListener('input', () => {
  const node = getNodeById(state.selection.id);
  if (!node) return;
  node.title = nodeTitleInput.value;
  render();
});

nodeTypeInput.addEventListener('change', () => {
  const node = getNodeById(state.selection.id);
  if (!node) return;
  node.type = nodeTypeInput.value;
  render();
});

nodeSubtitleInput.addEventListener('input', () => {
  const node = getNodeById(state.selection.id);
  if (!node) return;
  node.subtitle = nodeSubtitleInput.value;
  render();
});

nodeContentInput.addEventListener('input', () => {
  const node = getNodeById(state.selection.id);
  if (!node) return;
  node.content = nodeContentInput.value;
  render();
});

edgeLabelInput.addEventListener('input', () => {
  const edge = getEdgeById(state.selection.id);
  if (!edge) return;
  edge.label = edgeLabelInput.value;
  renderEdges();
});

root.addEventListener('mousedown', (event) => {
  const targetNode = event.target.closest('.node');
  if (targetNode) return;

  clearSelection();

  if (state.mode === 'pan' || event.button === 1 || event.target === root || event.target === edgesLayer || event.target === contentLayer) {
    root.classList.add('panning');
    state.interaction.pan = {
      startX: event.clientX,
      startY: event.clientY,
      viewX: state.view.x,
      viewY: state.view.y
    };
  }
});

root.addEventListener('dblclick', (event) => {
  const targetNode = event.target.closest('.node');
  if (targetNode) return;
  const point = worldFromClient(event.clientX, event.clientY);
  addNode({
    type: 'text',
    title: 'New note',
    subtitle: 'double click created',
    content: '# Note',
    x: point.x - 120,
    y: point.y - 60,
    width: 280,
    height: 160
  });
  render();
});

window.addEventListener('mousemove', (event) => {
  if (state.interaction.pan) {
    const dx = event.clientX - state.interaction.pan.startX;
    const dy = event.clientY - state.interaction.pan.startY;
    state.view.x = state.interaction.pan.viewX + dx;
    state.view.y = state.interaction.pan.viewY + dy;
    applyViewTransform();
    renderEdges();
    return;
  }

  if (state.interaction.drag) {
    const node = getNodeById(state.interaction.drag.nodeId);
    if (!node) return;
    const world = worldFromClient(event.clientX, event.clientY);
    node.x = world.x - state.interaction.drag.offsetX;
    node.y = world.y - state.interaction.drag.offsetY;
    render();
    return;
  }

  if (state.interaction.resize) {
    const node = getNodeById(state.interaction.resize.nodeId);
    if (!node) return;
    const world = worldFromClient(event.clientX, event.clientY);
    node.width = Math.max(220, Math.round(state.interaction.resize.startWidth + (world.x - state.interaction.resize.startX)));
    node.height = Math.max(140, Math.round(state.interaction.resize.startHeight + (world.y - state.interaction.resize.startY)));
    render();
    return;
  }

  if (state.interaction.link) {
    state.interaction.link.toPoint = worldFromClient(event.clientX, event.clientY);
    renderEdges();
  }
});

window.addEventListener('mouseup', (event) => {
  if (state.interaction.link) {
    const target = event.target instanceof Element ? event.target : null;
    const connector = target?.closest('.connector');
    const nodeEl = target?.closest('.node');
    if (connector && nodeEl) {
      const toNodeId = nodeEl.dataset.nodeId;
      const toSide = connector.dataset.side || 'left';
      addEdge(
        state.interaction.link.fromNodeId,
        toNodeId,
        state.interaction.link.fromSide,
        toSide,
        state.mode === 'link' ? 'link' : ''
      );
    } else if (nodeEl) {
      addEdge(
        state.interaction.link.fromNodeId,
        nodeEl.dataset.nodeId,
        state.interaction.link.fromSide,
        'left',
        ''
      );
    }
  }

  root.classList.remove('panning');
  state.interaction.pan = null;
  state.interaction.drag = null;
  state.interaction.link = null;
  state.interaction.resize = null;
  render();
});

root.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const cursor = worldFromClient(event.clientX, event.clientY);
    const delta = event.deltaY < 0 ? 1.08 : 0.92;
    const newScale = Math.max(0.25, Math.min(2.5, state.view.scale * delta));
    state.view.x = event.clientX - root.getBoundingClientRect().left - cursor.x * newScale;
    state.view.y = event.clientY - root.getBoundingClientRect().top - cursor.y * newScale;
    state.view.scale = newScale;
    render();
  },
  { passive: false }
);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (document.activeElement.matches('input, textarea, select')) return;
    removeSelected();
    render();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveCanvas();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openCanvas();
  }
});

window.electronAPI.onMenuAction((payload) => {
  if (payload.type === 'import-project') importProject();
  if (payload.type === 'open-canvas') openCanvas();
  if (payload.type === 'save-canvas') saveCanvas();
});

async function init() {
  const fresh = defaultCanvas();
  state.nodes = fresh.nodes;
  state.edges = [
    {
      id: createId('edge'),
      fromNode: state.nodes[0].id,
      fromSide: 'right',
      toNode: state.nodes[1].id,
      toSide: 'left',
      label: 'imports'
    },
    {
      id: createId('edge'),
      fromNode: state.nodes[0].id,
      fromSide: 'bottom',
      toNode: state.nodes[2].id,
      toSide: 'top',
      label: 'idea'
    }
  ];
  renderInspector();
  render();

  const version = await window.electronAPI.getVersion().catch(() => 'dev');
  setStatus(`Готово · v${version}`);
}

init();
