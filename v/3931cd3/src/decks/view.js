// DECKS screen shell: source switch (MY FILES / SPOTIFY), "Add music", stage mode.
import { h, icon } from '../ui/dom.js';

/**
 * @param {{ queues: any, localView: any, spotifyView: any, engine: any, spot: any, openAdd: (deck?: string) => void, toggleStage: () => boolean }} deps
 */
export function createDecksScreen({ queues, localView, spotifyView, engine, spot, openAdd, toggleStage }) {
  const modeBtns = {};
  const seg = h('div', { class: 'mode-seg', role: 'tablist', 'aria-label': 'Deck source' });
  for (const [kind, label, sub] of [['local', 'MY FILES', 'real mixing'], ['spotify', 'SPOTIFY', 'one at a time']]) {
    const b = h(
      'button',
      { class: `mode-btn mode-${kind}`, role: 'tab', dataset: { mode: kind } },
      h('span', { class: 'mode-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'mode-l' }, label),
      h('span', { class: 'mode-s' }, sub),
    );
    b.addEventListener('click', () => queues.setMode(kind));
    modeBtns[kind] = b;
    seg.append(b);
  }
  const addBtn = h('button', { class: 'btn btn-add-music' }, icon('plus'), h('span', {}, 'Add music'));
  addBtn.addEventListener('click', () => openAdd());
  const stageBtn = h('button', { class: 'icon-btn stage-btn', 'aria-label': 'Full-screen performance mode' }, icon('expand'));
  stageBtn.addEventListener('click', () => {
    const on = toggleStage();
    stageBtn.replaceChildren(icon(on ? 'shrink' : 'expand'));
    stageBtn.setAttribute('aria-label', on ? 'Leave performance mode' : 'Full-screen performance mode');
  });
  const bar = h('div', { class: 'mode-bar' }, seg, addBtn, stageBtn);
  const rotate = h('p', { class: 'rotate-hint' }, 'Turn your phone sideways for both decks side by side.');

  const localWrap = h('div', { class: 'mode-panel' }, localView.el);
  const spotifyWrap = h('div', { class: 'mode-panel' }, spotifyView.el);
  const el = h('div', { class: 'decks-screen' }, bar, rotate, localWrap, spotifyWrap);

  let visible = false;
  let shown = null;
  function apply() {
    const mode = queues.mode;
    for (const [k, b] of Object.entries(modeBtns)) b.setAttribute('aria-selected', String(k === mode));
    el.dataset.mode = mode;
    localWrap.hidden = mode !== 'local';
    spotifyWrap.hidden = mode !== 'spotify';
    if (visible && shown !== mode) {
      (shown === 'local' ? localView : shown === 'spotify' ? spotifyView : null)?.onHide();
      (mode === 'local' ? localView : spotifyView).onShow();
      shown = mode;
    }
  }
  function audio() {
    modeBtns.local.classList.toggle('is-audible', engine.anyPlaying);
    modeBtns.spotify.classList.toggle('is-audible', spot.anyPlaying);
  }
  queues.subscribe((reason) => {
    if (reason === 'mode') apply();
  });
  engine.on(audio);
  spot.store.subscribe(audio);
  setInterval(audio, 1000);
  apply();

  return {
    el,
    onShow() {
      visible = true;
      shown = null;
      apply();
      audio();
    },
    onHide() {
      visible = false;
      localView.onHide();
      spotifyView.onHide();
      shown = null;
    },
    syncStageButton(on) {
      stageBtn.replaceChildren(icon(on ? 'shrink' : 'expand'));
    },
  };
}
