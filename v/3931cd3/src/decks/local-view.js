// MY FILES decks: Deck A | mixer | Deck B on the real Web Audio engine.
// Each deck plays its NOW song from Queue A / Queue B and shows what is NEXT.
import { confirmSheet, h, icon, openSheet } from '../ui/dom.js';
import { createFader } from '../ui/fader.js';
import { createWaveform } from '../ui/waveform.js';
import { formatTime, matchTempo } from '../mixer/curves.js';
import { TEMPO_RANGE } from '../mixer/deck.js';

const COLORS = {
  A: { main: '#E3A94F', dim: 'rgba(227,169,79,0.32)' },
  B: { main: '#5DA6F5', dim: 'rgba(93,166,245,0.32)' },
};
const KIND = 'local';

/** Fires on press (pointerdown) for timing, still works with keyboard and screen readers. */
function onPress(el, fn) {
  let last = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    last = performance.now();
    fn(e);
  });
  el.addEventListener('click', (e) => {
    if (performance.now() - last < 700) return;
    fn(e);
  });
}

/**
 * @param {{ engine: any, local: any, queues: any, library: any, notify: Function, settings: { recFormat: () => string },
 *   onRecordingSaved: (rec: any) => void, openQueue: (deck: string) => void, openAdd: (deck?: string) => void }} deps
 */
