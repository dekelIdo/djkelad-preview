// Pure mixer math: crossfader law, transition curves, filter mapping, tempo.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Equal-power crossfader: x = 0 is full Deck A, x = 1 full Deck B. */
export function equalPower(x) {
  const t = clamp(x, 0, 1);
  return { a: Math.cos((t * Math.PI) / 2), b: Math.sin((t * Math.PI) / 2) };
}

/** Smoothstep easing used for automatic transitions. */
export function smoothstep(t) {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

/** Crossfader position at progress p (0..1) of a transition. */
export function transitionPosition(from, to, p) {
  return from + (to - from) * smoothstep(p);
}

/**
 * Gain curves for a transition, ready for AudioParam.setValueCurveAtTime.
 * @returns {{ a: Float32Array, b: Float32Array }}
 */
export function transitionCurves(from, to, points = 96) {
  const a = new Float32Array(points);
  const b = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const g = equalPower(transitionPosition(from, to, i / (points - 1)));
    a[i] = g.a;
    b[i] = g.b;
  }
  return { a, b };
}

/**
 * One-knob filter: -1 = low-pass closed (dark), 0 = open, +1 = high-pass (thin).
 * Exponential sweeps sound even across the knob.
 */
export function filterFrequencies(v) {
  const k = clamp(v, -1, 1);
  const dead = 0.04;
  let lp = 20000;
  let hp = 20;
  if (k < -dead) {
    const t = (-k - dead) / (1 - dead);
    lp = 20000 * Math.pow(180 / 20000, t);
  } else if (k > dead) {
    const t = (k - dead) / (1 - dead);
    hp = 20 * Math.pow(6000 / 20, t);
  }
  return { lp, hp };
}

export const dbToGain = (db) => Math.pow(10, db / 20);

/** Tempo fader percent (-8..+8 by default) to playback rate. */
export const rateFromTempo = (percent) => 1 + percent / 100;

/**
 * Tempo percent that makes a deck with `sourceBpm` play at `targetBpm`,
 * limited to the fader range. Returns null when BPMs are unknown.
 */
export function matchTempo(targetBpm, sourceBpm, range = 8) {
  if (!(targetBpm > 0) || !(sourceBpm > 0)) return null;
  let ratio = targetBpm / sourceBpm;
  // Allow half/double time matches (e.g. 70 vs 140 BPM).
  if (ratio > 1.5) ratio /= 2;
  else if (ratio < 0.75) ratio *= 2;
  const percent = (ratio - 1) * 100;
  if (Math.abs(percent) > range) return null;
  return Math.round(percent * 100) / 100;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
