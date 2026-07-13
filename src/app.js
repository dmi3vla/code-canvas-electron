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
const projectSplash = document.getElementById('project-splash');
const brandSubtitle = document.getElementById('brand-subtitle');
const projectPathLabel = document.getElementById('project-path-label');
const cacheStatusLabel = document.getElementById('cache-status-label');
const actsList = document.getElementById('acts-list');
const codemapQueryInput = document.getElementById('codemap-query-input');

const inspectorEmpty = document.getElementById('inspector-empty');
const inspectorNode = document.getElementById('inspector-node');
const inspectorEdge = document.getElementById('inspector-edge');
const nodeTitleInput = document.getElementById('node-title-input');
const nodeTypeInput = document.getElementById('node-type-input');
const nodeSubtitleInput = document.getElementById('node-subtitle-input');
const nodeContentInput = document.getElementById('node-content-input');
const edgeLabelInput = document.getElementById('edge-label-input');
const openInEditorBtn = document.getElementById('open-in-editor-btn');

const editorPanel = document.getElementById('editor-panel');
const editorPanelMount = document.getElementById('editor-panel-mount');
const editorPanelTitle = document.getElementById('editor-panel-title');
const editorPanelCloseBtn = document.getElementById('editor-panel-close-btn');
let editorMounted = false;

const settingsApiKey = document.getElementById('settings-api-key');
const settingsBaseUrl = document.getElementById('settings-base-url');
const settingsModel = document.getElementById('settings-model');
const settingsLanguage = document.getElementById('settings-language');
const settingsPathLabel = document.getElementById('settings-path-label');
const settingsKeyStatus = document.getElementById('settings-key-status');

const buttons = {
  openProject: document.getElementById('open-project-btn'),
  splashOpenProject: document.getElementById('splash-open-project-btn'),
  newCanvas: document.getElementById('new-canvas-btn'),
  openCanvas: document.getElementById('open-canvas-btn'),
  saveCanvas: document.getElementById('save-canvas-btn'),
  importProject: document.getElementById('import-project-btn'),
  addNote: document.getElementById('add-note-btn'),
  addCode: document.getElementById('add-code-btn'),
  autoLayout: document.getElementById('auto-layout-btn'),
  fitView: document.getElementById('fit-view-btn'),
  settings: document.getElementById('settings-btn'),
  settingsSave: document.getElementById('settings-save-btn'),
  generateCodemap: document.getElementById('generate-codemap-btn'),
  regenerateCodemap: document.getElementById('regenerate-codemap-btn'),
  panMode: document.getElementById('pan-mode-btn'),
  linkMode: document.getElementById('link-mode-btn'),
  selectMode: document.getElementById('select-mode-btn'),
  toggleLeftSidebar: document.getElementById('toggle-left-sidebar-btn'),
  toggleRightSidebar: document.getElementById('toggle-right-sidebar-btn')
};

const DEFAULT_QUERY = 'Обзор архитектуры и основных потоков выполнения';

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
    name: 'Untitled.canvas',
    query: null,
    generatedAt: null
  },
  /** @type {object|null} full codemap for acts sidebar */
  codemap: null,
  projectReady: false,
  cacheHit: false,
  isGenerating: false
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
  tag.textContent = node.locationId || node.type;

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

async function openNodeInEditor(node) {
  if (!node.path) {
    // Нет реального файла на диске (заметка/чистый code-сниппет без path) —
    // открываем то, что есть в самой ноде, без обращения к fs.
    editorPanelTitle.textContent = node.title || 'Без имени';
    editorPanel.classList.remove('hidden');
    if (!editorMounted) {
      window.CodeCanvasEditor.mount(editorPanelMount);
      editorMounted = true;
    }
    window.CodeCanvasEditor.openFile(node.title || '', node.content || '');
    return;
  }

  try {
    const result = await window.electronAPI.readTextFile(node.path);
    const content = result.content;
    const resolvedPath = result.path || node.path;
    editorPanelTitle.textContent = node.anchorLine
      ? `${resolvedPath}:${node.anchorLine}`
      : resolvedPath;
    editorPanel.classList.remove('hidden');
    if (!editorMounted) {
      window.CodeCanvasEditor.mount(editorPanelMount);
      editorMounted = true;
    }
    window.CodeCanvasEditor.openFile(resolvedPath, content, node.anchorLine);
  } catch (err) {
    statusText.textContent = `Не удалось открыть файл: ${err.message || err}`;
  }
}

