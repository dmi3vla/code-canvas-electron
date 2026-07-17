/**
 * Zoom-to-area — декомпозиция узла на холсте.
 * Плавный зум к области (area) по клику на group-ноду.
 * Экспортируется в window.ZoomToArea.
 */
(function () {
  'use strict';

  /**
   * Вычисляет bounding box всех нод с указанным areaId.
   */
  function computeAreaBounds(areaId, nodes) {
    const children = nodes.filter(
      (n) => n.type !== 'group' && n.areaId === areaId
    );
    if (children.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of children) {
      const w = n.width || 300;
      const h = n.height || 180;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + w > maxX) maxX = n.x + w;
      if (n.y + h > maxY) maxY = n.y + h;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Вычисляет полный bounding box всего холста.
   */
  function computeFullBounds(nodes) {
    if (!nodes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const w = n.width || 300;
      const h = n.height || 180;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + w > maxX) maxX = n.x + w;
      if (n.y + h > maxY) maxY = n.y + h;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Вычисляет viewport (x, y, scale) для вписывания bounds в видимую область.
   */
  function fitViewportToBounds(bounds, viewportSize, padding) {
    padding = padding || 40;
    const scaleX = (viewportSize.width - padding * 2) / Math.max(1, bounds.width);
    const scaleY = (viewportSize.height - padding * 2) / Math.max(1, bounds.height);
    const scale = Math.min(scaleX, scaleY);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return {
      x: viewportSize.width / 2 - cx * scale,
      y: viewportSize.height / 2 - cy * scale,
      scale: Math.max(0.25, Math.min(2.5, scale))
    };
  }

  /**
   * Плавная анимация перехода между двумя viewport-состояниями.
   */
  function animateViewport(fromViewport, toViewport, duration, onFrame, onComplete) {
    var start = performance.now();
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function tick(now) {
      var elapsed = now - start;
      var progress = Math.min(1, elapsed / duration);
      var eased = easeOutCubic(progress);
      onFrame({
        x: fromViewport.x + (toViewport.x - fromViewport.x) * eased,
        y: fromViewport.y + (toViewport.y - fromViewport.y) * eased,
        scale: fromViewport.scale + (toViewport.scale - fromViewport.scale) * eased
      });
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else if (onComplete) {
        onComplete();
      }
    }
    requestAnimationFrame(tick);
  }

  window.ZoomToArea = {
    computeAreaBounds: computeAreaBounds,
    computeFullBounds: computeFullBounds,
    fitViewportToBounds: fitViewportToBounds,
    animateViewport: animateViewport
  };
})();
