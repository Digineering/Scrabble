// Pinch-to-zoom + pan for the board only. The rack and controls are outside
// the board viewport, so they're unaffected. Single taps still fall through to
// the normal tile-placement click handler.

export function enableBoardZoom(viewport, board) {
  let scale = 1, tx = 0, ty = 0;
  const MIN = 1, MAX = 3;
  const pointers = new Map();
  let pinch = null;     // { dist, bx, by } captured at pinch start
  let panLast = null;   // last pointer position while panning
  let moved = false;    // gesture moved -> suppress the trailing click

  const vw = () => viewport.clientWidth;
  const vh = () => viewport.clientHeight;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (p) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });

  function pos(e) {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function clamp() {
    tx = Math.min(0, Math.max(vw() * (1 - scale), tx));
    ty = Math.min(0, Math.max(vh() * (1 - scale), ty));
  }
  function apply() {
    clamp();
    board.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    viewport.classList.toggle('zoomed', scale > 1.001);
  }
  // Zoom keeping the board point under (pivotX,pivotY) fixed.
  function zoomTo(next, pivotX, pivotY) {
    next = Math.min(MAX, Math.max(MIN, next));
    const bx = (pivotX - tx) / scale;
    const by = (pivotY - ty) / scale;
    scale = next;
    tx = pivotX - bx * scale;
    ty = pivotY - by * scale;
    if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; }
    apply();
  }

  viewport.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, pos(e));
    moved = false;
    if (pointers.size === 2) {
      const p = [...pointers.values()];
      const m = mid(p);
      pinch = { dist: dist(p[0], p[1]), bx: (m.x - tx) / scale, by: (m.y - ty) / scale };
      panLast = null;
    } else if (pointers.size === 1) {
      panLast = scale > 1 ? pos(e) : null;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, pos(e));
    if (pointers.size === 2 && pinch) {
      const p = [...pointers.values()];
      const m = mid(p);
      scale = Math.min(MAX, Math.max(MIN, dist(p[0], p[1]) / pinch.dist));
      tx = m.x - pinch.bx * scale;
      ty = m.y - pinch.by * scale;
      if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; }
      apply();
      moved = true;
      e.preventDefault();
    } else if (pointers.size === 1 && panLast && scale > 1) {
      const p = pos(e);
      tx += p.x - panLast.x;
      ty += p.y - panLast.y;
      panLast = p;
      apply();
      moved = true;
      e.preventDefault();
    }
  }, { passive: false });

  function end(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      const id = [...pointers.keys()][0];
      panLast = scale > 1 ? pointers.get(id) : null;
    } else if (pointers.size === 0) {
      panLast = null;
    }
  }
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // Swallow the click that follows a pan/pinch so it doesn't place a tile.
  viewport.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
  }, true);

  // Desktop: wheel / trackpad zoom around the cursor.
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pos(e);
    zoomTo(scale * (e.deltaY < 0 ? 1.12 : 0.89), p.x, p.y);
  }, { passive: false });

  return {
    zoomIn: () => zoomTo(scale * 1.4, vw() / 2, vh() / 2),
    zoomOut: () => zoomTo(scale / 1.4, vw() / 2, vh() / 2),
    reset: () => zoomTo(1, vw() / 2, vh() / 2),
  };
}