function closeEditorPanel() {
  editorPanel.classList.add('hidden');
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

    if (node.type === 'file' || node.type === 'code') {
      openInEditorBtn.classList.remove('hidden');
      openInEditorBtn.onclick = () => openNodeInEditor(node);
    } else {
      openInEditorBtn.classList.add('hidden');
      openInEditorBtn.onclick = null;
    }
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
      sourceFolder: state.meta.sourceFolder,
      query: state.meta.query || null,
      generatedAt: state.meta.generatedAt || null,
      cacheVersion: 1
    },
    viewport: { ...state.view },
    nodes: state.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      subtitle: node.subtitle,
      content: node.content,
      text: node.type === 'text' ? node.content : undefined,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      path: node.path || '',
      anchorLine: node.anchorLine ?? null,
      language: node.language || '',
      locationId: node.locationId || null,
      traceId: node.traceId || null
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
    path: node.path || '',
    anchorLine: node.anchorLine ?? null,
    language: node.language || '',
    locationId: node.locationId || null,
    traceId: node.traceId || null
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
    sourceFolder: payload.metadata?.sourceFolder || state.meta.sourceFolder || null,
    query: payload.metadata?.query || state.meta.query || null,
    generatedAt: payload.metadata?.generatedAt || null
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

function hideSplash() {
  if (projectSplash) projectSplash.classList.add('hidden');
}

function showSplash() {
  if (projectSplash) projectSplash.classList.remove('hidden');
}

function updateProjectChrome() {
  const folder = state.meta.sourceFolder;
  if (projectPathLabel) {
    projectPathLabel.textContent = folder || 'Папка не выбрана';
  }
  if (brandSubtitle) {
    brandSubtitle.textContent = folder
      ? folder.split(/[\\/]/).pop()
      : 'Выберите папку проекта';
  }
  if (cacheStatusLabel) {
    if (!folder) {
      cacheStatusLabel.textContent = '';
    } else if (state.cacheHit) {
      cacheStatusLabel.textContent = 'Кэш: .code-canvas.canvas (без GPT)';
    } else {
      cacheStatusLabel.textContent = 'Кэш отсутствует — нажмите Generate';
    }
  }
  const busy = Boolean(state.isGenerating);
  if (buttons.regenerateCodemap) {
    buttons.regenerateCodemap.disabled = !state.projectReady || busy;
  }
  if (buttons.generateCodemap) {
    buttons.generateCodemap.disabled = !state.projectReady || busy;
  }
}

function renderActsList(codemap) {
  if (!actsList) return;
  if (!codemap || !Array.isArray(codemap.traces) || codemap.traces.length === 0) {
    actsList.innerHTML =
      '<div class="panel-copy">Нет codemap. Откройте проект с кэшем или сгенерируйте карту.</div>';
    return;
  }

  actsList.innerHTML = '';
  for (const trace of codemap.traces) {
    const item = document.createElement('details');
    item.className = 'act-item';
    item.dataset.traceId = String(trace.id);

    const summary = document.createElement('summary');
    summary.textContent = `${trace.id}. ${trace.title || 'Trace'}`;
    item.appendChild(summary);

    const desc = document.createElement('div');
    desc.className = 'act-desc';
    desc.textContent = trace.description || '';
    item.appendChild(desc);

    if (trace.traceTextDiagram) {
      const pre = document.createElement('pre');
      pre.className = 'act-diagram';
      pre.textContent = trace.traceTextDiagram;
      item.appendChild(pre);
    }

    if (trace.traceGuide) {
      const guide = document.createElement('div');
      guide.className = 'act-guide';
      guide.innerHTML = renderMarkdown(trace.traceGuide);
      item.appendChild(guide);
    }

    const locs = document.createElement('div');
    locs.className = 'act-locations';
    for (const loc of trace.locations || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'act-loc-btn';
      btn.textContent = `${loc.id}: ${loc.title || loc.path}:${loc.lineNumber}`;
      btn.addEventListener('click', () => {
        const node = state.nodes.find(
          (n) => n.locationId === loc.id || n.id === `node-${loc.id}`
        );
        if (node) {
          select('node', node.id);
          openNodeInEditor(node);
        } else {
          setStatus(`Нода ${loc.id} не найдена на canvas`);
        }
      });
      locs.appendChild(btn);
    }
    item.appendChild(locs);

    summary.addEventListener('click', () => {
      // focus first location of this trace on canvas
      const first = (trace.locations || [])[0];
      if (!first) return;
      const node = state.nodes.find(
        (n) => n.locationId === first.id || n.traceId === String(trace.id)
      );
      if (node) select('node', node.id);
    });

    actsList.appendChild(item);
  }
}

