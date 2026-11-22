// Pure decisions behind automatic transitions, unit-tested in Node.
import { otherDeck } from './queues.js';

/** Spotify needs the next song before its own Crossfade window (max 12 s) starts. */
export const HANDOFF_MS = 18000;
/** How long a play command may take to show up in Spotify's playback state. */
export const PENDING_MS = 8000;

/**
 * Which song plays after the live deck's NOW: the other deck's NOW (decks alternate,
 * like a DJ), else the live deck's own next song.
 * @returns {{ deck: 'A'|'B', item: object } | null}
 */
export function programNext(set, live) {
  if (live !== 'A' && live !== 'B') return null;
  const o = otherDeck(live);
  if (set[o].now) return { deck: o, item: set[o].now };
  if (set[live].queue[0]) return { deck: live, item: set[live].queue[0] };
  return null;
}

/**
 * What a Spotify playback update means for the decks.
 * - confirmed: our own play command arrived
 * - wait: our play command has not arrived yet, ignore older state
 * - in-sync: the live deck's NOW is playing
 * - handoff: the song DJKELAD lined up in Spotify's queue started (deck = the deck it belongs to)
 * - stale: a song DJKELAD lined up earlier but the user changed their mind about
 * - adopt: Spotify moved on to a song that is NOW on a deck (e.g. skipped in the Spotify app)
 * - outside: Spotify plays something that is not on a deck
 */
export function reconcileSpotify({ set, live, uri, handoff, pending, staleUris, now = Date.now() }) {
  if (!uri) return { type: 'idle' };
  if (pending && now - pending.at < PENDING_MS) {
    return uri === pending.uri ? { type: 'confirmed', deck: pending.deck } : { type: 'wait' };
  }
  if (live && set[live].now?.id === uri) return { type: 'in-sync', deck: live };
  if (handoff && uri === handoff.uri) return { type: 'handoff', deck: handoff.deck, stale: Boolean(handoff.stale) };
  if (staleUris && staleUris.has(uri)) return { type: 'stale' };
  for (const id of ['A', 'B']) if (set[id].now?.id === uri) return { type: 'adopt', deck: id };
  return { type: 'outside' };
}

/** True when the live song has reached the window where the next song should be lined up. */
export function shouldHandoff({ auto, handoff, live, isPlaying, durationMs, progressMs }) {
  if (!auto || handoff || !live || !isPlaying || !durationMs) return false;
  return durationMs - progressMs <= HANDOFF_MS;
}

/**
 * Local AUTO DJ: start the crossfade into the other deck when the live deck has
 * `seconds` left. `decks[id]` = { loaded, loading, playing, audible, remaining }.
 * @returns {{ from: 'A'|'B', to: 'A'|'B', seconds: number } | null}
 */
export function autoDjStep({ enabled, automixRunning, decks, seconds }) {
  if (!enabled || automixRunning) return null;
  const live = ['A', 'B'].filter((id) => decks[id].playing && decks[id].audible);
  if (live.length !== 1) return null; // nothing live, or the user is blending by hand
  const from = live[0];
  const to = otherDeck(from);
  const o = decks[to];
  if (!o.loaded || o.loading || o.playing) return null;
  const rem = decks[from].remaining;
  if (!(rem <= seconds + 0.25)) return null;
  return { from, to, seconds: Math.max(1.5, Math.min(seconds, rem - 0.25)) };
}
