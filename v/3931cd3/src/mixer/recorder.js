// Records the local master bus only. Spotify audio never passes through this graph.
import { floatToInt16Interleaved, wavHeader } from './wav.js';

const MIME_CANDIDATES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** Best compressed recording type, '' to let the browser choose, null when MediaRecorder is missing. */
export function pickRecordingMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export function extensionFor(mime) {
  if (/mp4|aac|m4a/i.test(mime)) return 'm4a';
  if (/ogg/i.test(mime)) return 'ogg';
  if (/wav/i.test(mime)) return 'wav';
  return 'webm';
}

function mediaRecorderImpl(ctx, source, mime) {
  const dest = ctx.createMediaStreamDestination();
  source.connect(dest);
  const options = mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined;
  const rec = new MediaRecorder(dest.stream, options);
  const chunks = [];
  let startedAt = 0;
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  return {
    kind: 'compressed',
    async start() {
      rec.start(1000);
      startedAt = performance.now();
    },
    elapsed: () => (startedAt ? (performance.now() - startedAt) / 1000 : 0),
    stop() {
      const durationSec = (performance.now() - startedAt) / 1000;
      return new Promise((resolve, reject) => {
        rec.onstop = () => {
          try {
            source.disconnect(dest);
          } catch {
            /* already gone */
          }
          const type = rec.mimeType || mime || 'audio/webm';
          resolve({ blob: new Blob(chunks, { type }), mime: type, ext: extensionFor(type), durationSec });
        };
        rec.onerror = (e) => reject(e.error || new Error('Recording failed.'));
        if (rec.state === 'inactive') rec.onstop();
        else rec.stop();
      });
    },
  };
}

function wavImpl(ctx, source) {
  let node = null;
  let mute = null;
  let frames = 0;
  let startedAt = 0;
  let onFlushed = null;
  const parts = [];
  return {
    kind: 'wav',
    async start() {
      if (!ctx.audioWorklet) throw new Error('This browser cannot record WAV.');
      await ctx.audioWorklet.addModule(new URL('./tap-worklet.js', import.meta.url));
      node = new AudioWorkletNode(ctx, 'djkelad-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (e) => {
        if (Array.isArray(e.data)) {
          parts.push(floatToInt16Interleaved(e.data[0], e.data[1]));
          frames += e.data[0].length;
        } else if (e.data === 'flushed' && onFlushed) {
          onFlushed();
        }
      };
      mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      startedAt = performance.now();
    },
    elapsed: () => (startedAt ? (performance.now() - startedAt) / 1000 : 0),
    async stop() {
      await new Promise((resolve) => {
        onFlushed = resolve;
        node.port.postMessage('flush');
        setTimeout(resolve, 500);
      });
      try {
        source.disconnect(node);
        node.disconnect();
        mute.disconnect();
      } catch {
        /* ignore */
      }
      const header = wavHeader(frames * 4, ctx.sampleRate);
      const blob = new Blob([header, ...parts], { type: 'audio/wav' });
      return { blob, mime: 'audio/wav', ext: 'wav', durationSec: frames / ctx.sampleRate };
    },
  };
}

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} source master bus
 * @param {{ format?: 'auto' | 'wav' }} options
 */
export function createRecorder(ctx, source, { format = 'auto' } = {}) {
  const mime = format === 'wav' ? null : pickRecordingMime();
  if (mime !== null) return mediaRecorderImpl(ctx, source, mime);
  return wavImpl(ctx, source);
}
