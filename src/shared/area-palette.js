// src/shared/area-palette.js
//
// Single source of truth for the Windsurf-style area palette, shared between
// the main-process codemap adapter (CommonJS require) and the renderer
// (loaded via <script> — exposes window.CodeCanvasPalette).
//
// Order matches mermaidColorize / mermaidPlaceholders.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // main process / node
  } else {
    root.CodeCanvasPalette = api; // renderer (window)
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

  return { TRACE_AREA_PALETTE, paletteForIndex };
});