function emptyReadyCanvas() {
  state.nodes = [];
  state.edges = [];
  state.view = { x: 220, y: 120, scale: 1 };
  state.codemap = null;
  clearSelection();
  renderActsList(null);
  render();
}

async function openProject() {
  try {
    const result = await window.electronAPI.openProject();
    if (result.canceled) return;

    state.meta.sourceFolder = result.folderPath;
    state.meta.name = `${result.folderName || 'workspace'}.canvas`;
    state.projectReady = true;
    hideSplash();

    if (result.corrupt) {
      state.cacheHit = false;
      emptyReadyCanvas();
      updateProjectChrome();
      setStatus(`Кэш повреждён: ${result.cacheError || 'ошибка JSON'}. Нужна перегенерация.`);
      return;
    }

    if (result.cacheHit && result.canvas) {
      state.cacheHit = true;
      state.codemap = result.codemap || null;
      if (result.codemap?.query && codemapQueryInput) {
        codemapQueryInput.value = result.codemap.query;
      }
      loadCanvas(result.canvas);
      // ensure sourceFolder is the opened path even if metadata differs
      state.meta.sourceFolder = result.folderPath;
      renderActsList(state.codemap);
      fitView();
      updateProjectChrome();
      setStatus(`Открыт сохранённый codemap · ${result.cacheFiles?.canvas || '.code-canvas.canvas'}`);
      return;
    }

    // cache miss — empty project, wait for generate (Phase 2)
    state.cacheHit = false;
    emptyReadyCanvas();
    if (codemapQueryInput && !codemapQueryInput.value.trim()) {
      codemapQueryInput.value = DEFAULT_QUERY;
    }
    updateProjectChrome();
    setStatus('Проект открыт · кэш не найден · задайте query и Generate');
  } catch (error) {
    setStatus(`Ошибка открытия проекта: ${error.message}`);
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
    state.projectReady = true;
    state.cacheHit = false;
    state.codemap = null;
    hideSplash();
    clearSelection();
    renderActsList(null);
    autoLayout();
    fitView();
    updateProjectChrome();
    setStatus(`Структурный import: файлов ${state.nodes.length}`);
  } catch (error) {
    setStatus(`Ошибка импорта: ${error.message}`);
  }
}

function resetCanvas() {
  const fresh = defaultCanvas();
  state.nodes = fresh.nodes;
  state.edges = fresh.edges;
  state.view = { x: 220, y: 120, scale: 1 };
  state.meta = {
    sourceFolder: state.meta.sourceFolder,
    name: 'Untitled.canvas',
    query: null,
    generatedAt: null
  };
  state.codemap = null;
  state.cacheHit = false;
  clearSelection();
  renderActsList(null);
  render();
  setStatus('Создан новый canvas (кэш проекта не затронут)');
}

async function loadSettingsIntoForm() {
  try {
    const settings = await window.electronAPI.getSettings();
    const settingsPath = await window.electronAPI.getSettingsPath();
    if (settingsApiKey) settingsApiKey.value = settings.openaiApiKey || '';
    if (settingsBaseUrl) settingsBaseUrl.value = settings.openaiBaseUrl || '';
    if (settingsModel) settingsModel.value = settings.model || '';
    if (settingsLanguage) settingsLanguage.value = settings.language || '';
    if (settingsPathLabel) settingsPathLabel.textContent = settingsPath;
    if (settingsKeyStatus) {
      settingsKeyStatus.textContent = settings.openaiApiKey
        ? 'Ключ: задан'
        : 'Ключ: не задан';
    }
  } catch (error) {
    setStatus(`Ошибка загрузки settings: ${error.message}`);
  }
}

async function saveSettingsFromForm() {
  try {
    await window.electronAPI.setSettings({
      openaiApiKey: settingsApiKey?.value?.trim() || '',
      openaiBaseUrl: settingsBaseUrl?.value?.trim() || '',
      model: settingsModel?.value?.trim() || '',
      language: settingsLanguage?.value?.trim() || ''
    });
    await loadSettingsIntoForm();
    setStatus('Настройки GPT сохранены (~/.cometix/codemap/settings.json)');
  } catch (error) {
    setStatus(`Ошибка сохранения settings: ${error.message}`);
  }
}

function focusSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panel.classList.add('panel-highlight');
    setTimeout(() => panel.classList.remove('panel-highlight'), 1200);
  }
  if (state.ui.rightSidebarCollapsed) toggleSidebar('right', false);
}

