// Drag-to-reorder for a vertical list. Rows carry data-index; a handle starts the
// drag (touch, pen or mouse). Arrow keys on a focused handle move a row too.

/**
 * @param {HTMLElement} list
 * @param {{ handle: string, onMove: (from: number, to: number) => void }} opts
 */
export function makeReorderable(list, { handle, onMove }) {
  let drag = null;

  list.addEventListener('pointerdown', (e) => {
    const hEl = e.target.closest(handle);
    if (!hEl || !list.contains(hEl) || (e.button !== undefined && e.button !== 0)) return;
    const row = hEl.closest('[data-index]');
    if (!row) return;
    e.preventDefault();
    const rows = Array.from(list.querySelectorAll(':scope > [data-index]'));
    const from = rows.indexOf(row);
    if (from < 0) return;
    try {
      hEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const rects = rows.map((r) => r.getBoundingClientRect());
    drag = { id: e.pointerId, hEl, row, rows, rects, from, to: from, startY: e.clientY };
    row.classList.add('dragging');
    list.classList.add('is-reordering');
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    const { rows, rects, from, row } = drag;
    row.style.transform = `translateY(${dy}px)`;
    const center = rects[from].top + rects[from].height / 2 + dy;
    let to = from;
    for (let i = 0; i < rects.length; i++) {
      const mid = rects[i].top + rects[i].height / 2;
      if (i < from && center < mid) {
        to = i;
        break;
      }
      if (i > from && center > mid) to = i;
    }
    drag.to = to;
    const hgt = rects[from].height;
    rows.forEach((r, i) => {
      if (r === row) return;
      let shift = 0;
      if (from < to && i > from && i <= to) shift = -hgt;
      if (from > to && i < from && i >= to) shift = hgt;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  });

  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const { rows, from, to, row } = drag;
    rows.forEach((r) => {
      r.style.transform = '';
    });
    row.classList.remove('dragging');
    list.classList.remove('is-reordering');
    drag = null;
    if (to !== from) onMove(from, to);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.to = drag.from;
    end(e);
  });

  list.addEventListener('keydown', (e) => {
    const hEl = e.target.closest(handle);
    if (!hEl || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const row = hEl.closest('[data-index]');
    const from = Number(row?.dataset.index);
    if (!Number.isInteger(from)) return;
    e.preventDefault();
    const to = e.key === 'ArrowUp' ? from - 1 : from + 1;
    if (to < 0 || to >= list.querySelectorAll(':scope > [data-index]').length) return;
    onMove(from, to);
    requestAnimationFrame(() => list.querySelector(`:scope > [data-index="${to}"] ${handle}`)?.focus());
  });
}
