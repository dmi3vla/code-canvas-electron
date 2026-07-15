/**
 * Browser bundle entry for Mermaid panel (esbuild → dist/mermaid.bundle.js).
 * Exposes window.CodeCanvasMermaid
 */
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';

const PLACEHOLDER_COLORS = [
  '#a5d8ff',
  '#ffd8a8',
  '#d0bfff',
  '#b2f2bb',
  '#fcc2d7',
  '#ffec99',
  '#99e9f2',
  '#eebefa'
];

const THEME_ACCENTS = [
  '#59a4ff',
  '#ffb86b',
  '#c4a0ff',
  '#6ee7a8',
  '#ff7aa2',
  '#f5e06a',
  '#5ed7e0',
  '#e8a0f0'
];

let initialized = false;
let panZoomInstance = null;
let renderSeq = 0;

function applyPlaceholderTheme(code) {
  let out = code;
  PLACEHOLDER_COLORS.forEach((hex, i) => {
    const accent = THEME_ACCENTS[i % THEME_ACCENTS.length];
    out = out.split(hex).join(`${accent},fill-opacity:0.22`);
  });
  return out;
}

function extractStepLabel(text) {
  const match = String(text || '')
    .trim()
    .match(/^(\d+[a-z]):/i);
  return match ? match[1].toLowerCase() : null;
}

function attachNodeClicks(svgElement, onNodeClick) {
  if (!onNodeClick || !svgElement) return;
  const nodes = svgElement.querySelectorAll('g.node');
  nodes.forEach((node) => {
    const label = extractStepLabel(node.textContent || '');
    if (!label) return;
    node.style.cursor = 'pointer';
    node.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onNodeClick(label);
    });
  });
}

async function ensureInit() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    flowchart: { htmlLabels: true, curve: 'basis' }
  });
  initialized = true;
}

/**
 * @param {HTMLElement} container
 * @param {string} code
 * @param {{ onNodeClick?: (stepLabel: string) => void }} [options]
 */
async function render(container, code, options = {}) {
  if (!container) return;
  const seq = ++renderSeq;
  container.innerHTML = '<div class="mermaid-loading">Рендер Mermaid…</div>';

  if (!code || !String(code).trim()) {
    container.innerHTML = '<div class="mermaid-empty">Нет mermaidDiagram. Нажмите «Сгенерировать mermaid».</div>';
    return;
  }

  await ensureInit();
  if (seq !== renderSeq) return;

  if (panZoomInstance) {
    try {
      panZoomInstance.destroy();
    } catch {
      /* ignore */
    }
    panZoomInstance = null;
  }

  const themed = applyPlaceholderTheme(String(code).trim());
  const id = `mmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { svg } = await mermaid.render(id, themed);
    if (seq !== renderSeq) return;
    container.innerHTML = svg;
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      svgEl.style.maxWidth = '100%';
      attachNodeClicks(svgEl, options.onNodeClick);
      try {
        panZoomInstance = svgPanZoom(svgEl, {
          zoomEnabled: true,
          controlIconsEnabled: true,
          fit: true,
          center: true,
          minZoom: 0.2,
          maxZoom: 8
        });
      } catch {
        /* pan-zoom optional */
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    container.innerHTML = `<div class="mermaid-error">Ошибка Mermaid: ${msg}</div>`;
  }
}

function destroy() {
  if (panZoomInstance) {
    try {
      panZoomInstance.destroy();
    } catch {
      /* ignore */
    }
    panZoomInstance = null;
  }
}

window.CodeCanvasMermaid = { render, destroy, applyPlaceholderTheme };
