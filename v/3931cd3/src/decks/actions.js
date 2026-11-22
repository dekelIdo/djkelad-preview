// PLAY ON DECK A / B and ADD TO QUEUE A / B, for any source, with protection for
// anything that would interrupt what the room is hearing.
import { choiceSheet, h, openSheet } from '../ui/dom.js';
import { formatTime } from '../mixer/curves.js';
import { art } from '../spotify/browser.js';
import { icon } from '../ui/dom.js';

/**
 * @param {{ queues: any, local: any, spot: any, engine: any, notify: Function, showDecks: () => void }} deps
 */
export function createDeckActions({ queues, local, spot, engine, notify, showDecks }) {
  const adapter = (kind) => (kind === 'local' ? local : spot);
  const sourceName = (kind) => (kind === 'local' ? 'My files' : 'Spotify');

  /** Would PLAY ON this deck cut off something the room hears? Returns a reason or null. */
  function interruption(kind, deck) {
    if (kind === 'local') {
      if (engine.audibility(deck) > 0.05) return `Deck ${deck} is live. Its song stops right away.`;
      if (spot.anyPlaying) return 'Spotify is playing. It stops, and your file plays instead (Spotify music can’t overlap with the decks).';
      return null;
    }
    if (engine.anyPlaying) return 'Your decks are playing. They stop, and Spotify plays instead (Spotify music can’t overlap with the decks).';
    if (spot.anyPlaying) return `Spotify plays one song at a time, so the song playing now stops right away.`;
    return null;
  }

  function switchMode(kind) {
    if (queues.mode !== kind) queues.setMode(kind);
  }

  function addTo(deck, item, position = 'end') {
    if (!item) return null;
    let r;
    try {
      r = adapter(item.kind).add(deck, item, { position });
    } catch (e) {
      notify(e.message, 'warn');
      return null;
    }
    const where = r.placed === 'now' ? `Ready on Deck ${deck}` : position === 'next' ? `Next on Deck ${deck}` : `Queue ${deck} · #${r.index + 1}`;
    const action = queues.mode !== item.kind ? { label: 'Show', run: () => (switchMode(item.kind), showDecks()) } : null;
    notify(`${where}: ${item.title}${queues.mode !== item.kind ? ` (${sourceName(item.kind)} decks)` : ''}`, 'ok', action);
    return r;
  }

  function addAll(deck, items, label) {
    if (!items.length) return 0;
    const kind = items[0].kind;
    const n = queues.addMany(kind, deck, items);
    const action = queues.mode !== kind ? { label: 'Show', run: () => (switchMode(kind), showDecks()) } : null;
    notify(n ? `${n} song${n > 1 ? 's' : ''} from “${label}” added to Queue ${deck}.` : 'Queue is full.', n ? 'ok' : 'warn', action);
    return n;
  }

  /** Runs inside the tap (audio unlock + Spotify SDK activation need that). */
  function doPlay(deck, item) {
    switchMode(item.kind);
    if (item.kind === 'local') {
      engine.unlock();
      local.playNow(deck, item).then((ok) => {
        if (ok) notify(`Playing on Deck ${deck}: ${item.title}`, 'ok');
      });
    } else if (spot.playNow(deck, item)) {
      notify(`Playing on Deck ${deck}: ${item.title}`, 'ok');
    }
    showDecks();
  }

  /** PLAY ON DECK: asks first if it would cut off the live output. Call inside a tap. */
  function playOn(deck, item) {
    if (!item) return;
    const reason = interruption(item.kind, deck);
    if (!reason) {
      doPlay(deck, item);
      return;
    }
    choiceSheet({
      title: `Play on Deck ${deck} now?`,
      message: reason,
      className: `sheet-deck-${deck.toLowerCase()}`,
      choices: [
        { label: `Play now on Deck ${deck}`, kind: 'danger', run: () => doPlay(deck, item) },
        { label: `Play next on Deck ${deck} instead`, kind: 'quiet', run: () => addTo(deck, item, 'next') },
        { label: 'Cancel', kind: 'quiet' },
      ],
    });
  }

  /** The song sheet: PLAY ON DECK A / B, ADD TO QUEUE A / B. */
  function openSong(item) {
    if (!item) return;
    const isSpotify = item.kind === 'spotify';
    const grid = h('div', { class: 'song-actions' });
    let sheet = null;
    const btn = (cls, ic, top, label, run) => {
      const b = h('button', { class: `song-act ${cls}` }, icon(ic), h('span', { class: 'song-act-k' }, top), h('span', { class: 'song-act-l' }, label));
      b.addEventListener('click', () => {
        sheet.close();
        run();
      });
      return b;
    };
    grid.append(
      btn('act-play act-a', 'play', 'PLAY ON', 'DECK A', () => playOn('A', item)),
      btn('act-play act-b', 'play', 'PLAY ON', 'DECK B', () => playOn('B', item)),
      btn('act-add act-a', 'plus', 'ADD TO', 'QUEUE A', () => addTo('A', item)),
      btn('act-add act-b', 'plus', 'ADD TO', 'QUEUE B', () => addTo('B', item)),
    );
    const meta = [item.artist, item.durationMs ? formatTime(item.durationMs / 1000) : null, item.bpm ? `${item.bpm.toFixed(1)} BPM` : null].filter(Boolean).join(' · ');
    const body = h(
      'div',
      { class: 'song-sheet' },
      h('div', { class: 'song-head' }, isSpotify ? art(item.imageLarge || item.image, 'song-art') : h('span', { class: 'song-art art-empty' }, icon('music')), h('div', { class: 'song-meta' }, h('div', { class: 'song-t' }, item.title), h('div', { class: 'song-s' }, meta))),
      grid,
      h(
        'p',
        { class: `song-note ${isSpotify ? 'note-spotify' : 'note-local'}` },
        isSpotify
          ? 'plays in Spotify, one deck at a time. The other deck waits as NEXT; Spotify songs never overlap and are never recorded.'
          : 'both decks can play together, so you can blend with the crossfader, AUTO MIX or AUTO DJ.',
      ),
    );
    sheet = openSheet({ title: isSpotify ? 'Spotify song' : 'Your file', body, className: 'sheet-song' });
  }

  return { openSong, playOn, addTo, addAll, interruption };
}
