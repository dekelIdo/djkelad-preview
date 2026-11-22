// Queue items: the small, source-tagged shape stored in Queue A / Queue B.
import { uid } from '../util.js';

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

/** From a mapped Spotify track (see spotify/mappers.js mapTrack). */
export function itemFromSpotify(t) {
  if (!t || !t.uri) return null;
  return {
    qid: uid(),
    kind: 'spotify',
    id: t.uri,
    title: t.name || 'Untitled',
    artist: t.artists || '',
    durationMs: num(t.durationMs),
    image: t.image || '',
    imageLarge: t.imageLarge || t.image || '',
    url: t.url || '',
  };
}

/** From an imported library record (see library/library.js). */
export function itemFromLocal(rec) {
  if (!rec || !rec.id) return null;
  return {
    qid: uid(),
    kind: 'local',
    id: rec.id,
    title: rec.title || rec.name || 'Track',
    artist: rec.artist || '',
    durationMs: rec.duration ? Math.round(rec.duration * 1000) : 0,
    bpm: Number.isFinite(rec.bpm) ? rec.bpm : null,
  };
}

/** The track shape the Spotify controller expects for play requests. */
export function spotifyTrackFromItem(item) {
  return {
    uri: item.id,
    id: String(item.id || '').split(':').pop(),
    name: item.title,
    artists: item.artist,
    album: '',
    image: item.image || '',
    imageLarge: item.imageLarge || item.image || '',
    durationMs: item.durationMs || 0,
    playable: true,
    url: item.url || '',
    type: 'track',
  };
}

/** Same item with a fresh queue id (the same song may be queued twice). */
export function cloneItem(item) {
  return { ...item, qid: uid(), played: false };
}

/** Defensive copy used when reading persisted queues. */
export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'local' && raw.kind !== 'spotify') return null;
  const id = str(raw.id, 200);
  if (!id) return null;
  if (raw.kind === 'spotify' && !/^spotify:(track|episode):[A-Za-z0-9]+$/.test(id)) return null;
  const item = {
    qid: str(raw.qid, 40) || uid(),
    kind: raw.kind,
    id,
    title: str(raw.title) || 'Untitled',
    artist: str(raw.artist),
    durationMs: num(raw.durationMs),
  };
  if (raw.kind === 'spotify') {
    item.image = /^https:\/\//.test(raw.image || '') ? str(raw.image, 500) : '';
    item.imageLarge = /^https:\/\//.test(raw.imageLarge || '') ? str(raw.imageLarge, 500) : item.image;
    item.url = /^https:\/\/open\.spotify\.com\//.test(raw.url || '') ? str(raw.url, 300) : '';
  } else {
    item.bpm = Number.isFinite(raw.bpm) ? raw.bpm : null;
  }
  if (raw.played) item.played = true;
  return item;
}
