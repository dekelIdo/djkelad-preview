// Deck waveform: a zoomed, scrolling view centred on the playhead plus a
// full-track overview strip. Drawn on canvas from precomputed peaks.
import { overviewPeaks } from '../mixer/analysis.js';
import { h } from './dom.js';

const WINDOW_SECONDS = 8;

export function createWaveform({ color, dim, onSeek, onScrub }) {
  const main = h('canvas', { class: 'wave-main', 'aria-hidden': 'true' });
  const over = h('canvas', { class: 'wave-over', 'aria-hidden': 'true' });
  const overWrap = h('div', { class: 'wave-over-wrap', role: 'slider', 'aria-label': 'Track position', tabindex: '-1' }, over);
  const hud = h('div', { class: 'wave-hud' });
  const mainWrap = h('div', { class: 'wave-main-wrap' }, main, hud);
  const el = h('div', { class: 'wave' }, mainWrap, overWrap);
  let peaks = null;
  let overCache = null;
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let sizes = { mw: 0, mh: 0, ow: 0, oh: 0 };
  let lastDraw = { pos: -1, dur: -1, cue: -1, w: 0 };
  let duration = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const mw = Math.max(1, Math.round(main.clientWidth * dpr));
    const mh = Math.max(1, Math.round(main.clientHeight * dpr));
    const ow = Math.max(1, Math.round(over.clientWidth * dpr));
    const oh = Math.max(1, Math.round(over.clientHeight * dpr));
    if (mw !== sizes.mw || mh !== sizes.mh) {
      main.width = mw;
      main.height = mh;
    }
    if (ow !== sizes.ow || oh !== sizes.oh) {
      over.width = ow;
      over.height = oh;
      overCache = null;
    }
    sizes = { mw, mh, ow, oh };
    lastDraw.w = 0;
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(el);

  function buildOverview() {
    if (!peaks || !sizes.ow) return null;
    const cols = Math.max(1, Math.floor(sizes.ow / (2 * dpr)));
    return overviewPeaks(peaks.data, cols);
  }

  function draw(pos, dur, cue, playing) {
    duration = dur;
    if (!sizes.mw) resize();
    const { mw, mh, ow, oh } = sizes;
    if (pos === lastDraw.pos && dur === lastDraw.dur && cue === lastDraw.cue && lastDraw.w === mw) return;
    lastDraw = { pos, dur, cue, w: mw };

    // --- main (zoomed) ---
    const c = main.getContext('2d');
    c.clearRect(0, 0, mw, mh);
    const mid = mh / 2;
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(0, mid - 0.5 * dpr, mw, Math.max(1, dpr));
    if (peaks && dur > 0) {
      const secPerPx = WINDOW_SECONDS / mw;
      const bar = Math.max(1, Math.round(2 * dpr));
      const gap = Math.max(1, Math.round(1 * dpr));
      const stepPx = bar + gap;
      const half = mw / 2;
      const ps = peaks.perSecond;
      const data = peaks.data;
      for (let x = 0; x < mw; x += stepPx) {
        const t0 = pos + (x - half) * secPerPx;
        const t1 = t0 + stepPx * secPerPx;
        if (t1 < 0 || t0 > dur) continue;
        const i0 = Math.max(0, Math.floor(t0 * ps));
        const i1 = Math.min(data.length, Math.max(i0 + 1, Math.ceil(t1 * ps)));
        let m = 0;
        for (let i = i0; i < i1; i++) if (data[i] > m) m = data[i];
        const hgt = Math.max(dpr, Math.pow(m, 0.85) * (mh * 0.46));
        c.fillStyle = t0 < pos ? dim : color;
        c.fillRect(x, mid - hgt, bar, hgt * 2);
      }
      // Cue marker.
      if (cue >= 0) {
        const cx = half + (cue - pos) / secPerPx;
        if (cx >= 0 && cx <= mw) {
          c.fillStyle = '#F2C14E';
          c.fillRect(cx - dpr, 0, 2 * dpr, mh);
          c.beginPath();
          c.moveTo(cx - 5 * dpr, 0);
          c.lineTo(cx + 5 * dpr, 0);
          c.lineTo(cx, 6 * dpr);
          c.closePath();
          c.fill();
        }
      }
    }
    // Playhead.
    c.fillStyle = playing ? '#FFFFFF' : 'rgba(255,255,255,0.85)';
    c.fillRect(mw / 2 - dpr, 0, 2 * dpr, mh);

    // --- overview ---
    const o = over.getContext('2d');
    o.clearRect(0, 0, ow, oh);
    if (peaks && dur > 0) {
      if (!overCache) overCache = buildOverview();
      const cols = overCache.length;
      const colW = ow / cols;
      const played = pos / dur;
      for (let i = 0; i < cols; i++) {
        const hgt = Math.max(dpr, overCache[i] * oh);
        o.fillStyle = i / cols < played ? color : 'rgba(255,255,255,0.22)';
        o.fillRect(i * colW, oh - hgt, Math.max(1, colW - dpr * 0.5), hgt);
      }
      if (cue >= 0) {
        o.fillStyle = '#F2C14E';
        o.fillRect((cue / dur) * ow - dpr * 0.5, 0, Math.max(1, dpr), oh);
      }
      o.fillStyle = '#FFFFFF';
      o.fillRect(played * ow - dpr, 0, 2 * dpr, oh);
    }
  }

  // Overview: tap or drag to jump (absolute).
  let overDrag = null;
  const overSeek = (e) => {
    const r = over.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    onSeek?.(f * duration);
  };
  overWrap.addEventListener('pointerdown', (e) => {
    if (!peaks) return;
    e.preventDefault();
    overDrag = e.pointerId;
    try {
      overWrap.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    overSeek(e);
  });
  overWrap.addEventListener('pointermove', (e) => {
    if (overDrag === e.pointerId) overSeek(e);
  });
  const overEnd = () => {
    overDrag = null;
  };
  overWrap.addEventListener('pointerup', overEnd);
  overWrap.addEventListener('pointercancel', overEnd);

  // Main: drag to scrub (relative), used for setting a cue precisely.
  let scrub = null;
  main.addEventListener('pointerdown', (e) => {
    if (!peaks) return;
    e.preventDefault();
    scrub = { id: e.pointerId, x: e.clientX };
    try {
      main.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  main.addEventListener('pointermove', (e) => {
    if (!scrub || scrub.id !== e.pointerId) return;
    const dx = e.clientX - scrub.x;
    scrub.x = e.clientX;
    const secPerCssPx = WINDOW_SECONDS / Math.max(1, main.clientWidth);
    onScrub?.(-dx * secPerCssPx);
  });
  const scrubEnd = () => {
    scrub = null;
  };
  main.addEventListener('pointerup', scrubEnd);
  main.addEventListener('pointercancel', scrubEnd);

  return {
    el,
    hud,
    setPeaks(p) {
      peaks = p;
      overCache = null;
      lastDraw = { pos: -1, dur: -1, cue: -1, w: 0 };
    },
    draw,
    resize,
  };
}
