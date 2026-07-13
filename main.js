const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const {
  initSettings,
  getSettings,
  setSetting,
  setSettings,
  getSettingsFilePath
} = require('./src/agent/settings');
const {
  readProjectCache,
  writeProjectCanvasCache,
  deleteProjectCache,
  CANVAS_CACHE_NAME,
  CODEMAP_CACHE_NAME
} = require('./src/cache/project-cache');
const { codemapToCanvas } = require('./src/builder/codemap-adapter');
const { generateCodemap } = require('./src/agent/codemapAgent');
const { isConfigured, refreshConfig } = require('./src/agent/baseClient');

/** @type {boolean} */
let isGenerating = false;

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.yaml',
  '.yml'
]);

const CODE_GRAPH_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py']);
const MAX_SCAN_FILES = 180;
const MAX_PREVIEW_CHARS = 2400;

/** @type {string|null} */
let currentProjectPath = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0b1020',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project Folder',
          click: () => win.webContents.send('menu-action', { type: 'open-project' })
        },
        {
          label: 'Import Project Graph (structural)',
          click: () => win.webContents.send('menu-action', { type: 'import-project' })
        },
        {
          label: 'Open Canvas',
          click: () => win.webContents.send('menu-action', { type: 'open-canvas' })
        },
        {
          label: 'Save Canvas',
          click: () => win.webContents.send('menu-action', { type: 'save-canvas' })
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          click: () => win.webContents.send('menu-action', { type: 'open-settings' })
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  initSettings();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function normalizeRel(baseDir, candidate) {
  let rel = path.relative(baseDir, candidate);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel.replace(/\\/g, '/');
}

function resolveImportPath(baseDir, fromFile, rawImport) {
  if (!rawImport || rawImport.startsWith('.') === false) return null;

  const fromDir = path.dirname(fromFile);
  const candidates = [
    rawImport,
    `${rawImport}.js`,
    `${rawImport}.jsx`,
    `${rawImport}.ts`,
    `${rawImport}.tsx`,
    `${rawImport}.mjs`,
    `${rawImport}.cjs`,
    `${rawImport}.py`,
    path.join(rawImport, 'index.js'),
    path.join(rawImport, 'index.ts'),
    path.join(rawImport, 'index.tsx'),
    path.join(rawImport, 'index.jsx'),
    path.join(rawImport, '__init__.py')
  ];

  const absoluteCandidates = candidates.map((candidate) => path.resolve(fromDir, candidate));
  return absoluteCandidates.map((abs) => normalizeRel(baseDir, abs));
}

function parseDependencies(baseDir, relPath, content) {
  const edges = [];
  const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const pythonImportRegex = /^\s*(?:from\s+([.\w/]+)\s+import|import\s+([.\w/]+))/gm;

  const collectors = [
    { regex: importRegex, type: 'import' },
    { regex: requireRegex, type: 'require' },
    { regex: dynamicImportRegex, type: 'dynamic-import' }
  ];

  for (const collector of collectors) {
    for (const match of content.matchAll(collector.regex)) {
      const targets = resolveImportPath(baseDir, path.join(baseDir, relPath), match[1]) || [];
      for (const target of targets) {
        edges.push({ from: relPath, to: target, kind: collector.type });
      }
    }
  }

  for (const match of content.matchAll(pythonImportRegex)) {
    const importPath = match[1] || match[2];
    if (!importPath || importPath.startsWith('.')) continue;
  }

  return edges;
}

async function listProjectFiles(dir, rootDir, bucket = []) {
  if (bucket.length >= MAX_SCAN_FILES) return bucket;
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (bucket.length >= MAX_SCAN_FILES) break;
    if (entry.name.startsWith('.git') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
      continue;
    }

    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listProjectFiles(absolute, rootDir, bucket);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    bucket.push({
      absolute,
      relative: path.relative(rootDir, absolute).replace(/\\/g, '/'),
      ext
    });
  }

  return bucket;
}

function makeGridPosition(index) {
  const columns = 4;
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: col * 360,
    y: row * 260
  };
}

