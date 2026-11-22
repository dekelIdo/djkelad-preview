// SPOTIFY screen: connect, choose the playback device, and find songs for the
// decks (search, playlists, Liked Songs, recently played). Spotify audio plays in
// Spotify, one deck at a time, and never reaches the local mixer.
import { deviceIcon, h, icon, openSheet } from '../ui/dom.js';
import { liveProgress } from './mappers.js';
import { isValidClientId } from './pkce.js';
import { art, createSpotifyBrowser } from './browser.js';

function copyText(text, notify) {
  const done = () => notify('Copied.', 'ok');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() {
    const ta = h('textarea', { class: 'visually-hidden-input' }, text);
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      notify('Copy failed. Select the text and copy it manually.', 'warn');
    }
    ta.remove();
  }
}

/**
 * @param {{ controller: any, notify: Function, isIOS: boolean, redirectUri: () => string, getClientId: () => string, setClientId: (id: string) => void,
 *   browserDeps: object, liveDeck: () => string | null, goToDecks: () => void }} deps
 */
export function createSpotifyView(deps) {
  const { controller, notify, isIOS, redirectUri, getClientId, setClientId, browserDeps, liveDeck, goToDecks } = deps;
  const store = controller.store;
  const el = h('div', { class: 'sp-screen' });
  let phaseRendered = null;
  let ready = null; // UI refs for the ready state
  let raf = 0;
  let visible = false;

  // ---------- setup (no client ID) ----------

  function renderSetup() {
    const input = h('input', { class: 'text-input', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '32-character Client ID', 'aria-label': 'Spotify Client ID' });
    const save = h('button', { class: 'btn btn-primary' }, 'Save');
    const err = h('p', { class: 'field-error', hidden: true });
    const submit = () => {
      const v = input.value.trim();
      if (!isValidClientId(v)) {
        err.textContent = 'That does not look like a Client ID (32 letters and numbers, from your app’s Settings page).';
        err.hidden = false;
        return;
      }
      setClientId(v);
      notify('Spotify app saved. Now connect your account.', 'ok');
    };
    save.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const uri = redirectUri();
    const copy = h('button', { class: 'btn btn-quiet btn-sm' }, 'Copy');
    copy.addEventListener('click', () => copyText(uri, notify));
    return h(
      'div',
      { class: 'sp-gate' },
      h('div', { class: 'gate-kicker' }, 'SPOTIFY · ONE-TIME SETUP'),
      h('h1', { class: 'gate-title' }, 'Connect DJKELAD to Spotify'),
      h('p', { class: 'gate-sub' }, 'Spotify only lets registered apps control playback. The app owner does this once (about 3 minutes), then everyone on the account list just taps Connect.'),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, 'Open the ', h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'Spotify Developer Dashboard'), ', sign in with your Spotify Premium account and press ', h('b', {}, 'Create app'), '.'),
        h('li', {}, 'Name it DJKELAD. Under ', h('b', {}, 'Redirect URIs'), ' add exactly:', h('div', { class: 'code-row' }, h('code', { class: 'code' }, uri), copy)),
        h('li', {}, 'Under “Which API/SDKs are you planning to use?” tick ', h('b', {}, 'Web API'), ' and ', h('b', {}, 'Web Playback SDK'), ', accept the terms and save.'),
        h('li', {}, 'Open the app’s ', h('b', {}, 'Settings'), ', copy the ', h('b', {}, 'Client ID'), ' and paste it here:', h('div', { class: 'field-row' }, input, save), err),
        h('li', {}, 'Optional: add up to 5 listener accounts (for example Elad’s) under ', h('b', {}, 'User Management'), '. Your own account works straight away.'),
      ),
      h('p', { class: 'fine' }, 'The Client ID is public, not a password. It is saved in this browser; Settings can copy a setup link for your other devices.'),
    );
  }

  // ---------- connect ----------

  function renderConnect() {
    const btn = h('button', { class: 'btn btn-primary btn-xl' }, 'Connect Spotify');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Opening Spotify…';
      try {
        await controller.connect();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Connect Spotify';
        notify(e.message, 'error');
      }
    });
    const err = store.get().error;
    return h(
      'div',
      { class: 'sp-gate' },
      h('div', { class: 'gate-kicker' }, 'SPOTIFY DECKS'),
      h('h1', { class: 'gate-title' }, 'DJ from your Spotify'),
      h('p', { class: 'gate-sub' }, 'Connect your Spotify Premium account, then search or open your playlists and send songs to Queue A and Queue B. The decks take turns: one plays, the other is ready as NEXT.'),
      err ? h('p', { class: 'gate-error', role: 'alert' }, err) : null,
      btn,
      h(
        'ul',
        { class: 'gate-points' },
        h('li', {}, isIOS ? 'On iPhone the music plays through the Spotify app; DJKELAD is the remote.' : 'On a computer the music can play right here in the browser, or on any Spotify device.'),
        h('li', {}, 'Spotify doesn’t allow apps like DJKELAD to overlap, mix or record its songs, so Spotify decks switch cleanly from song to song. Real blends work with your own files.'),
        h('li', {}, 'Requires Spotify Premium for playback control.'),
      ),
    );
  }

  function renderBusy(text) {
    return h('div', { class: 'sp-gate sp-busy' }, h('span', { class: 'spinner' }), h('p', {}, text));
  }

  function renderError() {
    const retry = h('button', { class: 'btn btn-primary' }, 'Try again');
    retry.addEventListener('click', () => controller.init(null));
    const disc = h('button', { class: 'btn btn-quiet' }, 'Disconnect');
    disc.addEventListener('click', () => controller.disconnect());
    return h('div', { class: 'sp-gate' }, h('div', { class: 'gate-kicker' }, 'SPOTIFY'), h('h1', { class: 'gate-title' }, 'Spotify is not responding'), h('p', { class: 'gate-error', role: 'alert' }, store.get().error || 'Unknown error.'), h('div', { class: 'row-gap' }, retry, disc));
  }

  // ---------- device sheet ----------

  function openDeviceSheet({ retry = null } = {}) {
    const list = h('div', { class: 'device-list', role: 'list' });
    const refreshBtn = h('button', { class: 'btn btn-quiet' }, icon('refresh'), 'Refresh');
    let sheet = null;
    const render = () => {
      const st = store.get();
      list.replaceChildren();
      const rows = [];
      const activeId = st.playback?.device?.id;
      if (st.sdk.status === 'ready') rows.push({ id: st.sdk.deviceId, name: st.sdk.name, type: isIOS ? 'Smartphone' : 'Computer', note: isIOS ? 'Experimental on iPhone' : 'Plays in this browser' });
      for (const d of st.devices) {
        if (d.id === st.sdk.deviceId) continue;
        rows.push({ id: d.id, name: d.name, type: d.type, note: d.isRestricted ? 'Can’t be controlled remotely' : d.type, disabled: d.isRestricted });
      }
      if (!rows.length) {
        list.append(h('p', { class: 'empty-note' }, 'No Spotify devices found yet.'));
      }
      for (const r of rows) {
        const btn = h(
          'button',
          { class: `device-row ${r.id === activeId ? 'is-active' : ''}`, role: 'listitem', disabled: r.disabled },
          deviceIcon(r.type),
          h('span', { class: 'device-meta' }, h('span', { class: 'device-name' }, r.name), h('span', { class: 'device-note' }, r.id === activeId ? 'Playing here now' : r.note)),
          r.id === activeId ? icon('check', 'device-check') : null,
        );
        btn.addEventListener('click', () => {
          controller.chooseDevice(r.id, retry);
          sheet?.close();
        });
        list.append(btn);
      }
    };
    const unsub = store.subscribe(render);
    refreshBtn.addEventListener('click', () => controller.refreshDevices().catch((e) => notify(controller.describeError(e), 'error')));

    const help = [];
    if (isIOS) {
      const open = h('a', { class: 'btn btn-primary', href: 'spotify:' }, 'Open Spotify');
      const trySafari = h('button', { class: 'btn btn-quiet btn-sm' }, 'Try playing inside Safari (experimental)');
      trySafari.addEventListener('click', () => {
        controller.enableBrowserPlayer();
        notify('Starting the Spotify player in Safari… it appears in this list when ready.', 'info');
      });
      help.push(
        h(
          'div',
          { class: 'device-help' },
          h('div', { class: 'help-t' }, 'Play on this iPhone'),
          h('ol', { class: 'steps steps-compact' }, h('li', {}, 'Tap Open Spotify.'), h('li', {}, 'Start any song for a second (so iOS keeps Spotify awake).'), h('li', {}, 'Come back to DJKELAD — your iPhone appears above. Tap it.')),
          h('div', { class: 'row-gap' }, open, refreshBtn),
          store.get().sdk.status === 'ready' ? null : trySafari,
          store.get().sdk.message ? h('p', { class: 'fine' }, store.get().sdk.message) : null,
        ),
      );
    } else {
      const sdk = store.get().sdk;
      help.push(
        h(
          'div',
          { class: 'device-help' },
          sdk.status === 'unsupported' || sdk.status === 'error' ? h('p', { class: 'fine warn-text' }, `Browser player unavailable: ${sdk.message}`) : null,
          h('p', { class: 'fine' }, 'Any phone, computer or speaker with Spotify open on your account shows up here.'),
          h('div', { class: 'row-gap' }, refreshBtn),
        ),
      );
    }
    sheet = openSheet({
      title: retry ? 'Where should Spotify play?' : 'Spotify devices',
      className: 'sheet-devices',
      onClose: unsub,
      body: h('div', {}, list, help),
    });
    render();
    controller.refreshDevices().catch(() => {});
  }

  controller.on((e) => {
    if (e.type === 'need-device') openDeviceSheet({ retry: e.retry });
    if (e.type === 'sdk-stalled') notify('No sound from the browser player?', 'warn', { label: 'Choose device', run: () => openDeviceSheet() });
  });

  // ---------- ready: find songs, send them to the decks ----------

  function buildReady() {
    const deviceName = h('span', { class: 'chip-text' }, 'Choose device');
    const deviceBtn = h('button', { class: 'device-chip' }, icon('device', 'chip-ic'), deviceName, icon('chevron', 'chip-chev'));
    deviceBtn.addEventListener('click', () => openDeviceSheet());
    const profile = h('span', { class: 'sp-profile' });
    const premium = h('div', { class: 'banner banner-warn', hidden: true }, 'Spotify says this account can’t control playback. Playback control needs Spotify Premium; browsing still works.');

    const intro = h(
      'div',
      { class: 'sp-intro' },
      h('h1', { class: 'screen-title' }, 'Find songs'),
      h('p', { class: 'screen-sub' }, 'Tap a song for PLAY ON or ADD TO a deck, or use ', h('b', { class: 'txt-a' }, '+A'), ' / ', h('b', { class: 'txt-b' }, '+B'), ' to queue it in one tap.'),
    );
    const top = h('div', { class: 'sp-top' }, deviceBtn, profile);
    const browser = createSpotifyBrowser({ controller, ...browserDeps });
    const foot = h('p', { class: 'sp-foot' }, 'Playback by Spotify. Spotify songs play one deck at a time in Spotify; they are never mixed, overlapped or recorded by DJKELAD.');

    // Mini bar: the live deck, always reachable while browsing.
    const miniDeck = h('span', { class: 'mini-deck' });
    const miniArt = h('span', { class: 'mini-art' });
    const miniT = h('span', { class: 'mini-t' });
    const miniA = h('span', { class: 'mini-a' });
    const miniPlay = h('button', { class: 'mini-play', 'aria-label': 'Play' }, icon('play', 'ic-play'), icon('pause', 'ic-pause'));
    const miniOpen = h('button', { class: 'mini-open', 'aria-label': 'Open the decks' }, miniDeck, miniArt, h('span', { class: 'mini-meta' }, miniT, miniA));
    const miniGo = h('button', { class: 'mini-btn mini-go', 'aria-label': 'Open the decks' }, icon('decks'));
    const miniProg = h('span', { class: 'mini-prog' });
    const mini = h('div', { class: 'sp-mini', hidden: true }, miniProg, miniOpen, miniPlay, miniGo);
    miniPlay.addEventListener('click', () => controller.togglePlay());
    miniOpen.addEventListener('click', goToDecks);
    miniGo.addEventListener('click', goToDecks);

    const root = h('div', { class: 'sp-ready' }, top, premium, intro, browser.el, foot, mini);

    let lastUri = '';
    function update() {
      const st = store.get();
      const pb = st.playback;
      profile.textContent = st.profile ? st.profile.name : '';
      premium.hidden = !st.premiumIssue;
      const dev = pb?.device;
      deviceName.textContent = dev ? `On ${dev.name}` : 'Choose where to play';
      deviceBtn.classList.toggle('is-set', Boolean(dev));
      deviceBtn.replaceChild(dev ? deviceIcon(dev.type) : icon('device'), deviceBtn.firstChild);
      deviceBtn.firstChild.classList.add('chip-ic');
      const t = pb?.track;
      if ((t?.uri || '') !== lastUri) {
        lastUri = t?.uri || '';
        browser.markCurrent(t?.uri);
      }
      const live = liveDeck();
      mini.hidden = !t;
      mini.classList.toggle('mini-deck-a', live === 'A');
      mini.classList.toggle('mini-deck-b', live === 'B');
      miniDeck.textContent = live || '';
      miniDeck.hidden = !live;
      miniT.textContent = t ? t.name : '';
      miniA.textContent = t ? (live ? `Deck ${live} · ${t.artists}` : `Not on a deck · ${t.artists}`) : '';
      if (miniArt.dataset.src !== (t?.image || '')) {
        miniArt.dataset.src = t?.image || '';
        miniArt.replaceChildren(art(t?.image, 'mini-img'));
      }
      miniPlay.classList.toggle('is-playing', Boolean(pb?.isPlaying));
      miniPlay.setAttribute('aria-label', pb?.isPlaying ? 'Pause' : 'Play');
    }

    function frame() {
      const pb = store.get().playback;
      const dur = pb?.durationMs || 0;
      const f = dur ? liveProgress(pb) / dur : 0;
      miniProg.style.transform = `scaleX(${f})`;
      raf = requestAnimationFrame(frame);
    }

    return { root, update, frame, browser };
  }

  function render() {
    const st = store.get();
    const key = `${st.phase}|${st.phase === 'ready' ? '' : st.error || ''}`;
    if (key !== phaseRendered) {
      phaseRendered = key;
      cancelAnimationFrame(raf);
      ready = null;
      let node;
      if (st.phase === 'unconfigured') node = renderSetup();
      else if (st.phase === 'disconnected') node = renderConnect();
      else if (st.phase === 'connecting') node = renderBusy('Connecting to Spotify…');
      else if (st.phase === 'error') node = renderError();
      else {
        ready = buildReady();
        node = ready.root;
      }
      el.replaceChildren(node);
      if (ready && visible) raf = requestAnimationFrame(ready.frame);
    }
    if (ready) ready.update();
  }

  store.subscribe(render);
  render();

  return {
    el,
    openDeviceSheet,
    rerender() {
      phaseRendered = null;
      render();
    },
    /** Redraw the song list (deck badges) after the queues changed. */
    refreshList() {
      ready?.browser.rerender();
    },
    onShow() {
      visible = true;
      if (ready) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(ready.frame);
      }
    },
    onHide() {
      visible = false;
      cancelAnimationFrame(raf);
    },
    get clientId() {
      return getClientId();
    },
  };
}
