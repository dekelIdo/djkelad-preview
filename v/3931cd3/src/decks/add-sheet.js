// "Add music" sheet on the Decks screen: search Spotify or pick your own files
// while the decks keep playing.
import { h, icon, openSheet } from '../ui/dom.js';
import { pickAudioFiles } from '../ui/files.js';
import { createSpotifyBrowser } from '../spotify/browser.js';
import { deckBadges, localTrackRow } from '../library/track-row.js';
import { itemFromLocal, itemFromSpotify } from './items.js';

/**
 * @param {{ kind: 'local'|'spotify', controller: any, library: any, queues: any, actions: any, notify: Function, goToSpotify: () => void }} deps
 */
export function openAddSheet(deps) {
  const { controller, library, queues, actions, notify, goToSpotify } = deps;
  let kind = deps.kind;
  let sheet = null;
  const tabBtns = {};
  const seg = h('div', { class: 'seg add-seg', role: 'tablist' });
  for (const [k, label, ic] of [['spotify', 'Spotify', 'music'], ['local', 'My files', 'list']]) {
    const b = h('button', { class: 'seg-btn', role: 'tab', dataset: { tab: k } }, icon(ic), h('span', {}, label));
    b.addEventListener('click', () => {
      kind = k;
      render();
    });
    tabBtns[k] = b;
    seg.append(b);
  }
  const content = h('div', { class: 'add-content' });
  const body = h('div', { class: 'add-sheet' }, seg, content);

  // ---- Spotify ----
  let browser = null;
  function spotifyPanel() {
    const st = controller.store.get();
    if (st.phase !== 'ready') {
      const go = h('button', { class: 'btn btn-primary btn-lg' }, st.phase === 'unconfigured' ? 'Set up Spotify' : 'Connect Spotify');
      go.addEventListener('click', () => {
        sheet.close();
        goToSpotify();
      });
      return h('div', { class: 'add-gate' }, h('p', {}, 'Connect your Spotify Premium account to put songs from your playlists and search on Deck A and Deck B.'), go);
    }
    if (!browser) {
      browser = createSpotifyBrowser({
        controller,
        onTrack: (t) => actions.openSong(itemFromSpotify(t)),
        quickAdd: (d, t) => actions.addTo(d, itemFromSpotify(t)),
        addAll: (d, tracks, label) => actions.addAll(d, tracks.map(itemFromSpotify).filter(Boolean), label),
        playOutside: (uri) => {
          controller.play({ contextUri: uri, track: null });
          sheet.close();
        },
        badges: () => deckBadges(queues, 'spotify'),
      });
    }
    return browser.el;
  }

  // ---- My files ----
  const fileList = h('div', { class: 'lib-list', role: 'list' });
  function renderFiles() {
    const { tracks, loaded } = library.store.get();
    const badges = deckBadges(queues, 'local');
    fileList.replaceChildren(
      ...(loaded && !tracks.length ? [h('p', { class: 'empty-note' }, 'No files yet. Import MP3, M4A, WAV, AIFF or FLAC files you own.')] : []),
      ...tracks.map((t) => localTrackRow(t, { onOpen: (x) => actions.openSong(itemFromLocal(x)), quickAdd: (d, x) => actions.addTo(d, itemFromLocal(x)), badge: badges.get(t.id) || null })),
    );
  }
  function localPanel() {
    const imp = h('button', { class: 'btn btn-primary btn-block' }, icon('upload'), 'Import audio files');
    imp.addEventListener('click', () =>
      pickAudioFiles(async (files) => {
        const { added, skipped } = await library.importFiles(files);
        if (skipped.length) notify(`${skipped.length} file(s) skipped: not audio.`, 'warn');
        if (added.length) notify(`${added.length} file${added.length > 1 ? 's' : ''} imported. Tap + A or + B.`, 'ok');
      }),
    );
    renderFiles();
    return h('div', { class: 'add-local' }, imp, h('p', { class: 'fine' }, 'From the Files app on iPhone or your computer. Files stay on this device.'), fileList);
  }

  function render() {
    for (const [k, b] of Object.entries(tabBtns)) b.setAttribute('aria-selected', String(k === kind));
    content.replaceChildren(kind === 'spotify' ? spotifyPanel() : localPanel());
  }

  const unsubs = [
    library.store.subscribe(() => kind === 'local' && renderFiles()),
    queues.subscribe(() => (kind === 'local' ? renderFiles() : browser?.rerender())),
  ];
  sheet = openSheet({ title: 'Add music to the decks', body, className: 'sheet-add', onClose: () => unsubs.forEach((u) => u()) });
  render();
  return sheet;
}
