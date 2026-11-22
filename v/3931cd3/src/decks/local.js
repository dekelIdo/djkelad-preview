// LOCAL_AUDIO adapter: Queue A / Queue B drive the real Web Audio decks.
// Each deck's NOW song is decoded onto that deck; when a song ends (or is mixed
// out) the deck loads its next song, and AUTO DJ starts the crossfade by itself.
import { autoDjStep } from './logic.js';
import { otherDeck } from './queues.js';
import { createStore } from '../util.js';

const KIND = 'local';
const AUTODJ_KEY = 'djkelad.autodj';
const SECONDS_KEY = 'djkelad.automix.seconds';
export const MIX_CHOICES = [8, 16, 32];

function readSeconds() {
  try {
    const v = Number(localStorage.getItem(SECONDS_KEY));
    return MIX_CHOICES.includes(v) ? v : 16;
  } catch {
    return 16;
  }
}

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeFlag(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ engine: any, library: any, queues: any, notify: Function }} deps
 */
export function createLocalDecks({ engine, library, queues, notify }) {
  const store = createStore({ autoDj: readFlag(AUTODJ_KEY, false), seconds: readSeconds(), loading: { A: false, B: false } });
  const getSeconds = () => store.get().seconds;
  const loads = { A: null, B: null }; // { qid, promise }
  let restored = false;

  const findTrack = (id) => library.store.get().tracks.find((t) => t.id === id) || null;
  const nowItem = (id) => queues.now(KIND, id);
  const isOnDeck = (id) => {
    const item = nowItem(id);
    return Boolean(item && engine.decks[id].track?.qid === item.qid);
  };

  function setLoading(id, on) {
    store.set({ loading: { ...store.get().loading, [id]: on } });
  }

  /**
   * Make the engine deck hold the deck's NOW song. Never swaps a song the room
   * can hear unless `force` (an explicit "play now" from the user).
   */
  function loadDeck(id, { force = false } = {}) {
    const item = nowItem(id);
    const deck = engine.decks[id];
    if (!item) {
      if (deck.loaded && engine.audibility(id) <= 0.05) deck.eject();
      return Promise.resolve(false);
    }
    if (deck.track?.qid === item.qid) return Promise.resolve(true);
    if (loads[id]?.qid === item.qid) return loads[id].promise;
    if (!force && engine.audibility(id) > 0.05) return Promise.resolve(false);
    const rec = findTrack(item.id);
    if (!rec) {
      if (!library.store.get().loaded) return Promise.resolve(false); // library still opening
      notify(`“${item.title}” is no longer in My music, so it was skipped.`, 'warn');
      queues.advance(KIND, id);
      return loadDeck(id, { force });
    }
    setLoading(id, true);
    const promise = (async () => {
      try {
        const cached = rec.peaks ? { peaks: rec.peaks, bpm: rec.bpm ?? null } : null;
        const result = await engine.load(id, rec.blob, { id: rec.id, qid: item.qid, title: rec.title, artist: rec.artist }, cached);
        if (!rec.peaks) library.cacheAnalysis(rec.id, result).catch(() => {});
        return true;
      } catch (e) {
        console.warn('decode failed', e);
        if (/Web Audio/.test(e?.message || '')) notify('This browser has no Web Audio, so the decks can’t play here. Use Safari, Chrome, Edge or Firefox.', 'error');
        else notify(`This browser can’t open “${rec.title}”. Try an MP3, M4A or WAV file.`, 'error');
        return false;
      } finally {
        loads[id] = null;
        setLoading(id, false);
      }
    })();
    loads[id] = { qid: item.qid, promise };
    return promise.then((ok) => {
      // The deck's NOW changed while decoding: load the newer choice.
      if (ok && nowItem(id) && nowItem(id).qid !== item.qid && engine.audibility(id) <= 0.05) return loadDeck(id);
      return ok;
    });
  }

  /** A deck finished its NOW song (ended, or mixed out by AUTO MIX): move on to its next song. */
  function finished(id) {
    const item = nowItem(id);
    const deck = engine.decks[id];
    if (!item || deck.track?.qid !== item.qid || deck.playing) return;
    const continueHere = store.get().autoDj && queues.mode === KIND && !engine.anyPlaying;
    const next = queues.advance(KIND, id);
    if (!next) {
      deck.eject();
      return;
    }
    loadDeck(id).then((ok) => {
      // AUTO DJ with nothing on the other deck: keep the music going on this deck.
      if (ok && continueHere && !engine.anyPlaying && store.get().autoDj) {
        engine.setCrossfader(id === 'A' ? 0 : 1);
        deck.play();
      }
    });
  }

  engine.on((type, detail) => {
    if (type === 'ended' && detail?.deck) finished(detail.deck);
    else if (type === 'automix-done' && detail?.stopped) finished(detail.from);
    else if (type === 'change') {
      for (const id of ['A', 'B']) {
        const d = engine.decks[id];
        if (d.playing && !d.cuePreview && isOnDeck(id) && !nowItem(id).played) queues.markPlayed(KIND, id);
      }
    }
  });

  // A song added to an empty deck is loaded right away, so it is ready to play.
  queues.subscribe((reason, detail) => {
    if (!restored || detail?.kind !== KIND) return;
    if (['add', 'add-many', 'transfer', 'advance', 'clear-now'].includes(reason)) {
      for (const id of ['A', 'B']) if (!isOnDeck(id)) loadDeck(id);
    }
  });

  // AUTO DJ: watch the live deck and start the transition on time.
  setInterval(() => {
    if (queues.mode !== KIND || !store.get().autoDj) return;
    const view = (id) => {
      const d = engine.decks[id];
      return {
        loaded: d.loaded && isOnDeck(id),
        loading: d.loading || Boolean(loads[id]),
        playing: d.playing && !d.cuePreview,
        audible: engine.audibility(id) > 0.04,
        remaining: d.playing ? (d.duration - d.position) / d.rate : Infinity,
      };
    };
    const step = autoDjStep({ enabled: true, automixRunning: Boolean(engine.automix), decks: { A: view('A'), B: view('B') }, seconds: getSeconds() });
    if (!step) return;
    try {
      engine.startAutomix(step.seconds, { to: step.to });
    } catch (e) {
      console.warn('auto dj', e);
    }
  }, 250);

  const api = {
    kind: KIND,
    store,
    loadDeck,

    /** Load both decks' NOW songs (after a reload). Call once the library is ready. */
    restore() {
      restored = true;
      return Promise.all(['A', 'B'].map((id) => loadDeck(id)));
    },

    get autoDj() {
      return store.get().autoDj;
    },

    get seconds() {
      return getSeconds();
    },

    /** Cycle the transition length 8 → 16 → 32 s. */
    cycleSeconds() {
      const i = MIX_CHOICES.indexOf(getSeconds());
      const seconds = MIX_CHOICES[(i + 1) % MIX_CHOICES.length];
      store.set({ seconds });
      try {
        localStorage.setItem(SECONDS_KEY, String(seconds));
      } catch {
        /* ignore */
      }
      return seconds;
    },

    /** Call inside a tap. Turning AUTO DJ on with nothing playing starts the first ready deck. */
    setAutoDj(on) {
      store.set({ autoDj: Boolean(on) });
      writeFlag(AUTODJ_KEY, Boolean(on));
      if (on && !engine.anyPlaying) {
        const first = ['A', 'B'].find((id) => engine.decks[id].loaded && isOnDeck(id));
        if (first) {
          engine.unlock();
          engine.setCrossfader(first === 'A' ? 0 : 1);
          engine.decks[first].play();
        }
      }
    },

    /** Add to a deck's queue. An empty deck loads it at once. */
    add(id, item, opts) {
      const r = queues.add(KIND, id, item, opts);
      if (r.placed === 'now') loadDeck(id);
      return r;
    },

    /**
     * PLAY ON DECK: the song goes onto the deck and plays now. If the other deck is
     * live, DJKELAD mixes into it with AUTO MIX; otherwise it starts straight away.
     * Call `engine.unlock()` inside the tap before awaiting this.
     */
    async playNow(id, item) {
      engine.unlock();
      queues.setNow(KIND, id, item);
      const otherLive = engine.audibility(otherDeck(id)) > 0.05;
      const ok = await loadDeck(id, { force: true });
      if (!ok) return false;
      const deck = engine.decks[id];
      if (otherLive && engine.audibility(otherDeck(id)) > 0.05) {
        try {
          engine.startAutomix(getSeconds(), { to: id });
        } catch (e) {
          notify(e.message, 'warn');
        }
      } else {
        if (engine.audibility(otherDeck(id)) <= 0.05) engine.setCrossfader(id === 'A' ? 0 : 1);
        deck.seek(0);
        deck.play();
      }
      return true;
    },

    /** Skip this deck's NOW and load its next song (only when the deck is not live). */
    loadNext(id) {
      if (engine.audibility(id) > 0.05) return false;
      const deck = engine.decks[id];
      if (deck.playing) deck.pause();
      queues.advance(KIND, id);
      loadDeck(id);
      return true;
    },

    eject(id) {
      engine.decks[id].eject();
      queues.clearNow(KIND, id);
    },

    isOnDeck,
  };
  return api;
}
