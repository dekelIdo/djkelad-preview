// Queue A / Queue B: what each deck plays NOW and what comes NEXT, per source.
// Pure state + persistence (no audio, no DOM), so it is unit-tested in Node.
//
// Each source keeps its own pair of queues ("sets"): local files can really be
// mixed, Spotify tracks can only be played one at a time, so they never share
// a deck pair.
import { cloneItem, sanitizeItem } from './items.js';

export const DECK_IDS = ['A', 'B'];
export const KINDS = ['local', 'spotify'];
export const otherDeck = (id) => (id === 'A' ? 'B' : 'A');

const MAX_QUEUE = 300;
const MAX_HISTORY = 40;
const DEFAULT_KEY = 'djkelad.queues.v1';

function emptySet() {
  return { A: { now: null, queue: [] }, B: { now: null, queue: [] }, history: [] };
}

function emptyState() {
  return { mode: 'local', sets: { local: emptySet(), spotify: emptySet() } };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* blocked */
  }
  return memoryStorage();
}

export function sanitizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  if (raw.mode === 'spotify' || raw.mode === 'local') state.mode = raw.mode;
  for (const kind of KINDS) {
    const src = raw.sets?.[kind];
    if (!src) continue;
    const keep = (it) => {
      const s = sanitizeItem(it);
      return s && s.kind === kind ? s : null;
    };
    for (const id of DECK_IDS) {
      const d = src[id] || {};
      state.sets[kind][id].now = keep(d.now);
      state.sets[kind][id].queue = (Array.isArray(d.queue) ? d.queue : []).map(keep).filter(Boolean).slice(0, MAX_QUEUE);
    }
    state.sets[kind].history = (Array.isArray(src.history) ? src.history : []).map(keep).filter(Boolean).slice(0, MAX_HISTORY);
  }
  return state;
}

/**
 * @param {{ storage?: Storage, key?: string }} [opts]
 */