export function createLocalDecksView({ engine, local, queues, library, notify, settings, onRecordingSaved, openQueue, openAdd }) {
  const decksUI = {};
  let raf = 0;

  // ---------- per-deck sheet: EQ, filter, tempo ----------

  function openDeckSheet(id) {
    const deck = engine.decks[id];
    const other = engine.decks[id === 'A' ? 'B' : 'A'];
    const dbFmt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`;
    const row = (label, fader, valueEl) => h('div', { class: 'ctl-row' }, h('div', { class: 'ctl-label' }, label, valueEl), fader.el);
    const mkVal = () => h('span', { class: 'ctl-val' });
    const vals = { low: mkVal(), mid: mkVal(), high: mkVal(), filter: mkVal(), tempo: mkVal() };
    const showVals = () => {
      vals.low.textContent = dbFmt(deck.eq.low);
      vals.mid.textContent = dbFmt(deck.eq.mid);
      vals.high.textContent = dbFmt(deck.eq.high);
      vals.filter.textContent = deck.filter === 0 ? 'OPEN' : deck.filter < 0 ? `LOW-PASS ${Math.round(-deck.filter * 100)}` : `HIGH-PASS ${Math.round(deck.filter * 100)}`;
      vals.tempo.textContent = `${deck.tempo > 0 ? '+' : ''}${deck.tempo.toFixed(1)}%${deck.bpm ? ` · ${deck.bpm.toFixed(1)} BPM` : ''}`;
    };
    const eq = (band) =>
      createFader({ label: `Deck ${id} ${band} EQ`, min: -26, max: 6, step: 0.5, value: deck.eq[band], defaultValue: 0, center: true, className: `fader-${id.toLowerCase()}`, format: dbFmt, onInput: (v) => { deck.setEq(band, v); showVals(); } });
    const filter = createFader({ label: `Deck ${id} filter`, min: -1, max: 1, step: 0.01, value: deck.filter, defaultValue: 0, center: true, className: `fader-${id.toLowerCase()}`, onInput: (v) => { deck.setFilter(Math.abs(v) < 0.04 ? 0 : v); showVals(); } });
    const tempo = createFader({ label: `Deck ${id} tempo`, min: -TEMPO_RANGE, max: TEMPO_RANGE, step: 0.05, value: deck.tempo, defaultValue: 0, center: true, className: `fader-${id.toLowerCase()}`, onInput: (v) => { deck.setTempo(v); showVals(); } });
    const matchBtn = h('button', { class: 'btn btn-quiet' }, `Match BPM to Deck ${other.id}`);
    matchBtn.addEventListener('click', () => {
      const pct = matchTempo(other.bpm, deck.track?.bpm);
      if (pct === null) {
        notify(other.bpm && deck.track?.bpm ? 'The BPMs are too far apart for the ±8% tempo range.' : 'Both decks need a detected BPM first.', 'warn');
        return;
      }
      deck.setTempo(pct);
      tempo.set(deck.tempo);
      showVals();
      notify(`Deck ${id} now plays at ${deck.bpm.toFixed(1)} BPM. Align the beats by ear with CUE and PLAY.`, 'ok');
    });
    const lowF = eq('low');
    const midF = eq('mid');
    const highF = eq('high');
    const resetBtn = h('button', { class: 'btn btn-quiet' }, 'Reset EQ & filter');
    resetBtn.addEventListener('click', () => {
      for (const b of ['low', 'mid', 'high']) deck.setEq(b, 0);
      deck.setFilter(0);
      lowF.set(0);
      midF.set(0);
      highF.set(0);
      filter.set(0);
      showVals();
    });
    const ejectBtn = h('button', { class: 'btn btn-quiet btn-danger-text' }, icon('eject'), 'Take song off the deck');
    ejectBtn.addEventListener('click', async () => {
      if (engine.audibility(id) > 0.05) {
        const ok = await confirmSheet({ title: `Eject live Deck ${id}?`, message: 'The room will stop hearing this deck.', confirmLabel: 'Eject', danger: true });
        if (!ok) return;
      }
      local.eject(id);
      sheet.close();
    });
    const body = h(
      'div',
      { class: 'deck-sheet' },
      h('div', { class: 'ctl-group' }, h('div', { class: 'ctl-head' }, 'EQ'), row('HIGH', highF, vals.high), row('MID', midF, vals.mid), row('LOW', lowF, vals.low)),
      h('div', { class: 'ctl-group' }, h('div', { class: 'ctl-head' }, 'FILTER'), row('LOW-PASS ◂ ▸ HIGH-PASS', filter, vals.filter)),
      h('div', { class: 'ctl-group' }, h('div', { class: 'ctl-head' }, 'TEMPO'), row('±8%', tempo, vals.tempo), h('div', { class: 'ctl-actions' }, matchBtn)),
      h('div', { class: 'ctl-actions' }, resetBtn, ejectBtn),
      h('p', { class: 'fine' }, 'Double-tap any control to reset it. Tempo changes pitch, like a turntable.'),
    );
    const sheet = openSheet({ title: `Deck ${id} · ${deck.track?.title || 'empty'}`, body, className: `sheet-deck sheet-deck-${id.toLowerCase()}` });
    showVals();
  }

  // ---------- deck card ----------

  function buildDeck(id) {
    const deck = engine.decks[id];
    const title = h('span', { class: 'deck-t' });
    const artist = h('span', { class: 'deck-a' });
    const titleBtn = h('button', { class: 'deck-title', 'aria-label': `Deck ${id} queue` }, title, artist);
    titleBtn.addEventListener('click', () => openQueue(id));
    const state = h('span', { class: 'deck-state' });
    const bpmV = h('span', { class: 'deck-bpm-v' }, '—');
    const tempoV = h('span', { class: 'deck-tempo' });
    const head = h(
      'div',
      { class: 'deck-head' },
      h('span', { class: 'deck-letter', 'aria-hidden': 'true' }, id),
      titleBtn,
      state,
      h('div', { class: 'deck-bpm' }, bpmV, h('span', { class: 'deck-bpm-u' }, 'BPM'), tempoV),
    );
    const wave = createWaveform({
      color: COLORS[id].main,
      dim: COLORS[id].dim,
      onSeek: (t) => deck.seek(t),
      onScrub: (dt) => {
        if (!deck.playing) deck.seek(deck.position + dt);
      },
    });
    const elapsed = h('span', { class: 'deck-el' }, '0:00');
    const remaining = h('span', { class: 'deck-rem' }, '-0:00');
    wave.hud.append(elapsed, remaining);

    const cueBtn = h('button', { class: 'deck-cue', 'aria-label': `Cue Deck ${id}` }, 'CUE');
    cueBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try {
        cueBtn.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      engine.unlock();
      deck.cueDown();
    });
    const cueUp = () => deck.cueUp();
    cueBtn.addEventListener('pointerup', cueUp);
    cueBtn.addEventListener('pointercancel', cueUp);
    cueBtn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        engine.unlock();
        deck.cueDown();
      }
    });
    cueBtn.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') deck.cueUp();
    });

    const playBtn = h('button', { class: 'deck-play', 'aria-label': `Play Deck ${id}` }, icon('play', 'ic-play'), icon('pause', 'ic-pause'));
    onPress(playBtn, () => {
      engine.unlock();
      deck.toggle();
    });

    const vol = createFader({
      label: `Deck ${id} volume`,
      value: deck.volume,
      defaultValue: 0.9,
      className: `fader-vol fader-${id.toLowerCase()}`,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => deck.setVolume(v),
    });
    const moreBtn = h('button', { class: 'icon-btn deck-more', 'aria-label': `Deck ${id} EQ, filter and tempo` }, icon('sliders'));
    moreBtn.addEventListener('click', () => openDeckSheet(id));
    const controls = h('div', { class: 'deck-controls' }, cueBtn, playBtn, h('div', { class: 'deck-vol' }, h('span', { class: 'mini-label' }, 'VOL'), vol.el), moreBtn);

    // NEXT: what this deck plays after its NOW song, and the queue.
    const nextT = h('span', { class: 'deck-next-t' });
    const qCount = h('span', { class: 'q-count' });
    const nextRow = h('button', { class: 'deck-next', 'aria-label': `Queue ${id}` }, h('span', { class: 'tag tag-next' }, 'NEXT'), nextT, h('span', { class: 'q-btn' }, icon('queue'), qCount));
    nextRow.addEventListener('click', () => openQueue(id));

    const addBtn = h('button', { class: 'btn btn-load' }, icon('plus'), `Add songs to Deck ${id}`);
    addBtn.addEventListener('click', () => openAdd(id));
    const empty = h('div', { class: 'deck-empty' }, addBtn, h('span', { class: 'fine' }, `Queue ${id} is empty · your own MP3, M4A, WAV, AIFF or FLAC files`));
    const loadNowBtn = h('button', { class: 'btn btn-sm' }, 'Load');
    loadNowBtn.addEventListener('click', () => local.loadDeck(id));
    const waitText = h('span', {});
    const loading = h('div', { class: 'deck-loading', 'aria-live': 'polite' }, h('span', { class: 'spinner' }), waitText);
    const waiting = h('div', { class: 'deck-wait' }, h('span', { class: 'deck-wait-t' }), loadNowBtn);

    const card = h('article', { class: `deck deck-${id.toLowerCase()}`, 'aria-label': `Deck ${id}` }, head, wave.el, controls, nextRow, empty, loading, waiting);

    let lastSec = -1;
    let lastState = '';
    function staticUpdate() {
      const now = queues.now(KIND, id);
      const onDeck = local.isOnDeck(id);
      const next = queues.next(KIND, id);
      const qLen = queues.queue(KIND, id).length;
      const isLoading = deck.loading || local.store.get().loading[id];
      card.classList.toggle('is-empty', !now && !deck.loaded && !isLoading);
      card.classList.toggle('is-loading', Boolean(isLoading));
      card.classList.toggle('is-waiting', Boolean(now && !onDeck && !isLoading && !deck.loaded));
      waitText.textContent = `Loading ${now?.title || 'song'}…`;
      waiting.firstChild.textContent = now ? `Ready to load: ${now.title}` : '';
      title.textContent = now?.title || deck.track?.title || 'No song';
      artist.textContent = now?.artist || deck.track?.artist || (now ? '' : 'Tap + to add songs');
      bpmV.textContent = deck.bpm ? deck.bpm.toFixed(1) : '—';
      tempoV.textContent = deck.tempo ? `${deck.tempo > 0 ? '+' : ''}${deck.tempo.toFixed(1)}%` : '';
      wave.setPeaks(onDeck ? deck.track?.peaks || null : null);
      nextT.textContent = next ? `${next.title}${next.artist ? ` — ${next.artist}` : ''}` : qLen ? '' : 'Queue empty · tap to add';
      nextRow.classList.toggle('is-empty', !next);
      qCount.textContent = String(qLen);
      lastSec = -1;
    }
    function frame() {
      const pos = deck.position;
      const dur = deck.duration;
      const sec = Math.floor(pos);
      if (sec !== lastSec) {
        lastSec = sec;
        elapsed.textContent = formatTime(pos);
        remaining.textContent = `-${formatTime(Math.max(0, dur - pos))}`;
      }
      const audible = engine.audibility(id) > 0.04;
      let s = '';
      if (deck.loading) s = 'LOADING';
      else if (!deck.loaded) s = '';
      else if (deck.playing && deck.cuePreview) s = 'CUE PREVIEW';
      else if (deck.playing) s = audible ? 'LIVE' : 'OFF AIR';
      else if (dur && pos >= dur - 0.05) s = 'END';
      else if (Math.abs(pos - deck.cuePoint) < 0.02) s = 'CUED';
      else s = 'PAUSED';
      if (s !== lastState) {
        lastState = s;
        state.textContent = s;
        state.className = `deck-state state-${s.toLowerCase().replace(/\s+/g, '-')}`;
        card.classList.toggle('is-live', s === 'LIVE');
        card.classList.toggle('is-playing', deck.playing);
        playBtn.classList.toggle('is-playing', deck.playing && !deck.cuePreview);
        playBtn.setAttribute('aria-label', `${deck.playing && !deck.cuePreview ? 'Pause' : 'Play'} Deck ${id}`);
      }
      wave.draw(pos, dur, deck.loaded ? deck.cuePoint : -1, deck.playing);
    }
    deck.on(() => staticUpdate());
    staticUpdate();
    return { card, frame, staticUpdate, wave, vol };
  }

  // ---------- mixer strip ----------

  const xf = createFader({
    label: 'Crossfader',
    min: 0,
    max: 1,
    step: 0.001,
    value: 0.5,
    defaultValue: 0.5,
    className: 'fader-x',
    format: (v) => (v < 0.02 ? 'Deck A only' : v > 0.98 ? 'Deck B only' : `${Math.round((1 - v) * 100)}% A · ${Math.round(v * 100)}% B`),
    onInput: (v) => engine.setCrossfader(v),
  });
  const liveA = h('span', { class: 'x-live x-live-a' }, 'A');
  const liveB = h('span', { class: 'x-live x-live-b' }, 'B');
  const xRow = h('div', { class: 'x-row' }, liveA, xf.el, liveB);

  const autoDir = h('span', { class: 'auto-dir' }, '→ B');
  const autoLabel = h('span', { class: 'auto-l' }, 'AUTO MIX');
  const autoProg = h('span', { class: 'auto-prog' });
  const autoBtn = h('button', { class: 'btn-auto', 'aria-label': 'Automatic transition to the other deck' }, autoProg, autoLabel, autoDir);
  autoBtn.addEventListener('click', () => {
    if (engine.automix) {
      engine.cancelAutomix();
      return;
    }
    try {
      const r = engine.startAutomix(local.seconds);
      if (r) notify(`Mixing into Deck ${r.to} over ${local.seconds} s. Deck ${r.from} stops at the end and loads its next song.`, 'info');
    } catch (e) {
      notify(e.message.replace('Load a track on', 'Add a song to'), 'warn');
    }
  });
  const durChip = h('button', { class: 'chip chip-dur', 'aria-pressed': 'true' });
  const showDur = () => {
    durChip.textContent = `${local.seconds}s`;
    durChip.setAttribute('aria-label', `Transition length ${local.seconds} seconds. Tap to change.`);
  };
  durChip.addEventListener('click', () => {
    local.cycleSeconds();
    showDur();
  });
  showDur();

  const djState = h('span', { class: 'dj-state' });
  const djBtn = h('button', { class: 'btn-autodj', 'aria-pressed': 'false' }, h('span', { class: 'dj-l' }, 'AUTO DJ'), djState);
  djBtn.addEventListener('click', () => {
    const on = !local.autoDj;
    local.setAutoDj(on);
    notify(on ? `AUTO DJ on: DJKELAD mixes into the other deck ${local.seconds} s before each song ends, and reloads the deck from its queue.` : 'AUTO DJ off. You choose when to mix.', 'info');
  });

  const recTime = h('span', { class: 'rec-time' });
  const recLabel = h('span', { class: 'rec-l' }, 'REC');
  const recBtn = h('button', { class: 'btn-rec', 'aria-label': 'Start recording the mix' }, icon('record', 'rec-dot'), recLabel, recTime);
  recBtn.addEventListener('click', toggleRecording);
  const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, h('div', { class: 'meter-fill' }));
  const mixer = h(
    'section',
    { class: 'mixer', 'aria-label': 'Mixer' },
    xRow,
    h('div', { class: 'mixer-actions' }, h('div', { class: 'auto-group' }, autoBtn, durChip), djBtn, recBtn),
    meter,
  );

  async function toggleRecording() {
    if (!engine.isRecording) {
      try {
        await engine.startRecording({ format: settings.recFormat() });
        notify('Recording the decks’ master output. Spotify is never recorded.', 'info');
      } catch (e) {
        notify(`Recording could not start: ${e.message}`, 'error');
      }
      return;
    }
    const ok = await confirmSheet({
      title: 'Stop recording?',
      message: `Your mix so far (${formatTime(engine.recordingElapsed())}) will be saved on this device.`,
      confirmLabel: 'Stop & save',
      cancelLabel: 'Keep recording',
      danger: true,
    });
    if (!ok || !engine.isRecording) return;
    try {
      const result = await engine.stopRecording();
      if (!result || !result.blob.size) {
        notify('The recording came out empty. Try WAV recording in Settings.', 'error');
        return;
      }
      const rec = await library.addRecording(result);
      onRecordingSaved(rec);
    } catch (e) {
      notify(`Saving the recording failed: ${e.message}`, 'error');
    }
  }

  decksUI.A = buildDeck('A');
  decksUI.B = buildDeck('B');
  const refreshStatic = () => {
    decksUI.A.staticUpdate();
    decksUI.B.staticUpdate();
  };
  queues.subscribe((reason, detail) => {
    if (!detail || !detail.kind || detail.kind === KIND) refreshStatic();
  });
  local.store.subscribe(() => {
    refreshStatic();
    showDj();
  });
  library.store.subscribe(refreshStatic);
  function showDj() {
    djBtn.classList.toggle('is-on', local.autoDj);
    djBtn.setAttribute('aria-pressed', String(local.autoDj));
    djState.textContent = local.autoDj ? 'ON' : 'OFF';
  }
  showDj();

  const help = h(
    'div',
    { class: 'decks-help' },
    h('b', {}, 'How it works: '),
    'add songs to Queue A and Queue B, play Deck A, then press AUTO MIX — or turn on AUTO DJ and DJKELAD mixes through both queues by itself.',
  );
  const el = h('div', { class: 'decks-body decks-local' }, h('div', { class: 'decks-layout' }, decksUI.A.card, mixer, decksUI.B.card), help);

  let lastMixer = '';
  function frame() {
    decksUI.A.frame();
    decksUI.B.frame();
    if (!xf.dragging) xf.set(engine.crossfader);
    const am = engine.automix;
    const dirTarget = am ? am.to : engine.automixTarget();
    const sig = `${am ? 'run' : 'idle'}|${dirTarget}|${engine.isRecording}`;
    if (sig !== lastMixer) {
      lastMixer = sig;
      autoBtn.classList.toggle('is-running', Boolean(am));
      autoLabel.textContent = am ? 'STOP' : 'AUTO MIX';
      autoDir.textContent = dirTarget === 'B' ? '→ B' : '← A';
      autoBtn.classList.toggle('to-a', dirTarget === 'A');
      recBtn.classList.toggle('is-recording', engine.isRecording);
      recLabel.textContent = engine.isRecording ? 'STOP' : 'REC';
      recBtn.setAttribute('aria-label', engine.isRecording ? 'Stop recording' : 'Start recording the mix');
    }
    autoProg.style.transform = `scaleX(${am ? am.progress : 0})`;
    if (am) autoDir.textContent = `${dirTarget === 'B' ? '→ B' : '← A'} ${Math.ceil(am.remaining)}s`;
    recTime.textContent = engine.isRecording ? formatTime(engine.recordingElapsed()) : '';
    liveA.classList.toggle('on', engine.audibility('A') > 0.04);
    liveB.classList.toggle('on', engine.audibility('B') > 0.04);
    const lvl = engine.masterLevel();
    meter.firstChild.style.transform = `scaleX(${Math.min(1, lvl)})`;
    meter.classList.toggle('hot', lvl > 0.98);
    raf = requestAnimationFrame(frame);
  }

  return {
    el,
    onShow() {
      decksUI.A.wave.resize();
      decksUI.B.wave.resize();
      refreshStatic();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    onHide() {
      cancelAnimationFrame(raf);
    },
  };
}
