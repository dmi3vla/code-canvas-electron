const electron = require('electron');

// ELECTRON_RUN_AS_NODE=1 makes require('electron') return a path string (Node mode).
// The app must run under the real Electron runtime.
if (!electron || typeof electron !== 'object' || !electron.app) {
  console.error(
    '[code-canvas] Electron APIs unavailable (app is undefined).\n' +
      'Usually caused by ELECTRON_RUN_AS_NODE=1 in the environment.\n' +
      'Fix: ELECTRON_RUN_AS_NODE= npm start\n' +
      `Got: typeof electron = ${typeof electron}` +
      (typeof electron === 'string' ? ` (${electron})` : '')
  );
  process.exit(1);
}

const { app, BrowserWindow, dialog, ipcMain, Menu } = electron;
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
const {
  generateCodemap,
  retryTraceFromStage12Context,
  retryMermaidFromStage12Context,
  generateMermaidFromCodemapSnapshot
} = require('./src/agent/codemapAgent');
const { generateSuggestions } = require('./src/agent/suggestionAgent');
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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[code-canvas] did-fail-load', { code, desc, url });
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[code-canvas] render-process-gone', details);
  });

  win.on('unresponsive', () => {
    console.error('[code-canvas] window unresponsive');
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

process.on('uncaughtException', (err) => {
  console.error('[code-canvas] uncaughtException', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[code-canvas] unhandledRejection', err);
});

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

/**
 * Resolve the nearest dependencies of a file by parsing its own
 * import / require / #include statements (outgoing edges → header/interface
 * files the node uses). Returns a de-duplicated list of absolute paths that
 * exist on disk and resolve inside the open project sandbox.
 *
 * @param {string} absoluteFilePath absolute path of the source file
 * @param {string} content source text of the file
 * @param {number} [limit=8] maximum number of dependencies to return
 * @returns {Promise<string[]>} absolute paths of dependency files
 */
async function resolveNearestDependencies(absoluteFilePath, content, limit = 8) {
  const fromDir = path.dirname(absoluteFilePath);
  const raw = [];

  const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const pythonFromRegex = /^\s*from\s+([.\w]+)\s+import/gm;
  const pythonImportRegex = /^\s*import\s+([.\w]+)/gm;
  const includeRegex = /^\s*#\s*include\s+["<]([^">]+)[">]/gm;

  for (const m of content.matchAll(importRegex)) raw.push({ spec: m[1], lang: 'js' });
  for (const m of content.matchAll(requireRegex)) raw.push({ spec: m[1], lang: 'js' });
  for (const m of content.matchAll(dynamicImportRegex)) raw.push({ spec: m[1], lang: 'js' });
  for (const m of content.matchAll(pythonFromRegex)) raw.push({ spec: m[1], lang: 'py' });
  for (const m of content.matchAll(pythonImportRegex)) raw.push({ spec: m[1], lang: 'py' });
  for (const m of content.matchAll(includeRegex)) raw.push({ spec: m[1], lang: 'c' });

  const jsExts = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
  const jsIndex = ['index.js', 'index.ts', 'index.tsx', 'index.jsx'];
  const seen = new Set();
  const resolved = [];

  for (const { spec, lang } of raw) {
    if (resolved.length >= limit) break;
    const candidates = [];

    if (lang === 'js') {
      if (!spec.startsWith('.')) continue; // skip bare/package specifiers
      for (const ext of jsExts) candidates.push(path.resolve(fromDir, spec + ext));
      for (const idx of jsIndex) candidates.push(path.resolve(fromDir, spec, idx));
    } else if (lang === 'py') {
      if (!spec.startsWith('.')) continue;
      const rel = spec.replace(/\./g, path.sep);
      candidates.push(path.resolve(fromDir, `${rel}.py`));
      candidates.push(path.resolve(fromDir, rel, '__init__.py'));
    } else if (lang === 'c') {
      // headers are usually relative to the including file or a nearby include dir
      candidates.push(path.resolve(fromDir, spec));
      candidates.push(path.resolve(fromDir, 'include', spec));
      candidates.push(path.resolve(fromDir, '..', 'include', spec));
    }

    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      // sandbox: dependency must resolve inside the open project
      let safe;
      try {
        safe = resolveReadPath(candidate);
      } catch {
        continue;
      }
      let stat;
      try {
        stat = await fs.stat(safe);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      seen.add(candidate);
      resolved.push(safe);
      break; // first existing candidate for this spec wins
    }
  }

  return resolved.slice(0, limit);
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
 * Resolve a path for reading and enforce project sandbox.
 * Absolute paths (as produced by codemap locations) are allowed only if they
 * resolve inside the open project root — never trust .canvas path fields blindly.
 */
function resolveReadPath(targetPath, projectRoot = currentProjectPath) {
  if (!targetPath) throw new Error('path is required');

  const root = projectRoot || currentProjectPath;
  if (!root) {
    throw new Error('Open a project before reading files');
  }

  const rootResolved = path.resolve(root);
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(rootResolved, String(targetPath).replace(/^\.\//, ''));

  // path.relative escapes as ".." or absolute (other drive on Windows)
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path is outside the open project');
  }

  return resolved;
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

  let canvas = cache.canvas;
  let codemap = cache.codemap;
  let relayout = false;

  // Rebuild canvas from codemap so mermaid subgraphs → colored areas (Windsurf layout).
  // Prefer codemap when present; rewrite project cache if layout version is outdated.
  if (cache.cacheHit && codemap && Array.isArray(codemap.traces)) {
    try {
      // One-time upgrade to mermaid-subgraph areas (cacheVersion >= 3).
      // Do not force relayout when mermaid exists — preserves user drag positions.
      const needsRelayout =
        !canvas ||
        (canvas.metadata?.cacheVersion || 0) < 3 ||
        (codemap.mermaidDiagram && canvas.metadata?.layout !== 'mermaid-areas');

      if (needsRelayout) {
        canvas = codemapToCanvas(codemap, {
          sourceFolder: folderPath,
          query: codemap.query || null
        });
        await writeProjectCanvasCache(folderPath, canvas, codemap);
        relayout = true;
      }
    } catch (err) {
      console.warn('[project:open] relayout failed, using cached canvas:', err.message);
    }
  }

  return {
    canceled: false,
    folderPath,
    folderName: path.basename(folderPath),
    cacheHit: cache.cacheHit,
    corrupt: Boolean(cache.corrupt),
    cacheError: cache.error || null,
    canvas,
    codemap,
    relayout,
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
        // Live canvas layout by areas while generation runs (traces → areas;
        // mermaid subgraphs → Windsurf-style areas when present).
        try {
          const snapshot = JSON.parse(JSON.stringify(partial));
          const previewCanvas = codemapToCanvas(snapshot, {
            sourceFolder: currentProjectPath,
            query: q
          });
          sendProgress({
            type: 'canvas-preview',
            title: snapshot?.title,
            traces: snapshot?.traces?.length || 0,
            layout: previewCanvas.metadata?.layout || null,
            areaSource: previewCanvas.metadata?.areaSource || null,
            hasMermaid: Boolean(snapshot?.mermaidDiagram),
            canvas: previewCanvas,
            codemap: snapshot
          });
        } catch (err) {
          sendProgress({
            type: 'codemap-partial',
            title: partial?.title,
            traces: partial?.traces?.length || 0,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    });

    if (!codemap || !Array.isArray(codemap.traces) || codemap.traces.length === 0) {
      return { ok: false, error: 'Codemap generation returned empty result' };
    }

    // Final layout always via areas (mermaid subgraphs preferred, else traces)
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

    // Ensure UI ends on the same area layout as disk cache
    sendProgress({
      type: 'canvas-preview',
      title: codemapToSave.title,
      traces: codemapToSave.traces.length,
      layout: canvas.metadata?.layout || null,
      areaSource: canvas.metadata?.areaSource || null,
      hasMermaid: Boolean(codemapToSave.mermaidDiagram),
      canvas,
      codemap: codemapToSave,
      final: true
    });
    sendProgress({
      type: 'complete',
      traces: codemap.traces.length,
      layout: canvas.metadata?.layout || null
    });

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

/**
 * Retry a single trace (stages 3–5) and update project cache.
 */
ipcMain.handle('codemap:retryTrace', async (event, { traceId, codemap }) => {
  if (!currentProjectPath) return { ok: false, error: 'No project open' };
  if (!codemap?.stage12Context) {
    return { ok: false, error: 'stage12Context missing — regenerate the codemap first' };
  }
  if (isGenerating) return { ok: false, error: 'Generation already in progress' };

  refreshConfig();
  if (!isConfigured()) {
    return { ok: false, error: 'API key not configured' };
  }

  isGenerating = true;
  const sendProgress = (payload) => {
    try {
      event.sender.send('codemap:progress', payload);
    } catch {
      /* ignore */
    }
  };

  try {
    sendProgress({ type: 'phase', phase: `Retry trace ${traceId}`, stageNumber: 3 });
    const result = await retryTraceFromStage12Context(traceId, codemap.stage12Context, {
      onTraceProcessing: (tid, stage, status) => {
        sendProgress({ type: 'trace', traceId: tid, stage, status });
      }
    });

    if (result.error) return { ok: false, error: result.error };

    const next = JSON.parse(JSON.stringify(codemap));
    const trace = (next.traces || []).find((t) => String(t.id) === String(traceId));
    if (!trace) return { ok: false, error: `Trace not found: ${traceId}` };
    if (result.diagram) trace.traceTextDiagram = result.diagram;
    if (result.guide) trace.traceGuide = result.guide;
    next.updatedAt = new Date().toISOString();

    // Keep canvas layout; only codemap sidecar changes for trace text/guide
    const cache = await readProjectCache(currentProjectPath);
    const canvas = cache.canvas || codemapToCanvas(next, { sourceFolder: currentProjectPath });
    await writeProjectCanvasCache(currentProjectPath, canvas, next);

    return { ok: true, codemap: next, canvas };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    isGenerating = false;
  }
});

/**
 * Generate or regenerate mermaid diagram for current codemap.
 */
ipcMain.handle('codemap:retryMermaid', async (event, { codemap, force = true }) => {
  if (!currentProjectPath) return { ok: false, error: 'No project open' };
  if (!codemap) return { ok: false, error: 'codemap is required' };
  if (isGenerating) return { ok: false, error: 'Generation already in progress' };

  if (!force && codemap.mermaidDiagram && String(codemap.mermaidDiagram).trim()) {
    return { ok: true, codemap, skipped: true };
  }

  refreshConfig();
  if (!isConfigured()) {
    return { ok: false, error: 'API key not configured' };
  }

  isGenerating = true;
  const sendProgress = (payload) => {
    try {
      event.sender.send('codemap:progress', payload);
    } catch {
      /* ignore */
    }
  };

  try {
    sendProgress({ type: 'phase', phase: 'Mermaid Diagram', stageNumber: 6 });
    const result = codemap.stage12Context
      ? await retryMermaidFromStage12Context(codemap.stage12Context)
      : await generateMermaidFromCodemapSnapshot(codemap);

    if (result.error) return { ok: false, error: result.error };
    if (!result.diagram) return { ok: false, error: 'No mermaid diagram returned' };

    const next = {
      ...codemap,
      mermaidDiagram: result.diagram,
      updatedAt: new Date().toISOString()
    };

    const canvas = codemapToCanvas(next, {
      sourceFolder: currentProjectPath,
      query: next.query || null
    });
    await writeProjectCanvasCache(currentProjectPath, canvas, next);

    sendProgress({
      type: 'canvas-preview',
      title: next.title,
      traces: next.traces?.length || 0,
      layout: canvas.metadata?.layout || null,
      hasMermaid: true,
      canvas,
      codemap: next,
      final: true
    });

    return { ok: true, codemap: next, canvas };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    isGenerating = false;
  }
});

/**
 * Suggest codemap topics from recent file paths.
 */
ipcMain.handle('suggestions:generate', async (_, { recentFiles }) => {
  refreshConfig();
  if (!isConfigured()) return { ok: true, suggestions: [] };
  try {
    const suggestions = await generateSuggestions(recentFiles || []);
    return { ok: true, suggestions };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), suggestions: [] };
  }
});

/**
 * Chat: send a message to the codemap agent (conversational mode).
 * Uses the existing agent configuration (same API key/model).
 */
ipcMain.handle('agent:chatMessage', async (event, { message, context }) => {
  if (!isConfigured()) {
    return { ok: false, error: 'API key not configured' };
  }

  const { generateText } = require('ai');
  const { getOpenAIClient, getModelName, getLanguage } = require('./src/agent/baseClient');
  const { loadPrompt } = require('./src/agent/prompts');
  const { formatCurrentDate, getUserOs } = require('./src/agent/utils');

  const client = getOpenAIClient();
  const language = getLanguage();

  let systemPrompt = loadPrompt('smart', 'system', {
    current_date: formatCurrentDate(),
    user_os: getUserOs(),
    language,
    workspace_path: currentProjectPath || 'не выбран'
  });

  // Add conversational instruction
  systemPrompt += '\n\n' + [
    'Ты — ассистент по архитектуре кода в Code Canvas. Отвечай на русском.',
    'Отвечай кратко и по делу. Если пользователь спрашивает про конкретную ноду или файл,',
    'используй контекст, переданный в сообщении.',
    'Ты можешь предложить пользователю сгенерировать codemap (команда Generate) для анализа проекта.',
    'Не используй инструменты (tools) в разговорном режиме — только текст.'
  ].join(' ');

  const messages = [{ role: 'system', content: systemPrompt }];

  if (context) {
    messages.push({
      role: 'user',
      content: `Контекст: ${context}`
    });
  }

  messages.push({ role: 'user', content: message });

  const sendChunk = (chunk) => {
    try {
      event.sender.send('agent:chatChunk', chunk);
    } catch {
      /* ignore */
    }
  };

  try {
    const result = await generateText({
      model: client(getModelName()),
      messages,
      onFinish: (params) => {
        sendChunk({ type: 'finish', finishReason: params.finishReason });
      }
    });

    // Stream chunks manually by character-level splitting (simple approach)
    const fullText = result.text || '';
    // Send complete text as one chunk for simplicity
    sendChunk({ type: 'text', content: fullText });

    return { ok: true, text: fullText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendChunk({ type: 'error', error: message });
    return { ok: false, error: message };
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

/**
 * Open a file together with its nearest dependencies (header/interface files
 * it imports). Returns the main file first, then up to `limit` dependency files
 * that exist inside the project sandbox.
 */
ipcMain.handle('file:readWithDeps', async (_, targetPath, limit = 8) => {
  const absolute = resolveReadPath(targetPath);
  const content = await fs.readFile(absolute, 'utf8');
  const main = { path: absolute, content };

  let dependencies = [];
  try {
    const depPaths = await resolveNearestDependencies(absolute, content, limit);
    dependencies = await Promise.all(
      depPaths.map(async (depPath) => ({
        path: depPath,
        content: await fs.readFile(depPath, 'utf8')
      }))
    );
  } catch {
    dependencies = [];
  }

  return { main, dependencies };
});

ipcMain.handle('file:writeText', async (_, targetPath, content) => {
  const absolute = resolveReadPath(targetPath);
  await fs.writeFile(absolute, String(content ?? ''), 'utf8');
  return { path: absolute };
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
