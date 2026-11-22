// Small shared helpers.

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of subs) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function uid() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** "Artist - Title.mp3" -> { artist, title } */
export function parseTrackName(fileName) {
  const base = String(fileName || 'Track').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base || 'Track' };
}

export const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|wave|aif|aiff|flac|ogg|oga|opus|caf|mp4|webm)$/i;

export function isAudioFile(file) {
  return (file.type && file.type.startsWith('audio/')) || AUDIO_EXTENSIONS.test(file.name || '');
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function mixFileName(date = new Date(), ext = 'm4a') {
  const p = (n) => String(n).padStart(2, '0');
  return `DJKELAD-mix-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.${ext}`;
}
