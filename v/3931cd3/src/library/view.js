// MY MUSIC screen: imported tracks (load to A / B) and recorded mixes.
import { confirmSheet, h, icon, openSheet } from '../ui/dom.js';
import { enableDrop, pickAudioFiles } from '../ui/files.js';
import { formatTime } from '../mixer/curves.js';
import { canShareFile, downloadBlob } from '../platform.js';
import { formatBytes } from '../util.js';
import { deckBadges, localTrackRow } from './track-row.js';
import { itemFromLocal } from '../decks/items.js';

export function recordingFile(rec) {
  try {
    return new File([rec.blob], rec.name, { type: rec.mime || rec.blob.type });
  } catch {
    return rec.blob;
  }
}

/** Sheet shown after a recording is saved, and when a saved mix is opened. */
export function openRecordingSheet(rec, { notify, title = 'Mix saved' } = {}) {
  const url = URL.createObjectURL(rec.blob);
  const audio = h('audio', { controls: true, preload: 'metadata', src: url, class: 'rec-audio' });
  const file = recordingFile(rec);
  const actions = h('div', { class: 'rec-actions' });
  const dl = h('button', { class: 'btn btn-primary btn-lg' }, icon('download'), 'Download');
  dl.addEventListener('click', () => downloadBlob(rec.blob, rec.name));
  actions.append(dl);
  if (canShareFile(file)) {
    const share = h('button', { class: 'btn btn-quiet btn-lg' }, icon('share'), 'Share / Save to Files');
    share.addEventListener('click', async () => {
      try {
        await navigator.share({ files: [file], title: rec.name });
      } catch (e) {
        if (e?.name !== 'AbortError') notify?.('Sharing failed. Use Download instead.', 'warn');
      }
    });
    actions.append(share);
  }
  openSheet({
    title,
    className: 'sheet-rec',
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
    body: h(
      'div',
      { class: 'rec-sheet' },
      h('div', { class: 'rec-name' }, rec.name),
      h('div', { class: 'rec-meta' }, `${formatTime(rec.durationSec)} · ${formatBytes(rec.size)} · ${String(rec.mime || '').split(';')[0]}`),
      audio,
      actions,
      h('p', { class: 'fine' }, 'Saved in DJKELAD on this device (My music → Recorded mixes). Download or share it to keep a copy anywhere.'),
    ),
  });
}

export function createLibraryView({ library, actions, queues, notify }) {
  const trackList = h('div', { class: 'lib-list', role: 'list' });
  const recList = h('div', { class: 'lib-list', role: 'list' });
  const trackCount = h('span', { class: 'count' });
  const recCount = h('span', { class: 'count' });
  const importBtn = h('button', { class: 'btn btn-primary btn-lg' }, icon('upload'), 'Import audio');
  const storageNote = h('p', { class: 'fine warn-text', hidden: true }, 'This browser is not keeping files between visits (private mode or storage full). Imported tracks last until you close the page.');

  importBtn.addEventListener('click', () => pickAudioFiles(doImport));

  async function doImport(files) {
    const { added, skipped } = await library.importFiles(files);
    if (added.length) notify(`${added.length} track${added.length > 1 ? 's' : ''} added. Tap + A or + B to queue them on a deck.`, 'ok');
    if (skipped.length) notify(`${skipped.length} file(s) skipped: not audio.`, 'warn');
  }

  function render() {
    const { tracks, recordings, loaded } = library.store.get();
    storageNote.hidden = library.persistent;
    trackCount.textContent = loaded ? String(tracks.length) : '';
    recCount.textContent = loaded ? String(recordings.length) : '';
    trackList.replaceChildren();
    if (loaded && !tracks.length) {
      trackList.append(
        h('div', { class: 'empty-card' }, h('div', { class: 'empty-t' }, 'No tracks yet'), h('p', {}, 'Import MP3, M4A, WAV, AIFF or FLAC files you own. On iPhone they come from the Files app (iCloud Drive, On My iPhone, Dropbox…). Apple Music and Spotify songs are protected and cannot be imported.')),
      );
    }
    const badges = deckBadges(queues, 'local');
    for (const t of tracks) {
      const del = h('button', { class: 'icon-btn', 'aria-label': `Remove ${t.title}` }, icon('trash'));
      del.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Remove track?', message: `“${t.title}” is removed from DJKELAD on this device. The original file is not touched.`, confirmLabel: 'Remove', danger: true });
        if (ok) library.removeTrack(t.id);
      });
      trackList.append(
        localTrackRow(t, {
          onOpen: (x) => actions.openSong(itemFromLocal(x)),
          quickAdd: (d, x) => actions.addTo(d, itemFromLocal(x)),
          extra: [del],
          badge: badges.get(t.id) || null,
        }),
      );
    }
    recList.replaceChildren();
    if (loaded && !recordings.length) {
      recList.append(h('p', { class: 'empty-note' }, 'Mixes you record on the Decks screen appear here, ready to download or share.'));
    }
    for (const r of recordings) {
      const open = h('button', { class: 'lib-row-main' }, h('span', { class: 'pick-art rec-art' }, icon('wave')), h('span', { class: 'pick-meta' }, h('span', { class: 'pick-t' }, r.name), h('span', { class: 'pick-s' }, `${formatTime(r.durationSec)} · ${formatBytes(r.size)} · ${new Date(r.createdAt).toLocaleString()}`)));
      open.addEventListener('click', () => openRecordingSheet(r, { notify, title: 'Recorded mix' }));
      const dl = h('button', { class: 'icon-btn', 'aria-label': `Download ${r.name}` }, icon('download'));
      dl.addEventListener('click', () => downloadBlob(r.blob, r.name));
      const del = h('button', { class: 'icon-btn', 'aria-label': `Delete ${r.name}` }, icon('trash'));
      del.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Delete this mix?', message: `${r.name} is deleted from this device. Downloaded copies are not affected.`, confirmLabel: 'Delete', danger: true });
        if (ok) library.removeRecording(r.id);
      });
      recList.append(h('div', { class: 'lib-row', role: 'listitem' }, open, h('span', { class: 'lib-acts' }, dl, del)));
    }
  }

  library.store.subscribe(render);
  queues.subscribe((reason, detail) => {
    if (!detail || detail.kind === 'local') render();
  });
  render();

  const el = h(
    'div',
    { class: 'lib-screen' },
    h(
      'div',
      { class: 'lib-head' },
      h('div', {}, h('h1', { class: 'screen-title' }, 'My music'), h('p', { class: 'screen-sub' }, 'Your own audio files: the source that really mixes. Tap a file for PLAY ON / ADD TO a deck. Files stay on this device.')),
      importBtn,
    ),
    storageNote,
    h('div', { class: 'drop-hint' }, icon('upload'), 'Drop audio files anywhere here'),
    h('h2', { class: 'section-title' }, 'Tracks ', trackCount),
    trackList,
    h('h2', { class: 'section-title' }, 'Recorded mixes ', recCount),
    recList,
  );
  enableDrop(el, doImport);
  return { el, onShow() {}, onHide() {} };
}
