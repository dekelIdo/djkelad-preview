// DJKELAD Web: app shell, tabs, settings, and the Spotify / decks boundary.
import { createMixerEngine } from './mixer/engine.js';
import { formatTime } from './mixer/curves.js';
import { createLocalLibrary } from './library/library.js';
import { createLibraryView, openRecordingSheet } from './library/view.js';
import { createSpotifyController } from './spotify/controller.js';
import { createSpotifyView } from './spotify/view.js';
import { isValidClientId, redirectUriFor } from './spotify/pkce.js';
import { h, icon, monogram, openSheet, toast, wordmark } from './ui/dom.js';
import { isIOS, keepScreenAwake } from './platform.js';
import { pickRecordingMime } from './mixer/recorder.js';
import { createQueues } from './decks/queues.js';
import { createLocalDecks } from './decks/local.js';
import { createSpotifyDecks } from './decks/spotify.js';
import { createDeckActions } from './decks/actions.js';
import { createLocalDecksView } from './decks/local-view.js';
import { createSpotifyDecksView } from './decks/spotify-view.js';
import { createDecksScreen } from './decks/view.js';
import { openQueueSheet } from './decks/queue-sheet.js';
import { openAddSheet } from './decks/add-sheet.js';
import { itemFromSpotify } from './decks/items.js';
import { deckBadges } from './library/track-row.js';

const CLIENT_ID_KEY = 'djkelad.spotify.clientId';
const TAB_KEY = 'djkelad.tab';
const WELCOME_KEY = 'djkelad.welcomed.v2';
const REC_FORMAT_KEY = 'djkelad.recFormat';
const IOS = isIOS();

const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

// ---------- Spotify client ID: setup link > this browser > config.js ----------

let importedClientId = false;
{
  const m = location.hash.match(/spotify-client-id=([0-9a-fA-F]{32})/);
  if (m) {
    ls.set(CLIENT_ID_KEY, m[1]);
    importedClientId = true;
    history.replaceState(null, '', location.pathname + location.search);
  }
}
const getClientId = () => ls.get(CLIENT_ID_KEY) || String(window.DJKELAD_CONFIG?.spotifyClientId || '').trim();
const redirectUri = () => redirectUriFor(location);

// ---------- core ----------

const library = createLocalLibrary();
const queues = createQueues();
let spotify = null;
let spot = null;

const engine = createMixerEngine({
  beforePlay: () => {
    // Spotify music must never play under, or be mixed with, the decks.
    if (spotify?.pauseIfPlaying()) toast('Spotify paused. Spotify music can’t be mixed with your decks.', 'info');
    return true;
  },
});

spotify = createSpotifyController({
  getClientId,
  redirectUri,
  isIOS: IOS,
  beforePlay: () => {
    if (engine.isRecording) {
      toast('Stop the recording first. DJKELAD never records Spotify.', 'warn');
      return false;
    }
    if (engine.anyPlaying) {
      engine.pauseAll();
      toast('Decks paused while Spotify plays.', 'info');
    }
    // Hand the audio session back so the Spotify app (iPhone) can play.
    engine.release();
    return true;
  },
  notify: toast,
});

const settings = {
  recFormat: () => (ls.get(REC_FORMAT_KEY) === 'wav' ? 'wav' : 'auto'),
};

// ---------- views ----------

// ---------- decks: Queue A / Queue B on two sources ----------

const local = createLocalDecks({ engine, library, queues, notify: toast });
spot = createSpotifyDecks({ controller: spotify, queues, notify: toast });
const actions = createDeckActions({ queues, local, spot, engine, notify: toast, showDecks: () => showTab('decks') });

const openQueue = (deck) => openQueueSheet({ kind: queues.mode, deck, queues, local, spot, engine, actions, controller: spotify, notify: toast });
const openAdd = () => openAddSheet({ kind: queues.mode, controller: spotify, library, queues, actions, notify: toast, goToSpotify: () => showTab('spotify') });

