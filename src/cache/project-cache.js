/**
 * Project-root cache for semantic canvas + codemap.
 * Canonical files (plan):
 *   <projectRoot>/.code-canvas.canvas
 *   <projectRoot>/.code-canvas.codemap.json
 */

const fs = require('fs/promises');
const path = require('path');

const CANVAS_CACHE_NAME = '.code-canvas.canvas';
const CODEMAP_CACHE_NAME = '.code-canvas.codemap.json';

function canvasCachePath(projectRoot) {
  return path.join(projectRoot, CANVAS_CACHE_NAME);
}

function codemapCachePath(projectRoot) {
  return path.join(projectRoot, CODEMAP_CACHE_NAME);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) return null;
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    const err = new Error(`Corrupt cache JSON: ${filePath}: ${error.message}`);
    err.code = 'CACHE_CORRUPT';
    err.filePath = filePath;
    throw err;
  }
}

/**
 * Read project cache. Does not generate anything.
 * @returns {{ cacheHit: boolean, canvas?: object, codemap?: object|null, corrupt?: boolean, error?: string }}
 */
async function readProjectCache(projectRoot) {
  const canvasPath = canvasCachePath(projectRoot);
  const codemapPath = codemapCachePath(projectRoot);

  if (!(await pathExists(canvasPath))) {
    return { cacheHit: false, canvas: null, codemap: null };
  }

  try {
    const canvas = await readJsonIfExists(canvasPath);
    let codemap = null;
    try {
      codemap = await readJsonIfExists(codemapPath);
    } catch {
      // codemap optional; canvas is enough for view
      codemap = null;
    }
    return { cacheHit: true, canvas, codemap };
  } catch (error) {
    return {
      cacheHit: false,
      canvas: null,
      codemap: null,
      corrupt: true,
      error: error.message
    };
  }
}

async function writeProjectCanvasCache(projectRoot, canvasDoc, codemap) {
  if (!projectRoot) {
    throw new Error('writeProjectCanvasCache: projectRoot is required');
  }
  if (!canvasDoc) {
    throw new Error('writeProjectCanvasCache: canvasDoc is required');
  }

  const canvasPath = canvasCachePath(projectRoot);
  const payload = {
    ...canvasDoc,
    metadata: {
      ...(canvasDoc.metadata || {}),
      sourceFolder: projectRoot,
      generatedAt: canvasDoc.metadata?.generatedAt || new Date().toISOString(),
      cacheVersion: 1
    }
  };

  await fs.writeFile(canvasPath, JSON.stringify(payload, null, 2), 'utf8');

  let codemapPath = null;
  if (codemap) {
    codemapPath = codemapCachePath(projectRoot);
    await fs.writeFile(codemapPath, JSON.stringify(codemap, null, 2), 'utf8');
  }

  return { canvasPath, codemapPath };
}

async function deleteProjectCache(projectRoot) {
  const targets = [canvasCachePath(projectRoot), codemapCachePath(projectRoot)];
  for (const filePath of targets) {
    try {
      await fs.unlink(filePath);
    } catch {
      /* ignore missing */
    }
  }
}

module.exports = {
  CANVAS_CACHE_NAME,
  CODEMAP_CACHE_NAME,
  canvasCachePath,
  codemapCachePath,
  readProjectCache,
  writeProjectCanvasCache,
  deleteProjectCache
};
