// One imported file as a row with the deck actions (+A / +B, tap for PLAY ON / ADD TO).
import { h, icon } from '../ui/dom.js';
import { formatTime } from '../mixer/curves.js';
import { formatBytes } from '../util.js';

/**
 * @param {object} t library record
 * @param {{ onOpen: (t: object) => void, quickAdd: (deck: 'A'|'B', t: object) => void, extra?: Node[], badge?: string | null }} opts
 */
export function localTrackRow(t, { onOpen, quickAdd, extra = [], badge = null }) {
  const main = h(
    'button',
    { class: 'lib-row-main', 'aria-label': `${t.title}: deck options` },
    h('span', { class: 'pick-art' }, icon('music')),
    h('span', { class: 'pick-meta' }, h('span', { class: 'pick-t' }, t.title), h('span', { class: 'pick-s' }, [t.artist, t.duration ? formatTime(t.duration) : null, t.bpm ? `${t.bpm.toFixed(1)} BPM` : null, formatBytes(t.size)].filter(Boolean).join(' · '))),
    badge ? h('span', { class: `trk-badge badge-${badge[0].toLowerCase()}` }, badge) : null,
  );
  main.addEventListener('click', () => onOpen(t));
  const acts = h('span', { class: 'lib-acts' });
  for (const d of ['A', 'B']) {
    const b = h('button', { class: `q-add q-add-${d.toLowerCase()}`, 'aria-label': `Add ${t.title} to Queue ${d}` }, icon('plus'), d);
    b.addEventListener('click', () => quickAdd(d, t));
    acts.append(b);
  }
  acts.append(...extra);
  return h('div', { class: 'lib-row', role: 'listitem', dataset: { id: t.id } }, main, acts);
}

/** Where a song sits on the decks, for a small badge: "A", "B", "A·next"… */
export function deckBadges(queues, kind) {
  const map = new Map();
  for (const id of ['A', 'B']) {
    const now = queues.now(kind, id);
    if (now && !map.has(now.id)) map.set(now.id, id);
    for (const it of queues.queue(kind, id)) if (!map.has(it.id)) map.set(it.id, `${id}+`);
  }
  return map;
}
