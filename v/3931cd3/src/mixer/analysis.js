// Pure audio analysis on decoded PCM: waveform peaks and a BPM estimate.

export const PEAKS_PER_SECOND = 100;

/**
 * Peak amplitude per bucket (mono), PEAKS_PER_SECOND buckets per second.
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 */
export function computePeaks(channels, sampleRate, perSecond = PEAKS_PER_SECOND) {
  const length = channels[0]?.length || 0;
  const bucket = Math.max(1, Math.floor(sampleRate / perSecond));
  const count = Math.ceil(length / bucket);
  const peaks = new Float32Array(count);
  const chs = channels.slice(0, 2);
  for (let b = 0; b < count; b++) {
    const start = b * bucket;
    const end = Math.min(length, start + bucket);
    let max = 0;
    for (const ch of chs) {
      // Stride 2 keeps this fast on phones; the visual result is identical.
      for (let i = start; i < end; i += 2) {
        const v = ch[i] < 0 ? -ch[i] : ch[i];
        if (v > max) max = v;
      }
    }
    peaks[b] = max;
  }
  // Normalise so quiet masters still draw a readable waveform.
  let top = 0;
  for (let i = 0; i < count; i++) if (peaks[i] > top) top = peaks[i];
  if (top > 0 && top < 0.98) {
    const k = 1 / top;
    for (let i = 0; i < count; i++) peaks[i] = Math.min(1, peaks[i] * k);
  }
  return { perSecond: sampleRate / bucket, data: peaks };
}

/** Downsample peaks (max) to `width` columns. */
export function overviewPeaks(peaks, width) {
  const out = new Float32Array(Math.max(1, width));
  const n = peaks.length;
  if (!n) return out;
  for (let x = 0; x < out.length; x++) {
    const s = Math.floor((x / out.length) * n);
    const e = Math.max(s + 1, Math.floor(((x + 1) / out.length) * n));
    let m = 0;
    for (let i = s; i < e && i < n; i++) if (peaks[i] > m) m = peaks[i];
    out[x] = m;
  }
  return out;
}

/**
 * Onset-strength envelope: low-passed mono, framed energy, positive log-energy flux.
 * Returns { env: Float32Array, fps: number }.
 */
function onsetEnvelope(channels, sampleRate, startSample, lengthSamples) {
  const target = 11025;
  const factor = Math.max(1, Math.round(sampleRate / target));
  const sr = sampleRate / factor;
  const n = Math.floor(lengthSamples / factor);
  const mono = new Float32Array(n);
  const chs = channels.slice(0, 2);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const base = startSample + i * factor;
    for (const ch of chs) {
      for (let k = 0; k < factor; k++) acc += ch[base + k] || 0;
    }
    mono[i] = acc / (factor * chs.length);
  }
  const hop = 64;
  const win = 256;
  const frames = Math.floor((n - win) / hop);
  if (frames < 16) return { env: new Float32Array(0), fps: sr / hop };
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const o = f * hop;
    for (let i = 0; i < win; i++) {
      const v = mono[o + i];
      e += v * v;
    }
    energy[f] = Math.log(1 + 1000 * e);
  }
  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) env[f] = Math.max(0, energy[f] - energy[f - 1]);
  // Remove the slowly varying part (about 0.5 s moving average).
  const fps = sr / hop;
  const w = Math.max(3, Math.round(fps * 0.5));
  const out = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += env[f];
    if (f >= w) sum -= env[f - w];
    const mean = sum / Math.min(f + 1, w);
    out[f] = Math.max(0, env[f] - mean);
  }
  return { env: out, fps };
}

function autocorr(env, lag) {
  let s = 0;
  const n = env.length - lag;
  for (let i = 0; i < n; i++) s += env[i] * env[i + lag];
  return n > 0 ? s / n : 0;
}

/** Peak position refined by parabolic interpolation around integer lag. */
function refineLag(env, approx, radius) {
  let best = -Infinity;
  let bestLag = Math.round(approx);
  for (let l = Math.max(1, Math.round(approx - radius)); l <= Math.round(approx + radius); l++) {
    const v = autocorr(env, l);
    if (v > best) {
      best = v;
      bestLag = l;
    }
  }
  const y0 = autocorr(env, bestLag - 1);
  const y1 = best;
  const y2 = autocorr(env, bestLag + 1);
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return bestLag + Math.max(-0.5, Math.min(0.5, shift));
}

/**
 * Estimate tempo from the middle (up to 60 s) of a track.
 * @returns {{ bpm: number, confidence: number } | null}
 */
export function estimateBpm(channels, sampleRate, { minBpm = 70, maxBpm = 180 } = {}) {
  const length = channels[0]?.length || 0;
  const section = Math.min(length, Math.floor(sampleRate * 60));
  if (section < sampleRate * 6) return null;
  const start = Math.floor((length - section) / 2);
  const { env, fps } = onsetEnvelope(channels, sampleRate, start, section);
  if (env.length < fps * 4) return null;

  const minLag = Math.floor((60 * fps) / maxBpm);
  const maxLag = Math.ceil((60 * fps) / minBpm);
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let l = minLag; l <= Math.min(maxLag * 2 + 1, env.length - 1); l++) ac[l] = autocorr(env, l);

  let bestLag = 0;
  let bestScore = -Infinity;
  let sumScore = 0;
  let count = 0;
  for (let l = minLag; l <= maxLag; l++) {
    const bpm = (60 * fps) / l;
    // Gentle preference for the 90-150 BPM region where most dance music lives.
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 122) / 0.7, 2));
    const harmonic = ac[l] + 0.5 * (ac[2 * l] || 0);
    const score = harmonic * prior;
    sumScore += score;
    count++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = l;
    }
  }
  if (!bestLag || bestScore <= 0) return null;

  // Refine over several beats for sub-frame accuracy.
  let lag = refineLag(env, bestLag, 1.5);
  for (const beats of [4, 8]) {
    if (lag * beats < env.length / 2) {
      lag = refineLag(env, lag * beats, 2.5) / beats;
    }
  }
  const bpm = (60 * fps) / lag;
  const mean = sumScore / Math.max(1, count);
  const confidence = mean > 0 ? Math.min(1, (bestScore / mean - 1) / 3) : 0;
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.round(confidence * 100) / 100 };
}
