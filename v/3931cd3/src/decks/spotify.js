// SPOTIFY_CONTROL adapter: Queue A / Queue B feed ONE Spotify player.
//
// Spotify's Developer Policy (III.7) forbids apps from mixing, overlapping or
// segueing Spotify songs, so the decks take turns: the live deck's NOW plays in
// Spotify, the other deck's NOW waits as NEXT. Near the end of a song DJKELAD
// lines the next one up in Spotify's own queue, and Spotify moves on by itself
// (with the listener's own Crossfade setting, if they turned it on in Spotify).
import { liveProgress } from '../spotify/mappers.js';
import { programNext, reconcileSpotify, shouldHandoff } from './logic.js';
import { spotifyTrackFromItem } from './items.js';
import { createStore } from '../util.js';

const KIND = 'spotify';
const AUTO_KEY = 'djkelad.spotify.autoContinue';

function readAuto() {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * @param {{ controller: any, queues: any, notify: Function }} deps
 */
export function createSpotifyDecks({ controller, queues, notify }) {
  const store = createStore({ live: null, auto: readAuto(), outside: null, handoff: null });
  let handoff = null; // { uri, deck, qid, at, stale, failed }
  let pending = null; // { uri, deck, at }
  const staleUris = new Set();
  let lastObs = null; // { uri, progressMs, durationMs, isPlaying, at }
  let userPausedAt = 0; // a pause near the end of a song is not "the song ended"

  const set = () => queues.set(KIND);
  const live = () => store.get().live;
  const publish = (patch = {}) => store.set({ handoff: handoff ? { ...handoff } : null, ...patch });

  function setLive(id) {
    if (live() !== id) store.set({ live: id });
  }

  function nearEnd(obs) {
    if (!obs?.durationMs) return false;
    const p = obs.isPlaying ? obs.progressMs + (Date.now() - obs.at) : obs.progressMs;
    return obs.durationMs - p <= 4500;
  }

  /** The live deck's song is over: the deck moves on to its next song. */
  function finishLive() {
    const id = live();
    if (id && set()[id].now) queues.advance(KIND, id);
  }

  /** Play the deck's NOW in Spotify. Call inside a tap when started by the user. */
  function playDeck(id, { automatic = false } = {}) {
    const item = queues.now(KIND, id);
    if (!item) {
      if (!automatic) notify(`Deck ${id} is empty. Add a Spotify song to Queue ${id} first.`, 'info');
      return false;
    }
    const prev = live();
    const started = controller.play({ uris: [item.id], track: spotifyTrackFromItem(item) });
    if (started === false) return false;
    if (handoff) {
      // Already sitting in Spotify's queue (it can't be removed): skip it when it comes up.
      staleUris.add(handoff.uri);
      handoff = null;
    }
    pending = { uri: item.id, deck: id, at: Date.now() };
    // The outgoing deck's song has been played: that deck moves on to its next song.
    if (prev && prev !== id && set()[prev].now?.played) queues.advance(KIND, prev);
    setLive(id);
    queues.markPlayed(KIND, id);
    publish({ outside: null });
    return true;
  }

  function continueWithProgram(fromDeck) {
    const pn = programNext(set(), fromDeck);
    if (!pn) return false;
    if (pn.deck === fromDeck) {
      queues.advance(KIND, fromDeck);
      return playDeck(fromDeck, { automatic: true });
    }
    if (set()[fromDeck].now) queues.advance(KIND, fromDeck);
    return playDeck(pn.deck, { automatic: true });
  }

  function reconcile() {
    const st = controller.store.get();
    const pb = st.phase === 'ready' ? st.playback : null;
    const uri = pb?.track?.uri || null;
    const r = reconcileSpotify({ set: set(), live: live(), uri, handoff, pending, staleUris });
    switch (r.type) {
      case 'wait':
        return;
      case 'confirmed':
        pending = null;
        publish({ outside: null });
        break;
      case 'in-sync': {
        // Spotify stopped at the end of the live song (nothing lined up, or the line-up failed).
        if (lastObs && lastObs.uri === uri && lastObs.isPlaying && !pb.isPlaying && nearEnd(lastObs) && Date.now() - userPausedAt > 10000) {
          const id = live();
          if (store.get().auto && continueWithProgram(id)) break;
          finishLive();
        }
        if (store.get().outside) publish({ outside: null });
        break;
      }
      case 'handoff': {
        const prev = live();
        const h = handoff;
        handoff = null;
        if (h.stale) {
          // The plan changed after the song was lined up: play the current plan instead.
          if (!continueWithProgram(prev)) finishLive();
          break;
        }
        if (h.deck === prev) queues.advance(KIND, prev);
        else {
          if (prev && set()[prev].now) queues.advance(KIND, prev);
          setLive(h.deck);
        }
        queues.markPlayed(KIND, h.deck);
        publish({ outside: null });
        break;
      }
      case 'stale': {
        staleUris.delete(uri);
        if (handoff && !handoff.failed) controller.next(); // the newer line-up is right behind it
        else if (!(store.get().auto && continueWithProgram(live()))) finishLive();
        break;
      }
      case 'adopt': {
        // Spotify moved on to a song that is NOW on a deck (e.g. skipped in the Spotify app).
        const prev = live();
        if (prev && prev !== r.deck && set()[prev].now?.played) queues.advance(KIND, prev);
        setLive(r.deck);
        queues.markPlayed(KIND, r.deck);
        publish({ outside: null });
        break;
      }
      case 'outside': {
        const id = live();
        // The live song just ended and Spotify carried on with something else (its own autoplay).
        if (id && lastObs && lastObs.uri === set()[id].now?.id && nearEnd(lastObs)) {
          if (store.get().auto && continueWithProgram(id)) break;
          finishLive();
        }
        if (store.get().outside?.uri !== uri) publish({ outside: pb.track });
        break;
      }
      default:
        break;
    }
    lastObs = pb && uri ? { uri, progressMs: pb.progressMs || 0, durationMs: pb.durationMs || 0, isPlaying: Boolean(pb.isPlaying), at: pb.updatedAt || Date.now() } : null;
  }

  controller.store.subscribe(reconcile);

  // The plan changed after a song was lined up: remember it is stale.
  queues.subscribe((reason, detail) => {
    if (detail && detail.kind && detail.kind !== KIND) return;
    if (!handoff || handoff.stale) return;
    const pn = programNext(set(), live());
    if (!pn || pn.item.qid !== handoff.qid) {
      handoff.stale = true;
      publish();
    }
  });

  // Line up the next song inside the final seconds of the live song.
  setInterval(() => {
    const st = controller.store.get();
    const pb = st.phase === 'ready' ? st.playback : null;
    const id = live();
    if (!pb || !id || pb.track?.uri !== set()[id].now?.id) return;
    if (!shouldHandoff({ auto: store.get().auto, handoff, live: id, isPlaying: pb.isPlaying, durationMs: pb.durationMs, progressMs: liveProgress(pb) })) return;
    const pn = programNext(set(), id);
    if (!pn) return;
    handoff = { uri: pn.item.id, deck: pn.deck, qid: pn.item.qid, at: Date.now(), stale: false, failed: false };
    publish();
    controller.lineUp(pn.item.id).catch((e) => {
      if (handoff && handoff.qid === pn.item.qid) {
        handoff.failed = true;
        publish();
      }
      console.warn('line-up failed', e);
    });
  }, 500);

  const api = {
    kind: KIND,
    store,

    get live() {
      return live();
    },

    /** The playback state if Spotify is playing this deck's NOW. */
    deckPlayback(id) {
      const st = controller.store.get();
      const pb = st.phase === 'ready' ? st.playback : null;
      const item = queues.now(KIND, id);
      if (!pb || !item || live() !== id || pb.track?.uri !== item.id) return null;
      return pb;
    },

    isDeckPlaying(id) {
      return Boolean(api.deckPlayback(id)?.isPlaying);
    },

    get anyPlaying() {
      return Boolean(live() && api.isDeckPlaying(live()));
    },

    get auto() {
      return store.get().auto;
    },

    setAuto(on) {
      store.set({ auto: Boolean(on) });
      try {
        localStorage.setItem(AUTO_KEY, on ? '1' : '0');
      } catch {
        /* ignore */
      }
    },

    playDeck,

    /** The big deck button: pause / resume the live deck, or start this deck. Call inside a tap. */
    playPause(id) {
      const pb = api.deckPlayback(id);
      if (pb) {
        if (pb.isPlaying) userPausedAt = Date.now();
        controller.togglePlay();
        return true;
      }
      return playDeck(id);
    },

    /** Skip to this deck's next song. On the live deck it plays at once. Call inside a tap. */
    skip(id) {
      const wasLive = live() === id && api.deckPlayback(id);
      const next = queues.advance(KIND, id);
      if (wasLive) {
        if (next) return playDeck(id);
        controller.pauseIfPlaying();
      }
      return Boolean(next);
    },

    seek(id, ms) {
      if (api.deckPlayback(id)) controller.seek(ms);
    },

    add(id, item, opts) {
      return queues.add(KIND, id, item, opts);
    },

    /** PLAY ON DECK: put the song on the deck and play it now. Call inside a tap. */
    playNow(id, item) {
      queues.setNow(KIND, id, item);
      return playDeck(id);
    },

    /** Interleaved program (live deck first), for saving as a Spotify playlist. */
    programUris() {
      return queues.programOrder(KIND, live() || 'A').map((i) => i.id);
    },
  };
  return api;
}
