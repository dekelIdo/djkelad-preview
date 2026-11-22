// Spotify library browser: search, playlists, Liked Songs, recently played.
// Every song offers the deck actions (tap = PLAY ON / ADD TO deck, +A / +B = quick add).
// Used on the Spotify tab and inside the "Add music" sheet on the Decks screen.
import { h, icon } from '../ui/dom.js';
import { formatTime } from '../mixer/curves.js';
import { debounce } from '../util.js';

const TABS = [
  { key: 'playlists', label: 'Playlists', icon: 'list' },
  { key: 'liked', label: 'Liked', icon: 'heart' },
  { key: 'recent', label: 'Recent', icon: 'clock' },
];
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // `${profile}:${tab}` -> { data, at }

export function art(url, cls = 'sp-thumb') {
  if (!url) return h('span', { class: `${cls} art-empty` }, icon('music'));
  return h('img', { class: cls, src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
}

/**
 * @param {{
 *   controller: any,
 *   onTrack: (t: object) => void,
 *   quickAdd: (deck: 'A'|'B', t: object) => void,
 *   addAll: (deck: 'A'|'B', tracks: object[], label: string) => void,
 *   playOutside: (contextUri: string, name: string) => void,
 *   badges?: () => Map<string, string>,
 * }} deps
 */
export function createSpotifyBrowser({ controller, onTrack, quickAdd, addAll, playOutside, badges }) {
  const profileKey = () => controller.store.get().profile?.id || 'anon';
  const searchInput = h('input', { class: 'search-input', type: 'search', placeholder: 'Search any song on Spotify', 'aria-label': 'Search Spotify songs', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const searchClear = h('button', { class: 'icon-btn search-clear', 'aria-label': 'Clear search', hidden: true }, icon('close'));
  const searchBox = h('div', { class: 'search-box' }, icon('search', 'search-ic'), searchInput, searchClear);
  const tabBtns = TABS.map((t) => {
    const b = h('button', { class: 'seg-btn', role: 'tab', 'aria-selected': 'false', dataset: { tab: t.key } }, icon(t.icon), h('span', {}, t.label));
    b.addEventListener('click', () => {
      clearSearch();
      setTab(t.key);
    });
    return b;
  });
  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Spotify library' }, tabBtns);
  const list = h('div', { class: 'sp-list', role: 'list' });
  const el = h('section', { class: 'sp-browse', 'aria-label': 'Spotify library' }, searchBox, seg, list);

  const model = {
    tab: 'playlists',
    data: { playlists: null, liked: null, recent: null },
    loading: {},
    errors: {},
    search: { q: '', items: [], next: null, loading: false, error: null, total: null },
    openPlaylist: null,
  };

  function setTab(key) {
    model.tab = key;
    if (key !== 'playlists') model.openPlaylist = null;
    for (const b of tabBtns) b.setAttribute('aria-selected', String(b.dataset.tab === key));
    if (!model.data[key] && !model.loading[key]) {
      const c = cache.get(`${profileKey()}:${key}`);
      if (c && Date.now() - c.at < CACHE_MS) model.data[key] = c.data;
      else loadTab(key);
    }
    renderList();
  }

  async function loadTab(key, append = false) {
    model.loading[key] = true;
    model.errors[key] = null;
    renderList();
    try {
      const current = model.data[key];
      const offset = append && current?.next ? current.next : 0;
      const r = await controller.library[key](offset);
      model.data[key] = append && current ? { ...r, items: current.items.concat(r.items) } : r;
      cache.set(`${profileKey()}:${key}`, { data: model.data[key], at: Date.now() });
    } catch (e) {
      if (!controller.guardAuth(e)) model.errors[key] = controller.describeError(e);
    } finally {
      model.loading[key] = false;
      renderList();
    }
  }

  async function openPlaylist(p) {
    model.openPlaylist = { playlist: p, items: [], next: null, loading: p.contentsAvailable, error: null };
    renderList();
    list.scrollTop = 0;
    if (!p.contentsAvailable) return;
    await loadPlaylistItems(false);
  }

  async function loadPlaylistItems(append) {
    const op = model.openPlaylist;
    if (!op) return;
    op.loading = true;
    renderList();
    try {
      const r = await controller.library.playlistItems(op.playlist.id, append ? op.next : 0);
      if (model.openPlaylist !== op) return;
      op.items = append ? op.items.concat(r.items) : r.items;
      op.next = r.next;
    } catch (e) {
      if (!controller.guardAuth(e)) op.error = e?.status === 403 || e?.status === 404 ? 'Spotify only shares the songs of playlists you own or collaborate on with apps like DJKELAD. Search for the songs instead.' : controller.describeError(e);
    } finally {
      op.loading = false;
      if (model.openPlaylist === op) renderList();
    }
  }

  const runSearch = debounce(async (q) => {
    if (!q) return;
    model.search = { q, items: [], next: null, loading: true, error: null, total: null };
    renderList();
    try {
      const r = await controller.library.search(q, 0);
      if (model.search.q !== q) return;
      model.search = { q, items: r.items, next: r.next, loading: false, error: null, total: r.total };
    } catch (e) {
      if (model.search.q !== q) return;
      model.search = { q, items: [], next: null, loading: false, error: controller.guardAuth(e) ? null : controller.describeError(e), total: null };
    }
    renderList();
  }, 350);

  async function moreSearch() {
    const s = model.search;
    if (!s.next || s.loading) return;
    s.loading = true;
    renderList();
    try {
      const r = await controller.library.search(s.q, s.next);
      if (model.search !== s) return;
      s.items = s.items.concat(r.items);
      s.next = r.next;
    } catch (e) {
      s.error = controller.describeError(e);
    } finally {
      s.loading = false;
      renderList();
    }
  }

  function clearSearch() {
    if (!searchInput.value) return;
    searchInput.value = '';
    searchClear.hidden = true;
    model.search = { q: '', items: [], next: null, loading: false, error: null, total: null };
    seg.classList.remove('dimmed');
    renderList();
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.hidden = !searchInput.value;
    seg.classList.toggle('dimmed', Boolean(q));
    if (!q) {
      model.search = { q: '', items: [], next: null, loading: false, error: null, total: null };
      renderList();
      return;
    }
    runSearch(q);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchInput.blur();
  });
  searchClear.addEventListener('click', () => {
    clearSearch();
    searchInput.focus();
  });

  function trackRow(t) {
    const cur = controller.store.get().playback?.track?.uri === t.uri;
    const badge = badges?.().get(t.uri);
    const main = h(
      'button',
      { class: 'trk-main', disabled: !t.playable, 'aria-label': `${t.name} by ${t.artists}: deck options` },
      art(t.image),
      h('span', { class: 'trk-meta' }, h('span', { class: 'trk-t' }, t.name), h('span', { class: 'trk-s' }, t.artists || t.album)),
      badge ? h('span', { class: `trk-badge badge-${badge[0].toLowerCase()}` }, badge) : null,
      h('span', { class: 'trk-dur' }, t.durationMs ? formatTime(t.durationMs / 1000) : ''),
    );
    main.addEventListener('click', () => onTrack(t));
    const row = h('div', { class: `trk ${cur ? 'is-current' : ''} ${t.playable ? '' : 'is-disabled'}`, role: 'listitem', dataset: { uri: t.uri } }, main);
    if (t.playable) {
      for (const d of ['A', 'B']) {
        const b = h('button', { class: `q-add q-add-${d.toLowerCase()}`, 'aria-label': `Add ${t.name} to Queue ${d}` }, icon('plus'), d);
        b.addEventListener('click', () => quickAdd(d, t));
        row.append(b);
      }
    }
    return row;
  }

  const note = (text, cls = 'empty-note') => h('p', { class: cls }, text);
  function moreButton(label, onClick, loading) {
    const b = h('button', { class: 'btn btn-quiet btn-block more-btn', disabled: loading }, loading ? 'Loading…' : label);
    b.addEventListener('click', onClick);
    return b;
  }

  function renderList() {
    const frag = [];
    const s = model.search;
    if (s.q) {
      frag.push(h('div', { class: 'list-label' }, s.total != null ? `Songs · ${s.total.toLocaleString()} results` : 'Songs'));
      if (s.error) frag.push(note(s.error, 'error-note'));
      s.items.forEach((t) => frag.push(trackRow(t)));
      if (s.loading && !s.items.length) frag.push(h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
      else if (!s.loading && !s.items.length && !s.error) frag.push(note('No songs found.'));
      if (s.next) frag.push(moreButton('More results', moreSearch, s.loading));
    } else if (model.tab === 'playlists' && model.openPlaylist) {
      const op = model.openPlaylist;
      const p = op.playlist;
      const back = h('button', { class: 'btn btn-quiet btn-sm' }, icon('back'), 'Playlists');
      back.addEventListener('click', () => {
        model.openPlaylist = null;
        renderList();
      });
      const actions = h('div', { class: 'pl-actions' });
      const playable = op.items.filter((t) => t.playable);
      if (p.contentsAvailable) {
        for (const d of ['A', 'B']) {
          const b = h('button', { class: `btn btn-sm pl-add pl-add-${d.toLowerCase()}`, disabled: !playable.length }, icon('plus'), `All to Queue ${d}`);
          b.addEventListener('click', () => addAll(d, playable, p.name));
          actions.append(b);
        }
      } else {
        const b = h('button', { class: 'btn btn-sm btn-quiet' }, icon('play'), 'Play in Spotify (not on a deck)');
        b.addEventListener('click', () => playOutside(p.uri, p.name));
        actions.append(b);
      }
      frag.push(
        h(
          'div',
          { class: 'pl-head' },
          back,
          h('div', { class: 'pl-hero' }, art(p.imageLarge || p.image, 'pl-art'), h('div', { class: 'pl-meta' }, h('div', { class: 'pl-name' }, p.name), h('div', { class: 'pl-sub' }, [p.owner, p.total != null ? `${p.total} songs` : null].filter(Boolean).join(' · ')), actions)),
        ),
      );
      if (!p.contentsAvailable) frag.push(note('Spotify only shows apps like DJKELAD the songs of playlists you own or collaborate on. Search for these songs to put them on a deck, or play the whole playlist in Spotify.', 'info-note'));
      if (op.error) frag.push(note(op.error, 'info-note'));
      op.items.forEach((t) => frag.push(trackRow(t)));
      if (op.loading) frag.push(h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
      if (op.next && !op.loading) frag.push(moreButton('More songs', () => loadPlaylistItems(true), false));
    } else {
      const key = model.tab;
      const data = model.data[key];
      if (model.errors[key]) frag.push(note(model.errors[key], 'error-note'));
      if (key === 'playlists' && data) {
        if (!data.items.length) frag.push(note('No playlists on this account yet.'));
        for (const p of data.items) {
          const row = h(
            'button',
            { class: 'pl-row', role: 'listitem' },
            art(p.image),
            h('span', { class: 'trk-meta' }, h('span', { class: 'trk-t' }, p.name), h('span', { class: 'trk-s' }, [p.contentsAvailable ? null : 'Songs hidden by Spotify', p.total != null ? `${p.total} songs` : null, p.owner].filter(Boolean).join(' · '))),
            icon('chevron', 'row-chev'),
          );
          row.addEventListener('click', () => openPlaylist(p));
          frag.push(row);
        }
      } else if (data) {
        if (!data.items.length) frag.push(note(key === 'liked' ? 'No Liked Songs yet.' : 'Nothing played recently.'));
        data.items.forEach((t) => frag.push(trackRow(t)));
      }
      if (model.loading[key]) frag.push(h('div', { class: 'list-loading' }, h('span', { class: 'spinner' })));
      else if (data?.next) frag.push(moreButton('Load more', () => loadTab(key, true), false));
    }
    list.replaceChildren(...frag);
  }

  setTab('playlists');

  return {
    el,
    searchInput,
    rerender: renderList,
    focusSearch() {
      searchInput.focus();
    },
    markCurrent(uri) {
      for (const row of list.querySelectorAll('.trk')) row.classList.toggle('is-current', row.dataset.uri === uri);
    },
  };
}
