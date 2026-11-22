// One deck: an AudioBuffer player with cue, tempo, 3-band EQ, filter and volume.
import { clamp, dbToGain, filterFrequencies, rateFromTempo } from './curves.js';

export const TEMPO_RANGE = 8;

export class Deck {
  constructor(id) {
    this.id = id;
    this.ctx = null;
    this.nodes = null;
    this.track = null; // { id, title, artist, bpm, peaks }
    this.buffer = null;
    this.loading = false;
    this.playing = false;
    this.offset = 0;
    this.startedAt = 0;
    this.tempo = 0;
    this.cuePoint = 0;
    this.cuePreview = false;
    this.volume = 0.9;
    this.eq = { low: 0, mid: 0, high: 0 };
    this.filter = 0;
    this.voice = null;
    /** @type {null | ((deck: Deck) => boolean | void)} return false to block playback */
    this.beforePlay = null;
    this._listeners = new Set();
    this._meterBuf = null;
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit(type = 'change') {
    for (const fn of this._listeners) fn(type, this);
  }

  get rate() {
    return rateFromTempo(this.tempo);
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  get loaded() {
    return Boolean(this.buffer);
  }

  get position() {
    if (!this.playing || !this.ctx) return this.offset;
    const p = this.offset + Math.max(0, this.ctx.currentTime - this.startedAt) * this.rate;
    return Math.min(p, this.duration);
  }

  get bpm() {
    return this.track?.bpm ? this.track.bpm * this.rate : null;
  }

  attach(ctx, destination) {
    this.ctx = ctx;
    const input = ctx.createGain();
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 220;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.8;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 3800;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.Q.value = 0.707;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.707;
    const volume = ctx.createGain();
    const xfade = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    input.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(hp);
    hp.connect(lp);
    lp.connect(volume);
    volume.connect(xfade);
    xfade.connect(destination);
    volume.connect(analyser);
    this.nodes = { input, low, mid, high, hp, lp, volume, xfade, analyser };
    this._meterBuf = new Float32Array(analyser.fftSize);
    this.setVolume(this.volume);
    this.setEq('low', this.eq.low);
    this.setEq('mid', this.eq.mid);
    this.setEq('high', this.eq.high);
    this.setFilter(this.filter);
  }

  load(buffer, track) {
    this._stopVoice();
    this.playing = false;
    this.cuePreview = false;
    this.buffer = buffer;
    this.track = track;
    this.offset = 0;
    this.cuePoint = 0;
    this.tempo = 0;
    this.emit('loaded');
    this.emit();
  }

  eject() {
    this._stopVoice();
    this.playing = false;
    this.buffer = null;
    this.track = null;
    this.offset = 0;
    this.cuePoint = 0;
    this.emit();
  }

  _startVoice(at) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(this.nodes.input);
    const t = ctx.currentTime + 0.005;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.006);
    source.start(t, clamp(at, 0, Math.max(0, this.duration - 0.001)));
    this.startedAt = t;
    this.offset = at;
    const voice = { source, gain };
    source.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
      if (this.voice === voice && this.playing) {
        // Reached the end of the track.
        this.voice = null;
        this.playing = false;
        this.cuePreview = false;
        this.offset = this.duration;
        this.emit('ended');
        this.emit();
      }
    };
    this.voice = voice;
  }

  _stopVoice() {
    const v = this.voice;
    if (!v || !this.ctx) return;
    this.voice = null;
    const t = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + 0.008);
      v.source.stop(t + 0.012);
    } catch {
      /* source never started */
    }
  }

  play({ cuePreview = false } = {}) {
    if (!this.buffer || !this.ctx) return false;
    if (this.playing) {
      // PLAY while holding CUE keeps the deck playing after CUE is released.
      this.cuePreview = false;
      this.emit();
      return true;
    }
    if (this.beforePlay && this.beforePlay(this) === false) return false;
    if (this.offset >= this.duration - 0.05) this.offset = 0;
    this._startVoice(this.offset);
    this.playing = true;
    this.cuePreview = cuePreview;
    this.emit();
    return true;
  }

  pause() {
    if (!this.playing) return;
    const p = this.position;
    this._stopVoice();
    this.offset = p;
    this.playing = false;
    this.cuePreview = false;
    this.emit();
  }

  toggle() {
    if (this.playing && !this.cuePreview) this.pause();
    else this.play();
  }

  seek(seconds) {
    if (!this.buffer) return;
    const t = clamp(seconds, 0, this.duration);
    if (this.playing) {
      this._stopVoice();
      this._startVoice(t);
    } else {
      this.offset = t;
    }
    this.emit('seek');
  }

  /** CDJ-style CUE. Playing: back to the cue point and stop. Paused: set cue here and preview while held. */
  cueDown() {
    if (!this.buffer) return;
    if (this.playing && !this.cuePreview) {
      this.pause();
      this.seek(this.cuePoint);
      this.emit();
      return;
    }
    if (!this.playing) {
      this.cuePoint = this.offset >= this.duration - 0.05 ? 0 : this.offset;
      this.play({ cuePreview: true });
    }
  }

  cueUp() {
    if (!this.cuePreview) return;
    this.pause();
    this.seek(this.cuePoint);
    this.emit();
  }

  /** Jump to the cue point without changing play state. */
  returnToCue() {
    this.seek(this.cuePoint);
  }

  setTempo(percent) {
    const p = this.position;
    this.tempo = clamp(Math.round(percent * 100) / 100, -TEMPO_RANGE, TEMPO_RANGE);
    if (this.playing && this.voice && this.ctx) {
      this.offset = p;
      this.startedAt = this.ctx.currentTime;
      this.voice.source.playbackRate.setValueAtTime(this.rate, this.ctx.currentTime);
    }
    this.emit();
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.nodes) {
      // Squared law feels natural on a fader.
      this.nodes.volume.gain.setTargetAtTime(this.volume * this.volume, this.ctx.currentTime, 0.01);
    }
  }

  setEq(band, db) {
    this.eq[band] = clamp(db, -26, 6);
    if (this.nodes) this.nodes[band].gain.setTargetAtTime(this.eq[band], this.ctx.currentTime, 0.01);
  }

  setFilter(v) {
    this.filter = clamp(v, -1, 1);
    if (!this.nodes) return;
    const { lp, hp } = filterFrequencies(this.filter);
    const nyq = this.ctx.sampleRate / 2 - 100;
    this.nodes.lp.frequency.setTargetAtTime(Math.min(lp, nyq), this.ctx.currentTime, 0.02);
    this.nodes.hp.frequency.setTargetAtTime(hp, this.ctx.currentTime, 0.02);
  }

  /** Peak level 0..1 after the channel fader (pre-crossfader). */
  level() {
    if (!this.nodes || !this.playing) return 0;
    const buf = this._meterBuf;
    this.nodes.analyser.getFloatTimeDomainData(buf);
    let m = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] < 0 ? -buf[i] : buf[i];
      if (v > m) m = v;
    }
    return m;
  }
}

export { dbToGain };