const spotifyView = createSpotifyView({
  controller: spotify,
  notify: toast,
  isIOS: IOS,
  redirectUri,
  getClientId,
  setClientId: (id) => {
    ls.set(CLIENT_ID_KEY, id);
    spotify.reconfigure();
  },
  browserDeps: {
    onTrack: (t) => actions.openSong(itemFromSpotify(t)),
    quickAdd: (d, t) => actions.addTo(d, itemFromSpotify(t)),
    addAll: (d, tracks, label) => actions.addAll(d, tracks.map(itemFromSpotify).filter(Boolean), label),
    playOutside: (uri) => spotify.play({ contextUri: uri, track: null }),
    badges: () => deckBadges(queues, 'spotify'),
  },
  liveDeck: () => (spot.live && spot.deckPlayback(spot.live) ? spot.live : null),
  goToDecks: () => {
    queues.setMode('spotify');
    showTab('decks');
  },
});

const localView = createLocalDecksView({
  engine,
  local,
  queues,
  library,
  notify: toast,
  settings,
  onRecordingSaved: (rec) => openRecordingSheet(rec, { notify: toast }),
  openQueue,
  openAdd,
});
const spotifyDecksView = createSpotifyDecksView({
  controller: spotify,
  spot,
  queues,
  notify: toast,
  openQueue,
  openAdd,
  openDevices: () => spotifyView.openDeviceSheet(),
  goToSpotify: () => showTab('spotify'),
});
const decksView = createDecksScreen({ queues, localView, spotifyView: spotifyDecksView, engine, spot, openAdd, toggleStage });

const libraryView = createLibraryView({ library, actions, queues, notify: toast });
queues.subscribe((reason, detail) => {
  if (reason !== 'played' && (!detail?.kind || detail.kind === 'spotify')) spotifyView.refreshList();
});

const SCREENS = {
  decks: { view: decksView, label: 'Decks', sub: 'Perform', icon: 'decks' },
  spotify: { view: spotifyView, label: 'Spotify', sub: 'Find songs', icon: 'music' },
  library: { view: libraryView, label: 'My music', sub: 'Files', icon: 'list' },
};

// ---------- shell ----------

const navButtons = {};
const nav = h(
  'nav',
  { class: 'tabs', 'aria-label': 'Main' },
  Object.entries(SCREENS).map(([key, s]) => {
    const b = h(
      'button',
      { class: `tab tab-${key}`, dataset: { tab: key } },
      h('span', { class: 'tab-ic' }, icon(s.icon), h('span', { class: 'tab-dot', 'aria-hidden': 'true' })),
      h('span', { class: 'tab-l' }, s.label),
      h('span', { class: 'tab-s' }, s.sub),
    );
    b.addEventListener('click', () => showTab(key));
    navButtons[key] = b;
    return b;
  }),
);

const recPillTime = h('span', { class: 'rec-pill-t' }, 'REC');
const recPill = h('button', { class: 'rec-pill', hidden: true, 'aria-label': 'Recording. Open Decks.' }, h('span', { class: 'rec-pill-dot' }), recPillTime);
recPill.addEventListener('click', () => showTab('decks'));
const settingsBtn = h('button', { class: 'icon-btn top-settings', 'aria-label': 'Settings and help' }, icon('settings'));
settingsBtn.addEventListener('click', openSettings);

const header = h(
  'header',
  { class: 'topbar' },
  h('div', { class: 'brand' }, monogram(24), wordmark()),
  nav,
  h('div', { class: 'top-right' }, recPill, settingsBtn),
);

const main = h('main', { class: 'screens' });
for (const [key, s] of Object.entries(SCREENS)) {
  const section = h('section', { class: `screen screen-${key}`, hidden: true, 'aria-label': s.label }, s.view.el);
  s.section = section;
  main.append(section);
}

const root = document.getElementById('app');
root.replaceChildren(header, main);
document.documentElement.classList.toggle('ios', IOS);

let currentTab = null;
function showTab(key) {
  if (!SCREENS[key]) key = 'decks';
  if (currentTab === key) return;
  if (currentTab) SCREENS[currentTab].view.onHide?.();
  currentTab = key;
  for (const [k, s] of Object.entries(SCREENS)) {
    s.section.hidden = k !== key;
    navButtons[k].setAttribute('aria-current', k === key ? 'page' : 'false');
  }
  document.body.dataset.tab = key;
  ls.set(TAB_KEY, key);
  SCREENS[key].view.onShow?.();
  window.scrollTo(0, 0);
}