editorPanelCloseBtn.addEventListener('click', closeEditorPanel);

buttons.openProject?.addEventListener('click', openProject);
buttons.splashOpenProject?.addEventListener('click', openProject);
buttons.newCanvas.addEventListener('click', resetCanvas);
buttons.openCanvas.addEventListener('click', openCanvas);
buttons.saveCanvas.addEventListener('click', saveCanvas);
buttons.importProject.addEventListener('click', importProject);
buttons.autoLayout.addEventListener('click', autoLayout);
buttons.fitView.addEventListener('click', fitView);
buttons.settings?.addEventListener('click', () => {
  focusSettingsPanel();
  loadSettingsIntoForm();
});
buttons.settingsSave?.addEventListener('click', saveSettingsFromForm);
async function runCodemapGenerate({ overwrite = false } = {}) {
  if (!state.projectReady || !state.meta.sourceFolder) {
    setStatus('Сначала откройте папку проекта');
    return;
  }
  if (state.isGenerating) {
    setStatus('Генерация уже идёт…');
    return;
  }

  if (overwrite && state.cacheHit) {
    const ok = window.confirm(
      'Перегенерировать codemap? Файлы .code-canvas.canvas и .code-canvas.codemap.json в корне проекта будут перезаписаны.'
    );
    if (!ok) return;
  }

  const query = (codemapQueryInput?.value || '').trim() || DEFAULT_QUERY;
  state.isGenerating = true;
  updateProjectChrome();
  setStatus(`Генерация codemap… · ${query.slice(0, 60)}`);

  try {
    const result = await window.electronAPI.generateCodemap({ query, mode: 'smart' });
    if (!result.ok) {
      setStatus(`Ошибка генерации: ${result.error}`);
      if (String(result.error || '').toLowerCase().includes('api key')) {
        focusSettingsPanel();
      }
      return;
    }

    state.cacheHit = true;
    state.codemap = result.codemap;
    state.meta.query = query;
    state.meta.generatedAt = new Date().toISOString();
    loadCanvas(result.canvas);
    state.meta.sourceFolder = result.projectRoot || state.meta.sourceFolder;
    renderActsList(state.codemap);
    fitView();
    updateProjectChrome();
    setStatus(
      `Сгенерировано и сохранено в корень · traces: ${result.codemap?.traces?.length || 0} · .code-canvas.canvas`
    );
  } catch (error) {
    setStatus(`Ошибка генерации: ${error.message}`);
  } finally {
    state.isGenerating = false;
    updateProjectChrome();
  }
}

buttons.generateCodemap?.addEventListener('click', () => runCodemapGenerate({ overwrite: false }));
buttons.regenerateCodemap?.addEventListener('click', () => runCodemapGenerate({ overwrite: true }));

if (window.electronAPI.onCodemapProgress) {
  window.electronAPI.onCodemapProgress((payload) => {
    if (!payload || !payload.type) return;
    if (payload.type === 'phase') {
      setStatus(`Фаза: ${payload.phase} (stage ${payload.stageNumber})`);
    } else if (payload.type === 'trace') {
      setStatus(`Trace ${payload.traceId} · stage ${payload.stage} · ${payload.status}`);
    } else if (payload.type === 'tool') {
      setStatus(`Tool: ${payload.tool}`);
    } else if (payload.type === 'codemap-partial') {
      setStatus(`Структура: ${payload.title || '…'} · traces ${payload.traces}`);
    } else if (payload.type === 'error') {
      setStatus(`Ошибка: ${payload.error}`);
    }
  });
}
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
  if (payload.type === 'open-project') openProject();
  if (payload.type === 'import-project') importProject();
  if (payload.type === 'open-canvas') openCanvas();
  if (payload.type === 'save-canvas') saveCanvas();
  if (payload.type === 'open-settings') {
    focusSettingsPanel();
    loadSettingsIntoForm();
  }
});

async function init() {
  // Empty canvas until project is chosen (splash gate)
  state.nodes = [];
  state.edges = [];
  state.projectReady = false;
  state.cacheHit = false;
  showSplash();
  updateProjectChrome();
  renderInspector();
  render();
  renderActsList(null);

  if (codemapQueryInput) codemapQueryInput.value = DEFAULT_QUERY;

  await loadSettingsIntoForm();

  const version = await window.electronAPI.getVersion().catch(() => 'dev');
  setStatus(`Выберите папку проекта · v${version}`);
}

init();