async function scanProject(folderPath) {
  const fileEntries = await listProjectFiles(folderPath, folderPath);
  const nodes = [];
  const edges = [];
  const fileSet = new Set(fileEntries.map((file) => `./${file.relative}`));

  for (const [index, file] of fileEntries.entries()) {
    const content = await fs.readFile(file.absolute, 'utf8').catch(() => '');
    const position = makeGridPosition(index);
    const rel = `./${file.relative}`;

    nodes.push({
      id: `file-${index}`,
      type: 'file',
      title: path.basename(file.relative),
      subtitle: path.dirname(file.relative) === '.' ? 'workspace root' : path.dirname(file.relative),
      path: rel,
      language: file.ext.replace('.', '') || 'text',
      content: content.slice(0, MAX_PREVIEW_CHARS),
      x: position.x,
      y: position.y,
      width: 320,
      height: 210
    });

    if (CODE_GRAPH_EXTENSIONS.has(file.ext)) {
      const discoveredEdges = parseDependencies(folderPath, file.relative, content);
      for (const edge of discoveredEdges) {
        if (fileSet.has(edge.to)) {
          edges.push(edge);
        }
      }
    }
  }

  const pathToNodeId = new Map(nodes.map((node) => [node.path, node.id]));
  const normalizedEdges = [];
  const seen = new Set();

  for (const edge of edges) {
    const fromId = pathToNodeId.get(`./${edge.from}`);
    const toId = pathToNodeId.get(edge.to);
    if (!fromId || !toId || fromId === toId) continue;
    const key = `${fromId}:${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedEdges.push({
      id: `edge-${normalizedEdges.length + 1}`,
      fromNode: fromId,
      fromSide: 'right',
      toNode: toId,
      toSide: 'left',
      label: edge.kind
    });
  }

  return {
    folderName: path.basename(folderPath),
    nodes,
    edges: normalizedEdges
  };
}

/**
 * Resolve a file path for reading: absolute as-is, relative via project root.
 */
function resolveReadPath(targetPath, projectRoot = currentProjectPath) {
  if (!targetPath) throw new Error('path is required');
  if (path.isAbsolute(targetPath)) return targetPath;
  const root = projectRoot || currentProjectPath;
  if (!root) throw new Error('relative path requires an open project');
  // strip leading ./
  const cleaned = targetPath.replace(/^\.\//, '');
  return path.resolve(root, cleaned);
}

// ─── Project open (cache-first) ─────────────────────────────────

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const folderPath = result.filePaths[0];
  currentProjectPath = folderPath;

  const cache = await readProjectCache(folderPath);

  return {
    canceled: false,
    folderPath,
    folderName: path.basename(folderPath),
    cacheHit: cache.cacheHit,
    corrupt: Boolean(cache.corrupt),
    cacheError: cache.error || null,
    canvas: cache.canvas,
    codemap: cache.codemap,
    cacheFiles: {
      canvas: CANVAS_CACHE_NAME,
      codemap: CODEMAP_CACHE_NAME
    }
  };
});

ipcMain.handle('project:getCurrent', () => {
  if (!currentProjectPath) return null;
  return {
    path: currentProjectPath,
    name: path.basename(currentProjectPath)
  };
});

ipcMain.handle('project:writeCache', async (_, { canvas, codemap }) => {
  if (!currentProjectPath) {
    throw new Error('No project open');
  }
  const written = await writeProjectCanvasCache(currentProjectPath, canvas, codemap);
  return { ok: true, ...written, projectRoot: currentProjectPath };
});

ipcMain.handle('project:deleteCache', async () => {
  if (!currentProjectPath) {
    throw new Error('No project open');
  }
  await deleteProjectCache(currentProjectPath);
  return { ok: true };
});

// Apply offline codemap fixture → canvas + write cache
ipcMain.handle('codemap:applyAndCache', async (_, { codemap, query }) => {
  if (!currentProjectPath) {
    throw new Error('No project open');
  }
  if (!codemap) {
    throw new Error('codemap is required');
  }

  const canvas = codemapToCanvas(codemap, {
    sourceFolder: currentProjectPath,
    query: query || codemap.query || null
  });

  const codemapToSave = {
    ...codemap,
    query: query || codemap.query || null,
    workspacePath: currentProjectPath
  };

  const written = await writeProjectCanvasCache(currentProjectPath, canvas, codemapToSave);
  return {
    ok: true,
    canvas,
    codemap: codemapToSave,
    ...written,
    projectRoot: currentProjectPath
  };
});

/**
 * Full GPT generate → codemapToCanvas → write project root cache.
 * Progress events: codemap:progress on the requesting webContents.
 */
ipcMain.handle('codemap:generate', async (event, { query, mode = 'smart' }) => {
  if (!currentProjectPath) {
    return { ok: false, error: 'No project open' };
  }
  if (isGenerating) {
    return { ok: false, error: 'Generation already in progress' };
  }

  refreshConfig();
  if (!isConfigured()) {
    return {
      ok: false,
      error: 'API key not configured. Set key in Settings (~/.cometix/codemap/settings.json)'
    };
  }

  const q = (query || '').trim() || 'Обзор архитектуры и основных потоков выполнения';
  isGenerating = true;

  const sendProgress = (payload) => {
    try {
      event.sender.send('codemap:progress', payload);
    } catch {
      /* window closed */
    }
  };

  try {
    sendProgress({ type: 'start', query: q, mode });

    const codemap = await generateCodemap(q, currentProjectPath, mode === 'fast' ? 'fast' : 'smart', {
      onPhaseChange: (phase, stageNumber) => {
        sendProgress({ type: 'phase', phase, stageNumber });
      },
      onTraceProcessing: (traceId, stage, status) => {
        sendProgress({ type: 'trace', traceId, stage, status });
      },
      onMessage: (role, content) => {
        sendProgress({
          type: 'message',
          role,
          content: String(content || '').slice(0, 1500)
        });
      },
      onToolCall: (tool, args, result) => {
        sendProgress({
          type: 'tool',
          tool,
          args: String(args || '').slice(0, 400),
          result: String(result || '').slice(0, 400)
        });
      },
      onCodemapUpdate: (partial) => {
        sendProgress({
          type: 'codemap-partial',
          title: partial?.title,
          traces: partial?.traces?.length || 0
        });
      }
    });

    if (!codemap || !Array.isArray(codemap.traces) || codemap.traces.length === 0) {
      return { ok: false, error: 'Codemap generation returned empty result' };
    }

    const canvas = codemapToCanvas(codemap, {
      sourceFolder: currentProjectPath,
      query: q
    });

    const codemapToSave = {
      ...codemap,
      query: q,
      workspacePath: currentProjectPath
    };

    const written = await writeProjectCanvasCache(currentProjectPath, canvas, codemapToSave);
    sendProgress({ type: 'complete', traces: codemap.traces.length });

    return {
      ok: true,
      canvas,
      codemap: codemapToSave,
      ...written,
      projectRoot: currentProjectPath
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendProgress({ type: 'error', error: message });
    return { ok: false, error: message };
  } finally {
    isGenerating = false;
  }
});

// Legacy structural import (file graph) — kept as menu fallback
ipcMain.handle('dialog:pickProject', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const folderPath = result.filePaths[0];
  currentProjectPath = folderPath;
  const graph = await scanProject(folderPath);
  return {
    canceled: false,
    folderPath,
    ...graph
  };
});

ipcMain.handle('dialog:saveCanvas', async (_, canvasData) => {
  const result = await dialog.showSaveDialog({
    defaultPath: currentProjectPath
      ? path.join(currentProjectPath, 'workspace.canvas')
      : 'workspace.canvas',
    filters: [{ name: 'Canvas', extensions: ['canvas', 'json'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, JSON.stringify(canvasData, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('dialog:openCanvas', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Canvas', extensions: ['canvas', 'json'] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf8');
  return {
    canceled: false,
    filePath,
    data: JSON.parse(content)
  };
});

ipcMain.handle('file:readText', async (_, targetPath) => {
  const absolute = resolveReadPath(targetPath);
  const content = await fs.readFile(absolute, 'utf8');
  return { content, path: absolute };
});

// ─── Settings (windsurf-compatible) ─────────────────────────────

ipcMain.handle('settings:get', () => getSettings());

ipcMain.handle('settings:set', (_, key, value) => {
  if (typeof key === 'object' && key !== null) {
    return setSettings(key);
  }
  return setSetting(key, value);
});

ipcMain.handle('settings:getPath', () => getSettingsFilePath());

ipcMain.handle('app:getVersion', () => app.getVersion());
