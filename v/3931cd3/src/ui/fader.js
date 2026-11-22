// Live-safe fader: dragging moves it relative to where you touched, so a tap
// never makes it jump. Double-tap resets. Keyboard arrows work too.
import { h } from './dom.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {{
 *   orientation?: 'horizontal' | 'vertical',
 *   min?: number, max?: number, value?: number, step?: number, defaultValue?: number,
 *   label: string, className?: string, center?: boolean,
 *   format?: (v: number) => string,
 *   onInput?: (v: number) => void, onGrab?: () => void, onRelease?: () => void,
 * }} o
 */
export function createFader(o) {
  const orientation = o.orientation || 'horizontal';
  const min = o.min ?? 0;
  const max = o.max ?? 1;
  const step = o.step ?? (max - min) / 100;
  const defaultValue = o.defaultValue ?? o.value ?? min;
  let value = clamp(o.value ?? defaultValue, min, max);

  const fill = h('div', { class: 'fader-fill' });
  const thumb = h('div', { class: 'fader-thumb' });
  const track = h('div', { class: 'fader-track' }, o.center ? h('div', { class: 'fader-center' }) : null, fill, thumb);
  const el = h(
    'div',
    {
      class: `fader fader-${orientation} ${o.className || ''}`.trim(),
      role: 'slider',
      tabindex: '0',
      'aria-label': o.label,
      'aria-orientation': orientation,
      'aria-valuemin': String(min),
      'aria-valuemax': String(max),
    },
    track,
  );

  function frac() {
    return (value - min) / (max - min);
  }

  function render() {
    const f = frac();
    if (orientation === 'horizontal') {
      thumb.style.left = `${f * 100}%`;
      if (o.center) {
        const c = (0 - min) / (max - min);
        const lo = Math.min(c, f);
        fill.style.left = `${lo * 100}%`;
        fill.style.width = `${Math.abs(f - c) * 100}%`;
      } else {
        fill.style.left = '0';
        fill.style.width = `${f * 100}%`;
      }
    } else {
      thumb.style.bottom = `${f * 100}%`;
      fill.style.height = `${f * 100}%`;
    }
    el.setAttribute('aria-valuenow', String(Math.round(value * 1000) / 1000));
    el.setAttribute('aria-valuetext', o.format ? o.format(value) : String(Math.round(value * 100) / 100));
  }

  function set(v, emit = false) {
    const nv = clamp(Math.round(v / step) * step, min, max);
    if (nv === value && !emit) return;
    value = nv;
    render();
    if (emit) o.onInput?.(value);
  }

  let drag = null;
  let lastTap = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const now = performance.now();
    // Double-tap resets, but only two still taps: fast cuts on the crossfader must never snap it.
    if (now - lastTap < 320) {
      lastTap = 0;
      set(defaultValue, true);
      return;
    }
    const rect = track.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      start: orientation === 'horizontal' ? e.clientX : e.clientY,
      startValue: value,
      length: orientation === 'horizontal' ? rect.width : rect.height,
      t: now,
      moved: 0,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    el.classList.add('grabbed');
    el.focus({ preventScroll: true });
    o.onGrab?.();
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const pos = orientation === 'horizontal' ? e.clientX : e.clientY;
    drag.moved = Math.max(drag.moved, Math.abs(pos - drag.start));
    let delta = (pos - drag.start) / Math.max(1, drag.length);
    if (orientation === 'vertical') delta = -delta;
    set(drag.startValue + delta * (max - min), true);
  });

  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const still = drag.moved < 4 && performance.now() - drag.t < 260;
    lastTap = still ? performance.now() : 0;
    drag = null;
    el.classList.remove('grabbed');
    o.onRelease?.();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);

  el.addEventListener('keydown', (e) => {
    const big = (max - min) / 20;
    let handled = true;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + big, true);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - big, true);
    else if (e.key === 'Home') set(min, true);
    else if (e.key === 'End') set(max, true);
    else if (e.key === 'Enter' || e.key === ' ') set(defaultValue, true);
    else handled = false;
    if (handled) e.preventDefault();
  });

  render();
  return {
    el,
    get value() {
      return value;
    },
    get dragging() {
      return Boolean(drag);
    },
    set: (v) => set(v, false),
  };
}