// ---------- live status (REC pill, playing dots, wake lock) ----------

function statusTick() {
  recPill.hidden = !engine.isRecording;
  if (engine.isRecording) recPillTime.textContent = `REC ${formatTime(engine.recordingElapsed())}`;
  navButtons.spotify.classList.toggle('is-active-audio', spotify.isPlaying && !spot.anyPlaying);
  navButtons.decks.classList.toggle('is-active-audio', engine.anyPlaying || spot.anyPlaying);
}
setInterval(statusTick, 500);
const syncWake = () => keepScreenAwake(engine.anyPlaying || engine.isRecording || spot.anyPlaying || document.documentElement.classList.contains('stage'));
engine.on(() => {
  syncWake();
  statusTick();
});
spotify.store.subscribe(() => {
  statusTick();
  syncWake();
});

// ---------- stage: full-screen performance mode ----------

function toggleStage(force) {
  const root = document.documentElement;
  const on = typeof force === 'boolean' ? force : !root.classList.contains('stage');
  root.classList.toggle('stage', on);
  if (on) {
    showTab('decks');
    // Real full screen where the browser allows it (desktop, Android, iPad). iPhone
    // Safari has no element full screen, so stage mode hides everything but the decks.
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) {
      try {
        const p = req.call(root);
        if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape').catch(() => {}), () => {});
      } catch {
        /* not allowed */
      }
    }
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  syncWake();
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  return on;
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.documentElement.classList.contains('stage')) {
    document.documentElement.classList.remove('stage');
    decksView.syncStageButton(false);
    syncWake();
  }
});

// iOS only lets audio start inside a real user gesture, and for touch that is
// the finger lifting (pointerup / touchend / click), not touching down. Deck
// buttons act on press for timing, so the audio unlock is repeated on release.
function resumeAudioOnGesture() {
  const c = engine.context;
  if (!c) return;
  if (engine.anyPlaying || engine.isRecording) engine.unlock();
  else if (c.state !== 'running' && currentTab === 'decks') c.resume().catch(() => {});
}
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  document.addEventListener(type, resumeAudioOnGesture, { capture: true, passive: true });
}

