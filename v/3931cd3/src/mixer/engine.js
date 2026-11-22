// The local mixer: two decks, equal-power crossfader, automatic transitions,
// master limiter and master-bus recording. Everything runs in the browser.
import { Deck } from './deck.js';
import { clamp, equalPower, transitionCurves, transitionPosition } from './curves.js';
import { computePeaks, estimateBpm } from './analysis.js';
import { createRecorder } from './recorder.js';
import { setPlaybackAudioSession } from '../platform.js';

function decode(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    // Old Safari only supports the callback form; modern browsers return a promise too.
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * @param {{ beforePlay?: (deck: Deck) => boolean | void }} options
 */
export function createMixerEngine(options = {}) {
  const decks = { A: new Deck('A'), B: new Deck('B') };
  const listeners = new Set();
  let ctx = null;
  let master = null;
  let xfader = 0.5;
  let auto = null;
  let masterVolume = 0.9;
  let recorder = null;
  let recordingStarting = false;
  let meterBuf = null;

  const emit = (type = 'change', detail = null) => {
    for (const fn of listeners) fn(type, detail);
  };

  for (const d of Object.values(decks)) {
    d.beforePlay = (deck) => {
      if (options.beforePlay && options.beforePlay(deck) === false) return false;
      engine.unlock();
      return true;
    };
    d.on((type) => {
      if (type === 'ended' && auto && auto.outgoingId === d.id) finishAuto();
      if (type === 'ended') emit('ended', { deck: d.id });
      else emit('change');
    });
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser has no Web Audio support.');
    ctx = new AC({ latencyHint: 'interactive' });
    const input = ctx.createGain();
    input.gain.value = masterVolume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const out = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    input.connect(limiter);
    limiter.connect(out);
    out.connect(ctx.destination);
    out.connect(analyser);
    master = { input, limiter, out, analyser };
    meterBuf = new Float32Array(analyser.fftSize);
    decks.A.attach(ctx, input);
    decks.B.attach(ctx, input);
    applyCrossfader(xfader, true);
    ctx.onstatechange = () => emit('change');
    return ctx;
  }

  function gainParam(id) {
    return decks[id].nodes.xfade.gain;
  }

  function applyCrossfader(x, immediate = false) {
    if (!ctx) return;
    const g = equalPower(x);
    const now = ctx.currentTime;
    for (const [id, v] of [['A', g.a], ['B', g.b]]) {
      const p = gainParam(id);
      if (immediate) {
        p.cancelScheduledValues(now);
        p.setValueAtTime(v, now);
      } else {
        p.setTargetAtTime(v, now, 0.012);
      }
    }
  }

  function currentCrossfader() {
    if (!auto || !ctx) return xfader;
    const p = (ctx.currentTime - auto.t0) / auto.dur;
    return transitionPosition(auto.from, auto.to, clamp(p, 0, 1));
  }

  function cancelAuto() {
    if (!auto) return;
    const x = currentCrossfader();
    clearTimeout(auto.timer);
    auto = null;
    xfader = x;
    applyCrossfader(x, true);
    emit('change');
  }

  function finishAuto() {
    if (!auto) return;
    const a = auto;
    clearTimeout(a.timer);
    auto = null;
    xfader = a.to;
    applyCrossfader(xfader, true);
    const stopped = Boolean(a.stopOutgoing && decks[a.outgoingId].playing);
    if (stopped) decks[a.outgoingId].pause();
    emit('change');
    emit('automix-done', { from: a.outgoingId, to: a.incomingId, stopped: stopped || !decks[a.outgoingId].playing });
  }

  function automixTarget() {
    if (xfader < 0.5) return 'B';
    if (xfader > 0.5) return 'A';
    if (decks.A.playing && !decks.B.playing) return 'B';
    if (decks.B.playing && !decks.A.playing) return 'A';
    return 'B';
  }

  const engine = {
    decks,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get context() {
      return ctx;
    },
    get running() {
      return Boolean(ctx && ctx.state === 'running');
    },

    /** Call from a user gesture before any audio starts (iOS requirement). */
    unlock() {
      const c = ensureContext();
      setPlaybackAudioSession(true);
      if (c.state !== 'running') c.resume().catch(() => {});
      return c;
    },

    /** Release the audio session so Spotify (another app) can play. */
    async release() {
      if (!ctx) return;
      if (engine.isRecording) return;
      setPlaybackAudioSession(false);
      try {
        await ctx.suspend();
      } catch {
        /* ignore */
      }
    },

    /**
     * Decode and analyse a file onto a deck. `cached` may hold { bpm, peaks } from an earlier load.
     * @returns {Promise<{ duration: number, bpm: number | null, peaks: { perSecond: number, data: Float32Array } }>}
     */
    async load(id, blob, meta, cached = null) {
      const deck = decks[id];
      ensureContext();
      deck.loading = true;
      emit('change');
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = await decode(ctx, arrayBuffer);
        await nextFrame();
        const channels = [];
        for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
        const peaks = cached?.peaks?.data?.length ? cached.peaks : computePeaks(channels, buffer.sampleRate);
        let bpm = cached?.bpm ?? null;
        if (cached?.bpm === undefined || cached === null) {
          await nextFrame();
          const est = estimateBpm(channels, buffer.sampleRate);
          bpm = est && est.confidence >= 0.08 ? est.bpm : null;
        }
        if (auto && (auto.outgoingId === id || auto.incomingId === id)) cancelAuto();
        deck.load(buffer, { ...meta, bpm, peaks });
        return { duration: buffer.duration, bpm, peaks };
      } finally {
        deck.loading = false;
        emit('change');
      }
    },

    get crossfader() {
      return currentCrossfader();
    },

    setCrossfader(x) {
      if (auto) cancelAuto();
      xfader = clamp(x, 0, 1);
      applyCrossfader(xfader);
    },

    get masterVolume() {
      return masterVolume;
    },

    setMasterVolume(v) {
      masterVolume = clamp(v, 0, 1);
      if (master) master.input.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.01);
    },

    /** How audible a deck is right now (0..1), for LIVE indicators. */
    audibility(id) {
      const d = decks[id];
      if (!d.playing) return 0;
      const g = equalPower(currentCrossfader());
      return (id === 'A' ? g.a : g.b) * d.volume;
    },

    get automix() {
      if (!auto || !ctx) return null;
      return {
        to: auto.incomingId,
        from: auto.outgoingId,
        progress: clamp((ctx.currentTime - auto.t0) / auto.dur, 0, 1),
        remaining: Math.max(0, auto.t0 + auto.dur - ctx.currentTime),
        seconds: auto.dur,
      };
    },

    automixTarget,

    /**
     * Fade to the other deck over `seconds`, starting it if needed; the outgoing deck stops at the end.
     * Must be called from a user gesture.
     */
    startAutomix(seconds = 16, { stopOutgoing = true, to: forcedTo = null } = {}) {
      const to = forcedTo === 'A' || forcedTo === 'B' ? forcedTo : automixTarget();
      const from = to === 'B' ? 'A' : 'B';
      const incoming = decks[to];
      if (!incoming.loaded) throw new Error(`Load a track on Deck ${to} first.`);
      engine.unlock();
      if (auto) cancelAuto();
      if (!incoming.playing && !incoming.play()) return null;
      const startX = xfader;
      const target = to === 'B' ? 1 : 0;
      const now = ctx.currentTime;
      const t0 = now + 0.03;
      const curves = transitionCurves(startX, target, 128);
      const g = equalPower(startX);
      for (const [id, curve, v] of [['A', curves.a, g.a], ['B', curves.b, g.b]]) {
        const p = gainParam(id);
        p.cancelScheduledValues(now);
        p.setValueAtTime(v, now);
        p.setValueCurveAtTime(curve, t0, seconds);
      }
      auto = {
        from: startX,
        to: target,
        t0,
        dur: seconds,
        incomingId: to,
        outgoingId: from,
        stopOutgoing,
        timer: setTimeout(finishAuto, (seconds + 0.06) * 1000),
      };
      emit('change');
      return { to, from };
    },

    cancelAutomix: cancelAuto,

    pauseAll() {
      if (auto) cancelAuto();
      decks.A.pause();
      decks.B.pause();
    },

    get anyPlaying() {
      return decks.A.playing || decks.B.playing;
    },

    masterLevel() {
      if (!master || !engine.anyPlaying) return 0;
      master.analyser.getFloatTimeDomainData(meterBuf);
      let m = 0;
      for (let i = 0; i < meterBuf.length; i++) {
        const v = meterBuf[i] < 0 ? -meterBuf[i] : meterBuf[i];
        if (v > m) m = v;
      }
      return m;
    },

    get isRecording() {
      return Boolean(recorder) || recordingStarting;
    },

    get recordingKind() {
      return recorder?.kind ?? null;
    },

    recordingElapsed() {
      return recorder ? recorder.elapsed() : 0;
    },

    /** Start recording the master bus. Call from a user gesture. */
    async startRecording({ format = 'auto' } = {}) {
      if (recorder || recordingStarting) return;
      recordingStarting = true;
      try {
        engine.unlock();
        const r = createRecorder(ctx, master.out, { format });
        await r.start();
        recorder = r;
      } finally {
        recordingStarting = false;
        emit('change');
      }
    },

    /** @returns {Promise<{ blob: Blob, mime: string, ext: string, durationSec: number }>} */
    async stopRecording() {
      const r = recorder;
      if (!r) return null;
      recorder = null;
      emit('change');
      const result = await r.stop();
      emit('change');
      return result;
    },
  };
  return engine;
}
