// Queue A / Queue B editor: NOW, reorder (drag or arrow keys), move between
// queues, remove, clear, recently played, and "save the set as a Spotify playlist".
import { choiceSheet, confirmSheet, h, icon, openSheet } from '../ui/dom.js';
import { makeReorderable } from '../ui/reorder.js';
import { formatTime } from '../mixer/curves.js';
import { art } from '../spotify/browser.js';
import { otherDeck } from './queues.js';

/**
 * @param {{ kind: 'local'|'spotify', deck: 'A'|'B', queues: any, local: any, spot: any, engine: any, actions: any, controller: any, notify: Function }} deps
 */
export function openQueueSheet(deps) {
  const { kind, queues, local, spot, engine, actions, controller, notify } = deps;
  let deck = deps.deck;
  const tabs = {};
  const tabRow = h('div', { class: 'q-tabs', role: 'tablist' });
  for (const id of ['A', 'B']) {
    const b = h('button', { class: `q-tab q-tab-${id.toLowerCase()}`, role: 'tab' });
    b.addEventListener('click', () => {
      deck = id;
      render();
    });
    tabs[id] = b;
    tabRow.append(b);
  }
  const nowBox = h('div', { class: 'q-now' });
  const list = h('div', { class: 'q-list', role: 'list' });
  const empty = h('p', { class: 'empty-note q-empty' });
  const foot = h('div', { class: 'q-foot' });
  const historyBox = h('details', { class: 'q-history' });
  const body = h('div', { class: 'queue-sheet' }, tabRow, nowBox, h('div', { class: 'list-label' }, 'Up next'), list, empty, foot, historyBox);

  makeReorderable(list, {
    handle: '.q-grip',
    onMove: (from, to) => queues.move(kind, deck, from, to),
  });

  const isLive = (id) => (kind === 'local' ? engine.audibility(id) > 0.05 : spot.live === id && spot.isDeckPlaying(id));
  const thumb = (item) => (item.kind === 'spotify' ? art(item.image, 'q-art') : h('span', { class: 'q-art art-empty' }, icon('music')));
  const sub = (item) => [item.artist, item.durationMs ? formatTime(item.durationMs / 1000) : null, item.bpm ? `${item.bpm.toFixed(0)} BPM` : null].filter(Boolean).join(' · ');

  function itemMenu(item, index) {
    const other = otherDeck(deck);
    choiceSheet({
      title: item.title,
      message: item.artist || null,
      choices: [
        { label: `Play now on Deck ${deck}`, run: () => actions.playOn(deck, item) },
        index > 0 ? { label: 'Play next (move to the top)', kind: 'quiet', run: () => queues.move(kind, deck, index, 0) } : null,
        { label: `Move to Queue ${other}`, kind: 'quiet', run: () => queues.transfer(kind, item.qid) },
        { label: 'Remove from queue', kind: 'quiet', run: () => queues.remove(kind, deck, item.qid) },
      ].filter(Boolean),
    });
  }

  function renderNow() {
    const item = queues.now(kind, deck);
    nowBox.className = `q-now q-now-${deck.toLowerCase()}`;
    nowBox.replaceChildren();
    if (!item) {
      nowBox.append(h('div', { class: 'q-now-label' }, `DECK ${deck} · EMPTY`), h('p', { class: 'fine' }, 'Add a song and it lands here, ready to play.'));
      return;
    }
    const live = isLive(deck);
    const skip = h('button', { class: 'btn btn-sm btn-quiet' }, icon('next'), queues.next(kind, deck) ? 'Skip to next' : 'Clear deck');
    skip.addEventListener('click', async () => {
      if (live) {
        const ok = await confirmSheet({ title: `Skip the live song on Deck ${deck}?`, message: kind === 'spotify' ? 'Spotify jumps to the next song right away.' : 'The room stops hearing this song.', confirmLabel: 'Skip', danger: true });
        if (!ok) return;
      }
      if (kind === 'spotify') spot.skip(deck);
      else if (live) {
        engine.decks[deck].pause();
        queues.advance(kind, deck);
        local.loadDeck(deck);
      } else local.loadNext(deck);
    });
    nowBox.append(
      h('div', { class: 'q-now-label' }, `NOW ON DECK ${deck}`, live ? h('span', { class: 'deck-state state-live' }, 'LIVE') : item.played ? h('span', { class: 'deck-state' }, 'PLAYED') : h('span', { class: 'deck-state state-cued' }, 'READY')),
      h('div', { class: 'q-row q-row-now' }, thumb(item), h('span', { class: 'q-meta' }, h('span', { class: 'q-t' }, item.title), h('span', { class: 'q-s' }, sub(item))), skip),
    );
  }

  function render() {
    for (const id of ['A', 'B']) {
      const n = queues.queue(kind, id).length;
      tabs[id].textContent = `Queue ${id} · ${n}`;
      tabs[id].setAttribute('aria-selected', String(id === deck));
    }
    renderNow();
    const q = queues.queue(kind, deck);
    list.replaceChildren(
      ...q.map((item, i) => {
        const main = h('button', { class: 'q-main', 'aria-label': `${item.title}: options` }, thumb(item), h('span', { class: 'q-meta' }, h('span', { class: 'q-t' }, item.title), h('span', { class: 'q-s' }, sub(item))));
        main.addEventListener('click', () => itemMenu(item, i));
        const move = h('button', { class: `icon-btn q-move q-move-${otherDeck(deck).toLowerCase()}`, 'aria-label': `Move ${item.title} to Queue ${otherDeck(deck)}` }, icon('swap'));
        move.addEventListener('click', () => queues.transfer(kind, item.qid));
        const del = h('button', { class: 'icon-btn q-del', 'aria-label': `Remove ${item.title}` }, icon('close'));
        del.addEventListener('click', () => queues.remove(kind, deck, item.qid));
        return h(
          'div',
          { class: 'q-row', role: 'listitem', dataset: { index: String(i), qid: item.qid } },
          h('button', { class: 'q-grip', 'aria-label': `Reorder ${item.title} (arrow keys)` }, h('span', { class: 'q-num' }, String(i + 1)), icon('grip')),
          main,
          move,
          del,
        );
      }),
    );
    empty.hidden = q.length > 0;
    empty.textContent = `Queue ${deck} is empty. Add songs with + ${deck} from search, playlists or My music.`;

    foot.replaceChildren();
    if (q.length) {
      const clear = h('button', { class: 'btn btn-sm btn-quiet btn-danger-text' }, icon('trash'), `Clear Queue ${deck}`);
      clear.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: `Clear Queue ${deck}?`, message: `${q.length} song${q.length > 1 ? 's' : ''} leave the queue. The song on Deck ${deck} stays.`, confirmLabel: 'Clear', danger: true });
        if (ok) queues.clearQueue(kind, deck);
      });
      foot.append(clear);
    }
    if (kind === 'spotify' && queues.programOrder('spotify').length) {
      const save = h('button', { class: 'btn btn-sm' }, icon('playlist'), 'Save set as Spotify playlist');
      save.addEventListener('click', () => saveAsPlaylist(save));
      foot.append(save);
    }

    const hist = queues.history(kind).slice(0, 12);
    historyBox.hidden = !hist.length;
    historyBox.replaceChildren(
      h('summary', {}, `Recently played · ${hist.length}`),
      ...hist.map((item) => {
        const row = h('div', { class: 'q-row q-row-hist' }, thumb(item), h('span', { class: 'q-meta' }, h('span', { class: 'q-t' }, item.title), h('span', { class: 'q-s' }, sub(item))));
        for (const id of ['A', 'B']) {
          const b = h('button', { class: `q-add q-add-${id.toLowerCase()}`, 'aria-label': `Add ${item.title} to Queue ${id} again` }, icon('plus'), id);
          b.addEventListener('click', () => actions.addTo(id, item));
          row.append(b);
        }
        return row;
      }),
    );
  }

  async function saveAsPlaylist(btn) {
    if (controller.store.get().phase !== 'ready') {
      notify('Connect Spotify first.', 'warn');
      return;
    }
    if (!controller.canSavePlaylists()) {
      notify('Saving playlists needs one more Spotify permission. Disconnect and connect Spotify again (Settings).', 'warn');
      return;
    }
    const uris = spot.programUris();
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = `DJKELAD set · ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    btn.disabled = true;
    try {
      const pl = await controller.savePlaylist(name, uris, 'Queue A and Queue B from DJKELAD, in play order.');
      notify(`Saved “${pl.name}” (${uris.length} songs) to your Spotify.`, 'ok', { label: 'Open', run: () => window.open(pl.url, '_blank', 'noopener') });
    } catch (e) {
      notify(controller.describeError(e), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  const unsubs = [queues.subscribe(() => render()), (kind === 'spotify' ? spot : local).store.subscribe(() => renderNow())];
  const sheet = openSheet({
    title: kind === 'spotify' ? 'Spotify queues' : 'My files queues',
    className: `sheet-queue sheet-queue-${kind}`,
    body,
    onClose: () => unsubs.forEach((u) => u()),
  });
  render();
  return sheet;
}