window.addEventListener('beforeunload', (e) => {
  if (engine.isRecording) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- welcome ----------

function showWelcome() {
  const go = (tab, mode) => {
    ls.set(WELCOME_KEY, '1');
    overlay.style.pointerEvents = 'none'; // a fading overlay must not catch the next tap
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
    if (mode) queues.setMode(mode);
    showTab(tab);
  };
  const card = (tab, mode, kicker, title, desc, cls) => {
    const b = h('button', { class: `welcome-card ${cls}` }, h('span', { class: 'wc-k' }, kicker), h('span', { class: 'wc-t' }, title), h('span', { class: 'wc-d' }, desc), icon('chevron', 'wc-chev'));
    b.addEventListener('click', () => go(tab, mode));
    return b;
  };
  const overlay = h(
    'div',
    { class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to DJKELAD' },
    h(
      'div',
      { class: 'welcome-inner' },
      h('div', { class: 'welcome-brand' }, monogram(52), wordmark()),
      h('p', { class: 'welcome-tag' }, 'Two decks. Two queues. You pick what plays next.'),
      card('decks', 'local', 'MY FILES · REAL MIXING', 'Mix your own tracks', 'Import audio files into Queue A and Queue B. Both decks play together: crossfader, AUTO MIX, AUTO DJ, then record and download your mix.', 'wc-decks'),
      card('spotify', 'spotify', 'SPOTIFY · ONE DECK AT A TIME', 'DJ from your Spotify', 'Search or open your playlists and send songs to Deck A or B. One deck plays in Spotify, the other is ready as NEXT, and the next song starts by itself.', 'wc-spotify'),
      h('p', { class: 'welcome-fine' }, 'Spotify doesn’t allow apps like DJKELAD to overlap, mix or record its songs, so blends are for your own files. Licensed Spotify mixing exists only inside partner DJ apps such as djay and rekordbox.'),
    ),
  );
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

// ---------- settings ----------

function openSettings() {
  const st = spotify.store.get();
  const cid = getClientId();
  const fromConfig = !ls.get(CLIENT_ID_KEY) && Boolean(cid);
  const uri = redirectUri();

  const statusText = {
    unconfigured: 'Not set up (no Spotify app ID yet)',
    disconnected: 'Not connected',
    connecting: 'Connecting…',
    ready: `Connected${st.profile ? ` as ${st.profile.name}` : ''}`,
    error: `Error: ${st.error || 'unknown'}`,
  }[st.phase];

  const spotifyRows = [
    h('div', { class: 'set-row' }, h('span', { class: 'set-k' }, 'Status'), h('span', { class: 'set-v' }, statusText)),
    h('div', { class: 'set-row' }, h('span', { class: 'set-k' }, 'App Client ID'), h('span', { class: 'set-v mono' }, cid ? `${cid.slice(0, 4)}…${cid.slice(-4)}${fromConfig ? ' (built in)' : ''}` : 'not set')),
    h('div', { class: 'set-row set-row-col' }, h('span', { class: 'set-k' }, 'Redirect URI to register'), h('code', { class: 'code' }, uri)),
  ];
  const spActions = h('div', { class: 'row-gap wrap' });
  if (st.phase === 'ready') {
    const disc = h('button', { class: 'btn btn-quiet' }, 'Disconnect Spotify');
    disc.addEventListener('click', () => {
      spotify.disconnect();
      sheet.close();
      toast('Spotify disconnected on this device.', 'info');
    });
    spActions.append(disc);
  }
  if (cid) {
    const link = h('button', { class: 'btn btn-quiet' }, 'Copy setup link for another device');
    link.addEventListener('click', () => {
      const url = `${uri}#spotify-client-id=${cid}`;
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => toast('Setup link copied. Open it on your iPhone.', 'ok'), () => toast(url, 'info'));
      else toast(url, 'info');
    });
    spActions.append(link);
  }
  const change = h('button', { class: 'btn btn-quiet' }, cid ? 'Change Client ID' : 'Enter Client ID');
  const changeBox = h('div', { class: 'field-row', hidden: true });
  const input = h('input', { class: 'text-input', placeholder: '32-character Client ID', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Spotify Client ID' });
  const save = h('button', { class: 'btn btn-primary' }, 'Save');
  changeBox.append(input, save);
  change.addEventListener('click', () => {
    changeBox.hidden = false;
    input.focus();
  });
  save.addEventListener('click', () => {
    const v = input.value.trim();
    if (!isValidClientId(v)) {
      toast('That is not a valid Client ID (32 letters and numbers).', 'warn');
      return;
    }
    ls.set(CLIENT_ID_KEY, v);
    spotify.reconfigure();
    sheet.close();
    toast('Client ID saved. Connect Spotify again.', 'ok');
    showTab('spotify');
  });
  spActions.append(change);

  const mime = pickRecordingMime();
  const compressedLabel = mime === null ? 'Compressed (not supported in this browser)' : `Compressed · ${/mp4/.test(mime || '') ? 'AAC .m4a' : /webm/.test(mime || '') ? 'Opus .webm' : 'browser default'}`;
  const fmt = settings.recFormat();
  const radio = (value, label, desc) => {
    const inp = h('input', { type: 'radio', name: 'recfmt', value, checked: fmt === value, disabled: value === 'auto' && mime === null });
    inp.addEventListener('change', () => {
      ls.set(REC_FORMAT_KEY, value === 'wav' ? 'wav' : null);
      toast(`Recording format: ${value === 'wav' ? 'WAV' : 'compressed'}.`, 'ok');
    });
    return h('label', { class: 'radio' }, inp, h('span', {}, h('b', {}, label), h('span', { class: 'fine' }, desc)));
  };

  const body = h(
    'div',
    { class: 'settings' },
    h('section', { class: 'set-group' }, h('h3', {}, 'Spotify'), spotifyRows, spActions, changeBox),
    h(
      'section',
      { class: 'set-group' },
      h('h3', {}, 'Recording'),
      radio('auto', compressedLabel, 'Small files, good for long mixes (about 2 MB per minute).'),
      radio('wav', 'WAV · lossless', 'Studio quality, about 10 MB per minute. Best for mixes under 20 minutes on iPhone.'),
      h('p', { class: 'fine' }, 'Only the decks’ master output is recorded. Keep DJKELAD open with the screen on while recording.'),
    ),
    h(
      'section',
      { class: 'set-group' },
      h('h3', {}, 'How DJKELAD works'),
      h(
        'ul',
        { class: 'plain-list' },
        h('li', {}, h('b', {}, 'Queues: '), 'every song goes to Queue A or Queue B. Each deck plays its NOW song; when it ends, the deck loads its NEXT. Reorder, move or remove songs in the queue sheet (tap NEXT on a deck).'),
        h('li', {}, h('b', {}, 'My files decks: '), 'your own audio files, really mixed in the browser: crossfader, AUTO MIX, AUTO DJ (mixes through both queues by itself), CUE, tempo, EQ, recording. Nothing is uploaded.'),
        h('li', {}, h('b', {}, 'Spotify decks: '), 'Spotify Premium plays one deck at a time (in this browser on a computer, in the Spotify app on iPhone). AUTO NEXT lines up the other deck’s song so Spotify moves on by itself. Never mixed, overlapped or recorded.'),
        h('li', {}, h('b', {}, 'Stage mode: '), 'the ⤢ button on the Decks screen hides everything but the decks. Turn the phone sideways for both decks side by side.'),
      ),
    ),
    h(
      'section',
      { class: 'set-group' },
      h('h3', {}, 'Mixing Spotify songs'),
      h(
        'p',
        { class: 'fine' },
        'Spotify’s Developer Policy forbids apps from mixing, overlapping or recording Spotify songs (section III.7). Real Spotify mixing is licensed only to DJ-software partners (rekordbox, Serato, djay, VirtualDJ, Cross DJ, edjing) under separate agreements, for personal use. To mix your Spotify songs today: save your queues as a Spotify playlist (queue sheet) and open it in djay or rekordbox on your iPhone.',
      ),
    ),
    h(
      'section',
      { class: 'set-group' },
      h('h3', {}, 'About'),
      h('p', { class: 'fine' }, `DJKELAD Web · build ${window.DJKELAD_BUILD || 'dev'} · by Dekel & Elad`),
      h('p', { class: 'fine' }, h('a', { href: './showroom/', target: '_blank', rel: 'noopener' }, 'Design showroom'), ' — the visual direction for the iPhone app (concept screens, not this web app).'),
    ),
  );
  const sheet = openSheet({ title: 'Settings & help', body, className: 'sheet-settings' });
}

// ---------- start ----------

const params = new URLSearchParams(location.search);
const isAuthRedirect = params.has('code') || params.has('error');
if (isAuthRedirect) history.replaceState(null, '', location.pathname);

const initialTab = isAuthRedirect || importedClientId ? 'spotify' : ls.get(TAB_KEY) || 'decks';
showTab(initialTab);
// Arriving through a setup link or the Spotify sign-in already chose a path.
if (isAuthRedirect || importedClientId) ls.set(WELCOME_KEY, '1');
else if (!ls.get(WELCOME_KEY)) showWelcome();
if (importedClientId) toast('Spotify app ID saved on this device. Tap Connect Spotify.', 'ok');

// Decks restore their NOW songs after a reload. Decoding needs the audio engine,
// which browsers only allow after the first tap, so it waits for that.
const libraryReady = library.refresh().catch(() => {});
let restoreArmed = true;
function restoreDecks() {
  if (!restoreArmed) return;
  restoreArmed = false;
  for (const type of ['pointerdown', 'keydown']) document.removeEventListener(type, restoreDecks, true);
  libraryReady.then(() => local.restore());
}
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, restoreDecks, true);

spotify
  .init(isAuthRedirect ? params : null)
  .then((r) => {
    if (r.handled && r.ok) toast('Spotify connected.', 'ok');
    else if (r.handled && r.error) toast(r.error.message, 'error');
  })
  .catch((e) => toast(e.message || 'Spotify could not start.', 'error'));

// Exposed for diagnostics in the console only.
window.DJKELAD = { engine, spotify, library, queues, local, spot, actions };
