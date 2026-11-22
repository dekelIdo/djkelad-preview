// SPOTIFY decks: Queue A / Queue B feeding one Spotify player. One deck is LIVE,
// the other waits as NEXT. Switching is a clean cut (Spotify songs never overlap).
import { deviceIcon, h, icon } from '../ui/dom.js';
import { armable } from '../ui/arm.js';
import { formatTime } from '../mixer/curves.js';
import { liveProgress } from '../spotify/mappers.js';
import { art } from '../spotify/browser.js';
import { otherDeck } from './queues.js';

const KIND = 'spotify';

/**
 * @param {{ controller: any, spot: any, queues: any, notify: Function, openQueue: (deck: string) => void,
 *   openAdd: (deck?: string) => void, openDevices: () => void, goToSpotify: () => void }} deps
 */
export function createSpotifyDecksView({ controller, spot, queues, notify, openQueue, openAdd, openDevices, goToSpotify }) {
  let raf = 0;

  // ---------- not connected ----------
  const gateBtn = h('button', { class: 'btn btn-primary btn-lg' }, 'Connect Spotify');
  gateBtn.addEventListener('click', goToSpotify);
  const gate = h(
    'div',
    { class: 'spd-gate' },
    h('div', { class: 'gate-kicker' }, 'SPOTIFY DECKS'),
    h('h2', { class: 'spd-gate-t' }, 'DJ from your Spotify playlists'),
    h(
      'ul',
      { class: 'gate-points' },
      h('li', {}, 'Search or open a playlist, then send songs to Queue A or Queue B.'),
      h('li', {}, 'One deck plays in Spotify, the other waits as NEXT. When a song ends, the next one starts by itself.'),
      h('li', {}, 'Spotify doesn’t let apps overlap or record its songs, so there is no crossfader here. Real blends work with your own files (MY FILES).'),
    ),
    gateBtn,
  );

  // ---------- deck cards ----------
  function buildDeck(id) {
    const letter = h('span', { class: 'deck-letter', 'aria-hidden': 'true' }, id);
    const state = h('span', { class: 'deck-state' });
    const qBtn = h('button', { class: 'spd-qbtn', 'aria-label': `Queue ${id}` }, icon('queue'), h('span', { class: 'q-count' }));
    qBtn.addEventListener('click', () => openQueue(id));
    const head = h('div', { class: 'deck-head' }, letter, h('span', { class: 'spd-src' }, 'SPOTIFY'), state, qBtn);

    const artBox = h('div', { class: 'spd-art' });
    const title = h('div', { class: 'spd-t' });
    const artist = h('div', { class: 'spd-a' });
    const nowBtn = h('button', { class: 'spd-now', 'aria-label': `Deck ${id} queue` }, artBox, h('div', { class: 'spd-meta' }, title, artist));
    nowBtn.addEventListener('click', () => openQueue(id));

    const fill = h('div', { class: 'seek-fill' });
    const thumb = h('div', { class: 'seek-thumb' });
    const seek = h('div', { class: 'seek-track spd-seek', role: 'slider', tabindex: '0', 'aria-label': `Deck ${id} position` }, fill, thumb);
    const elT = h('span', {}, '0:00');
    const remT = h('span', {}, '');
    const progress = h('div', { class: 'spd-progress' }, seek, h('div', { class: 'seek-times' }, elT, remT));
    let seeking = null;
    const frac = (e) => {
      const r = seek.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    };
    seek.addEventListener('pointerdown', (e) => {
      const pb = spot.deckPlayback(id);
      if (!pb?.durationMs) return;
      e.preventDefault();
      seeking = { id: e.pointerId, f: frac(e) };
      try {
        seek.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      seek.classList.add('grabbed');
    });
    seek.addEventListener('pointermove', (e) => {
      if (seeking && seeking.id === e.pointerId) seeking.f = frac(e);
    });
    seek.addEventListener('pointerup', (e) => {
      if (!seeking || e.pointerId !== seeking.id) return;
      const pb = spot.deckPlayback(id);
      if (pb?.durationMs) spot.seek(id, seeking.f * pb.durationMs);
      seeking = null;
      seek.classList.remove('grabbed');
    });
    seek.addEventListener('pointercancel', () => {
      seeking = null;
      seek.classList.remove('grabbed');
    });
    seek.addEventListener('keydown', (e) => {
      const pb = spot.deckPlayback(id);
      if (!pb?.durationMs) return;
      const p = liveProgress(pb);
      if (e.key === 'ArrowRight') spot.seek(id, Math.min(pb.durationMs, p + 10000));
      else if (e.key === 'ArrowLeft') spot.seek(id, Math.max(0, p - 10000));
      else return;
      e.preventDefault();
    });

    const playL = h('span', { class: 'spd-play-l' });
    const playBtn = h('button', { class: 'spd-play' }, icon('play', 'ic-play'), icon('pause', 'ic-pause'), playL);
    armable(playBtn, {
      // Starting this deck while the other deck's song plays is a hard cut: tap twice.
      risky: () => !spot.deckPlayback(id) && spot.anyPlaying,
      run: () => spot.playPause(id),
      armedText: `TAP AGAIN · CUT TO ${id}`,
    });
    const skipBtn = h('button', { class: 'spd-skip', 'aria-label': `Deck ${id}: next song` }, icon('next'), h('span', {}, 'NEXT'));
    armable(skipBtn, {
      risky: () => spot.isDeckPlaying(id),
      run: () => {
        if (!queues.next(KIND, id) && !spot.deckPlayback(id)) {
          notify(`Queue ${id} is empty.`, 'info');
          return;
        }
        spot.skip(id);
      },
      armedText: 'TAP AGAIN',
    });
    const controls = h('div', { class: 'spd-controls' }, playBtn, skipBtn);

    const nextT = h('span', { class: 'deck-next-t' });
    const nextRow = h('button', { class: 'deck-next', 'aria-label': `Queue ${id}` }, h('span', { class: 'tag tag-next' }, 'NEXT'), nextT, h('span', { class: 'q-btn' }, icon('queue'), h('span', { class: 'q-count' })));
    nextRow.addEventListener('click', () => openQueue(id));

    const addBtn = h('button', { class: 'btn btn-load' }, icon('plus'), `Add Spotify songs to Deck ${id}`);
    addBtn.addEventListener('click', () => openAdd(id));
    const empty = h('div', { class: 'deck-empty' }, addBtn, h('span', { class: 'fine' }, `Queue ${id} is empty`));

    const card = h('article', { class: `deck spd-deck deck-${id.toLowerCase()}`, 'aria-label': `Spotify Deck ${id}` }, head, nowBtn, progress, controls, nextRow, empty);

    let lastArt = '';
    function update() {
      const item = queues.now(KIND, id);
      const next = queues.next(KIND, id);
      const qLen = queues.queue(KIND, id).length;
      const pb = spot.deckPlayback(id);
      const isLive = spot.live === id && Boolean(pb);
      const playing = Boolean(pb?.isPlaying);
      card.classList.toggle('is-empty', !item);
      card.classList.toggle('is-live', playing);
      card.classList.toggle('is-on-air', isLive);
      const artUrl = item?.imageLarge || item?.image || '';
      if (artUrl !== lastArt || !artBox.firstChild) {
        lastArt = artUrl;
        artBox.replaceChildren(art(artUrl, 'spd-img'));
      }
      title.textContent = item?.title || 'No song';
      artist.textContent = item?.artist || '';
      const handoff = spot.store.get().handoff;
      let s = '';
      if (!item) s = '';
      else if (playing) s = 'LIVE';
      else if (isLive) s = 'PAUSED';
      else if (handoff && handoff.deck === id && handoff.qid === item.qid && !handoff.stale) s = 'UP NEXT';
      else s = spot.anyPlaying ? 'WAITING' : 'READY';
      state.textContent = s;
      state.className = `deck-state state-${s.toLowerCase().replace(/\s+/g, '-')}`;
      progress.classList.toggle('is-off', !isLive);
      playBtn.classList.toggle('is-playing', playing);
      playL.textContent = playing ? 'PAUSE' : isLive ? 'RESUME' : `PLAY ${id}`;
      playBtn.setAttribute('aria-label', playing ? `Pause Deck ${id}` : isLive ? `Resume Deck ${id}` : `Play Deck ${id} in Spotify`);
      playBtn.disabled = !item;
      skipBtn.disabled = !item;
      nextT.textContent = next ? `${next.title}${next.artist ? ` — ${next.artist}` : ''}` : qLen ? '' : 'Queue empty · tap to add';
      nextRow.classList.toggle('is-empty', !next);
      for (const c of card.querySelectorAll('.q-count')) c.textContent = String(qLen);
    }
    function frame() {
      const pb = spot.deckPlayback(id);
      const dur = pb?.durationMs || queues.now(KIND, id)?.durationMs || 0;
      const pos = pb ? (seeking ? seeking.f * dur : liveProgress(pb)) : 0;
      const f = dur ? pos / dur : 0;
      fill.style.transform = `scaleX(${f})`;
      thumb.style.left = `${f * 100}%`;
      elT.textContent = formatTime(pos / 1000);
      remT.textContent = dur ? `-${formatTime(Math.max(0, dur - pos) / 1000)}` : '';
    }
    return { card, update, frame };
  }

  // ---------- center ----------
  const devName = h('span', { class: 'chip-text' }, 'Choose where to play');
  const devBtn = h('button', { class: 'device-chip spd-device' }, icon('device', 'chip-ic'), devName, icon('chevron', 'chip-chev'));
  devBtn.addEventListener('click', openDevices);

  const switchL = h('span', { class: 'spd-switch-l' });
  const switchBtn = h('button', { class: 'spd-switch' }, icon('swap'), switchL);
  armable(switchBtn, {
    risky: () => spot.anyPlaying,
    run: () => {
      const target = otherDeck(spot.live || 'B');
      if (!queues.now(KIND, target)) {
        notify(`Deck ${target} is empty. Add a song to Queue ${target} first.`, 'info');
        return;
      }
      spot.playDeck(target);
    },
    armedText: 'TAP AGAIN TO SWITCH',
  });

  const autoState = h('span', { class: 'dj-state' });
  const autoBtn = h('button', { class: 'btn-autodj spd-auto', 'aria-pressed': 'false' }, h('span', { class: 'dj-l' }, 'AUTO NEXT'), autoState);
  autoBtn.addEventListener('click', () => {
    spot.setAuto(!spot.auto);
    notify(spot.auto ? 'AUTO NEXT on: when a song ends, the other deck’s song plays next.' : 'AUTO NEXT off: Spotify stops at the end of each song.', 'info');
  });

  const lineup = h('p', { class: 'spd-lineup', hidden: true });
  const outsideT = h('span', {});
  const takeBtn = h('button', { class: 'btn btn-sm' }, 'Play my decks');
  armable(takeBtn, {
    risky: () => Boolean(controller.store.get().playback?.isPlaying),
    run: () => {
      const id = queues.now(KIND, 'A') ? 'A' : 'B';
      spot.playDeck(id);
    },
  });
  const outside = h('div', { class: 'banner spd-outside', hidden: true }, outsideT, takeBtn);
  const premium = h('div', { class: 'banner banner-warn', hidden: true }, 'Spotify says this account can’t control playback. Playback control needs Spotify Premium.');
  const note = h('p', { class: 'spd-note' }, 'One deck plays at a time: Spotify doesn’t allow apps to overlap, mix or record its songs. With Crossfade turned on in your Spotify app, Spotify can blend the automatic changes itself.');

  const center = h('section', { class: 'mixer spd-center', 'aria-label': 'Spotify deck controls' }, devBtn, h('div', { class: 'spd-center-row' }, switchBtn, autoBtn), lineup, outside, premium, note);

  const A = buildDeck('A');
  const B = buildDeck('B');
  const layout = h('div', { class: 'decks-layout' }, A.card, center, B.card);
  const el = h('div', { class: 'decks-body decks-spotify' }, gate, layout);

  function update() {
    const st = controller.store.get();
    const ready = st.phase === 'ready';
    gate.hidden = ready;
    layout.hidden = !ready;
    if (st.phase === 'unconfigured') gateBtn.textContent = 'Set up Spotify';
    else gateBtn.textContent = 'Connect Spotify';
    if (!ready) return;
    A.update();
    B.update();
    const pb = st.playback;
    const dev = pb?.device;
    devName.textContent = dev ? `Playing on ${dev.name}` : 'Choose where Spotify plays';
    devBtn.classList.toggle('is-set', Boolean(dev));
    devBtn.replaceChild(dev ? deviceIcon(dev.type) : icon('device'), devBtn.firstChild);
    devBtn.firstChild.classList.add('chip-ic');
    const live = spot.live;
    const target = otherDeck(live || 'B');
    switchL.textContent = live && spot.deckPlayback(live) ? `SWITCH TO ${target}` : `PLAY ${target}`;
    switchBtn.classList.toggle('to-a', target === 'A');
    switchBtn.disabled = !queues.now(KIND, target);
    autoBtn.classList.toggle('is-on', spot.auto);
    autoBtn.setAttribute('aria-pressed', String(spot.auto));
    autoState.textContent = spot.auto ? 'ON' : 'OFF';
    const ho = spot.store.get().handoff;
    lineup.hidden = !ho;
    if (ho) {
      const item = queues.now(KIND, ho.deck)?.qid === ho.qid ? queues.now(KIND, ho.deck) : queues.queue(KIND, ho.deck).find((x) => x.qid === ho.qid);
      lineup.textContent = ho.failed ? 'Spotify didn’t take the next song. DJKELAD will start it when this one ends.' : ho.stale ? 'You changed NEXT: DJKELAD switches to it right after this song.' : `Lined up in Spotify: ${item?.title || 'next song'} (Deck ${ho.deck})`;
    }
    const out = spot.store.get().outside;
    outside.hidden = !out;
    if (out) outsideT.textContent = `Spotify is playing “${out.name}”, which isn’t on a deck.`;
    premium.hidden = !st.premiumIssue;
  }

  controller.store.subscribe(update);
  spot.store.subscribe(update);
  queues.subscribe((r, d) => {
    if (!d || !d.kind || d.kind === KIND) update();
  });
  update();

  function frame() {
    A.frame();
    B.frame();
    raf = requestAnimationFrame(frame);
  }

  return {
    el,
    update,
    onShow() {
      update();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    onHide() {
      cancelAnimationFrame(raf);
    },
  };
}