export function createQueues(opts = {}) {
  const storage = opts.storage || defaultStorage();
  const key = opts.key || DEFAULT_KEY;
  const subs = new Set();
  let state = load();

  function load() {
    try {
      const raw = storage.getItem(key);
      return raw ? sanitizeState(JSON.parse(raw)) : emptyState();
    } catch {
      return emptyState();
    }
  }

  function commit(reason, detail) {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage full or blocked: queues still work for this visit */
    }
    for (const fn of subs) fn(reason, detail);
  }

  const set = (kind) => {
    if (!state.sets[kind]) throw new Error(`Unknown source: ${kind}`);
    return state.sets[kind];
  };
  const deck = (kind, id) => {
    if (id !== 'A' && id !== 'B') throw new Error(`Unknown deck: ${id}`);
    return set(kind)[id];
  };
  const pushHistory = (kind, item) => {
    if (!item) return;
    const h = set(kind).history;
    h.unshift({ ...item, played: true });
    if (h.length > MAX_HISTORY) h.length = MAX_HISTORY;
  };
  const insertAt = (list, item, position) => {
    if (list.length >= MAX_QUEUE) throw new Error(`A queue holds at most ${MAX_QUEUE} songs.`);
    if (position === 'next' || position === 0) list.unshift(item);
    else if (Number.isInteger(position) && position > 0 && position < list.length) list.splice(position, 0, item);
    else list.push(item);
  };

  const api = {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    /** Read-only view of the whole state (do not mutate). */
    get state() {
      return state;
    },

    get mode() {
      return state.mode;
    },

    setMode(mode) {
      if (mode !== 'local' && mode !== 'spotify') throw new Error(`Unknown mode: ${mode}`);
      if (state.mode === mode) return;
      state.mode = mode;
      commit('mode', { mode });
    },

    set,
    now: (kind, id) => deck(kind, id).now,
    queue: (kind, id) => deck(kind, id).queue,
    next: (kind, id) => deck(kind, id).queue[0] || null,
    history: (kind) => set(kind).history,

    /**
     * Add a song to a deck. An empty deck takes it straight away as NOW (ready to play);
     * otherwise it joins that deck's queue. Returns where it went.
     * @returns {{ placed: 'now' | 'queue', item: object, index: number }}
     */
    add(kind, id, item, { position = 'end', fillEmpty = true } = {}) {
      if (!item || item.kind !== kind) throw new Error('That song belongs to another source.');
      const d = deck(kind, id);
      const it = cloneItem(item);
      if (fillEmpty && !d.now) {
        d.now = it;
        commit('add', { kind, id, placed: 'now', item: it });
        return { placed: 'now', item: it, index: -1 };
      }
      insertAt(d.queue, it, position);
      const index = d.queue.indexOf(it);
      commit('add', { kind, id, placed: 'queue', item: it, index });
      return { placed: 'queue', item: it, index };
    },

    /** Add many songs to the end of a deck's queue (an empty deck takes the first as NOW). */
    addMany(kind, id, items) {
      let added = 0;
      for (const item of items) {
        if (!item || item.kind !== kind) continue;
        const d = deck(kind, id);
        if (d.queue.length >= MAX_QUEUE) break;
        const it = cloneItem(item);
        if (!d.now) d.now = it;
        else d.queue.push(it);
        added++;
      }
      if (added) commit('add-many', { kind, id, added });
      return added;
    },

    /**
     * Put a song on a deck as NOW. A NOW song that never played goes back to the
     * top of that deck's queue (nothing the user picked is lost); a played one goes to history.
     */
    setNow(kind, id, item) {
      if (!item || item.kind !== kind) throw new Error('That song belongs to another source.');
      const d = deck(kind, id);
      const prev = d.now;
      // A song taken from this deck's own queue keeps its identity; anything else is a fresh copy.
      const qi = item.qid ? d.queue.findIndex((x) => x.qid === item.qid) : -1;
      let it;
      if (qi >= 0) {
        it = { ...d.queue[qi], played: false };
        d.queue.splice(qi, 1);
      } else it = cloneItem(item);
      if (prev) {
        if (prev.played) pushHistory(kind, prev);
        else if (prev.qid !== it.qid) d.queue.unshift(prev);
      }
      d.now = it;
      commit('now', { kind, id, item: it });
      return it;
    },

    markPlayed(kind, id) {
      const d = deck(kind, id);
      if (!d.now || d.now.played) return;
      d.now = { ...d.now, played: true };
      commit('played', { kind, id });
    },

    /** NOW is done: move it to history and promote the deck's next song. */
    advance(kind, id) {
      const d = deck(kind, id);
      if (d.now) pushHistory(kind, d.now);
      d.now = d.queue.shift() || null;
      commit('advance', { kind, id, now: d.now });
      return d.now;
    },

    clearNow(kind, id) {
      const d = deck(kind, id);
      if (!d.now) return;
      if (d.now.played) pushHistory(kind, d.now);
      d.now = null;
      commit('clear-now', { kind, id });
    },

    remove(kind, id, qid) {
      const d = deck(kind, id);
      const i = d.queue.findIndex((x) => x.qid === qid);
      if (i < 0) return null;
      const [it] = d.queue.splice(i, 1);
      commit('remove', { kind, id, item: it });
      return it;
    },

    /** Reorder within one queue. */
    move(kind, id, from, to) {
      const q = deck(kind, id).queue;
      if (from < 0 || from >= q.length) return false;
      const t = Math.max(0, Math.min(q.length - 1, to));
      if (t === from) return false;
      const [it] = q.splice(from, 1);
      q.splice(t, 0, it);
      commit('move', { kind, id, from, to: t });
      return true;
    },

    /** Move a queued song to the other deck's queue (or onto it as NOW if that deck is empty). */
    transfer(kind, qid, { position = 'end' } = {}) {
      for (const id of DECK_IDS) {
        const q = deck(kind, id).queue;
        const i = q.findIndex((x) => x.qid === qid);
        if (i < 0) continue;
        const [it] = q.splice(i, 1);
        const to = otherDeck(id);
        const target = deck(kind, to);
        let placed = 'queue';
        if (!target.now) {
          target.now = it;
          placed = 'now';
        } else insertAt(target.queue, it, position);
        commit('transfer', { kind, from: id, to, item: it, placed });
        return { to, placed };
      }
      return null;
    },

    clearQueue(kind, id) {
      const d = deck(kind, id);
      if (!d.queue.length) return;
      d.queue = [];
      commit('clear-queue', { kind, id });
    },

    /**
     * The order the songs will play in: the live deck's NOW, the other deck's NOW,
     * then both queues alternating (a deck whose queue runs out lets the other continue).
     */
    programOrder(kind, startDeck = 'A') {
      const s = set(kind);
      const a = startDeck === 'B' ? 'B' : 'A';
      const b = otherDeck(a);
      const out = [];
      if (s[a].now) out.push(s[a].now);
      if (s[b].now) out.push(s[b].now);
      const n = Math.max(s[a].queue.length, s[b].queue.length);
      for (let i = 0; i < n; i++) {
        if (s[a].queue[i]) out.push(s[a].queue[i]);
        if (s[b].queue[i]) out.push(s[b].queue[i]);
      }
      return out;
    },

    /** Forget everything (used by tests and "Clear all"). */
    reset() {
      state = emptyState();
      commit('reset');
    },
  };
  return api;
}
