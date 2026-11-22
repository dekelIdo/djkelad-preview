// Spotify Control: session, devices, NOW / NEXT, queue and playback commands.
// Playback happens in Spotify (the Web Playback SDK in this browser, or the
// Spotify app on a device via Spotify Connect). DJKELAD never touches the audio.
import { createSpotifyApi, describeSpotifyError, SpotifyApiError } from './api.js';
import { createSpotifyAuth } from './auth.js';
import { createWebPlayer } from './sdk.js';
import {
  dedupeTracks,
  liveProgress,
  mapDevice,
  mapLikedEntry,
  mapPlaybackState,
  mapPlaylist,
  mapPlaylistEntry,
  mapProfile,
  mapQueue,
  mapSdkState,
  mapTrack,
} from './mappers.js';
import { createStore } from '../util.js';

const PREFERRED_DEVICE_KEY = 'djkelad.spotify.device';

function readPref() {
  try {
    return localStorage.getItem(PREFERRED_DEVICE_KEY);
  } catch {
    return null;
  }
}

function writePref(id) {
  try {
    if (id) localStorage.setItem(PREFERRED_DEVICE_KEY, id);
    else localStorage.removeItem(PREFERRED_DEVICE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {{
 *   getClientId: () => string,
 *   redirectUri: () => string,
 *   isIOS: boolean,
 *   beforePlay: () => boolean,
 *   notify: (msg: string, kind?: string, action?: { label: string, run: () => void }) => void,
 * }} opts
 */
export function createSpotifyController(opts) {
  const { getClientId, redirectUri, isIOS, beforePlay, notify } = opts;
  const store = createStore({
    phase: getClientId() ? 'disconnected' : 'unconfigured',
    error: null,
    profile: null,
    playback: null,
    queue: [],
    devices: [],
    sdk: { status: 'off', deviceId: null, message: '', name: isIOS ? 'DJKELAD · this iPhone (Safari)' : 'DJKELAD Web player' },
    preferredDeviceId: readPref(),
    premiumIssue: false,
  });
  const listeners = new Set();
  const emitEvent = (e) => {
    for (const fn of listeners) fn(e);
  };

  const auth = createSpotifyAuth({
    storage: localStorage,
    clientId: getClientId,
    redirectUri,
    onChange: (connected) => {
      if (!connected && store.get().phase === 'ready') {
        stopPolling();
        store.set({ phase: 'disconnected', playback: null, queue: [], devices: [] });
      }
    },
  });
  const api = createSpotifyApi({ auth });

  let sdk = null;
  let pollTimer = null;
  let lastSdkStateAt = 0;
  let queueFetchedAt = 0;
  let lastRequest = null;

  // ---------- session ----------

  async function start() {
    store.set({ phase: 'connecting', error: null });
    try {
      const me = await api.me();
      store.set({ phase: 'ready', profile: mapProfile(me) });
    } catch (e) {
      if (e?.name === 'SpotifyAuthError') store.set({ phase: 'disconnected', error: e.message });
      else store.set({ phase: 'error', error: describeSpotifyError(e) });
      return;
    }
    schedulePoll(0);
    refreshDevices().catch(() => {});
    // Desktop browsers get an in-page player right away. On iPhone it is opt-in
    // (Spotify lists iOS as supported, but playback there is unreliable).
    if (!isIOS) initSdk();
  }

  function guardAuth(e) {
    if (e?.name === 'SpotifyAuthError') {
      stopPolling();
      store.set({ phase: 'disconnected', error: e.message, playback: null });
      return true;
    }
    return false;
  }

  // ---------- state sync ----------

  function setPlayback(pb) {
    const prev = store.get().playback;
    store.set({ playback: pb });
    if (!pb) {
      if (store.get().queue.length) store.set({ queue: [] });
      return;
    }
    if (pb.track?.uri !== prev?.track?.uri || Date.now() - queueFetchedAt > 20000) refreshQueue();
  }

  function schedulePoll(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function poll() {
    if (store.get().phase !== 'ready') return;
    if (document.hidden) return; // resumes on visibilitychange
    try {
      const raw = await api.playbackState();
      const pb = mapPlaybackState(raw);
      const sdkId = store.get().sdk.deviceId;
      const sdkFresh = sdkId && pb?.device?.id === sdkId && Date.now() - lastSdkStateAt < 4000;
      if (!sdkFresh) {
        if (pb && sdkId && pb.device.id === sdkId) pb.device.name = store.get().sdk.name;
        setPlayback(pb);
      }
    } catch (e) {
      if (guardAuth(e)) return;
    }
    const pb = store.get().playback;
    const sdkActive = pb && pb.device?.id && pb.device.id === store.get().sdk.deviceId;
    schedulePoll(sdkActive ? 8000 : pb?.isPlaying ? 2500 : 5000);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && store.get().phase === 'ready') schedulePoll(50);
  });

  async function refreshQueue() {
    if (!store.get().playback) return;
    queueFetchedAt = Date.now();
    try {
      const q = mapQueue(await api.queue());
      store.set({ queue: q.queue });
    } catch (e) {
      guardAuth(e);
    }
  }

  async function refreshDevices() {
    try {
      const r = await api.devices();
      const devices = (r?.devices || []).map(mapDevice).filter((d) => d && d.id);
      store.set({ devices });
      return devices;
    } catch (e) {
      guardAuth(e);
      throw e;
    }
  }

  // ---------- Web Playback SDK ----------

  function setSdk(patch) {
    store.set({ sdk: { ...store.get().sdk, ...patch } });
  }

  async function initSdk() {
    if (sdk || store.get().sdk.status === 'loading') return;
    setSdk({ status: 'loading', message: '' });
    try {
      sdk = await createWebPlayer({
        name: store.get().sdk.name,
        getToken: () => auth.getAccessToken(),
        volume: 0.8,
        handlers: {
          ready: ({ device_id }) => {
            setSdk({ status: 'ready', deviceId: device_id, message: '' });
            refreshDevices().catch(() => {});
          },
          not_ready: () => setSdk({ status: 'offline', message: 'The browser player went offline. It reconnects automatically.' }),
          initialization_error: ({ message }) => {
            setSdk({ status: 'unsupported', message: message || 'This browser cannot play Spotify directly.' });
            sdk = null;
          },
          authentication_error: () => setSdk({ status: 'error', message: 'Spotify rejected the browser player sign-in. Disconnect and connect Spotify again.' }),
          account_error: () => {
            setSdk({ status: 'error', message: 'Playing inside the browser needs Spotify Premium.' });
            store.set({ premiumIssue: true });
          },
          playback_error: ({ message }) => notify(`Spotify could not play that: ${message || 'unknown error'}.`, 'error'),
          autoplay_failed: () => notify('The browser blocked audio. Tap play once more.', 'warn'),
          player_state_changed: (state) => {
            lastSdkStateAt = Date.now();
            const pb = mapSdkState(state, store.get().sdk.deviceId);
            if (pb) {
              pb.device.name = store.get().sdk.name;
              setPlayback(pb);
            } else if (store.get().playback?.source === 'sdk') {
              // Playback moved to another device: fetch the real state.
              setPlayback(null);
              schedulePoll(300);
            }
          },
        },
      });
    } catch (e) {
      sdk = null;
      setSdk({ status: 'unsupported', message: e.message || 'The Spotify browser player is not available here.' });
    }
  }

  function isSdkDevice(id) {
    return Boolean(id && id === store.get().sdk.deviceId);
  }

  function watchSdkStart() {
    setTimeout(async () => {
      let st = null;
      try {
        st = sdk ? await sdk.getState() : null;
      } catch {
        st = null;
      }
      const pb = store.get().playback;
      const ok = st && !st.paused && st.position > 0;
      if (!ok && pb && isSdkDevice(pb.device?.id)) emitEvent({ type: 'sdk-stalled' });
    }, 7000);
  }

  // ---------- commands ----------

  async function resolveDevice() {
    const st = store.get();
    if (st.playback?.device?.id) return st.playback.device.id;
    let devices = st.devices;
    try {
      devices = await refreshDevices();
    } catch {
      /* use the last list */
    }
    const pref = store.get().preferredDeviceId;
    if (pref && (devices.some((d) => d.id === pref) || isSdkDevice(pref))) return pref;
    const active = devices.find((d) => d.isActive);
    if (active) return active.id;
    if (!isIOS && store.get().sdk.status === 'ready') return store.get().sdk.deviceId;
    const usable = devices.filter((d) => !d.isRestricted && !isSdkDevice(d.id));
    if (usable.length === 1) return usable[0].id;
    return null;
  }

  function deviceById(id) {
    if (isSdkDevice(id)) return { id, name: store.get().sdk.name, type: 'Computer', isActive: true, supportsVolume: true, volume: null };
    return store.get().devices.find((d) => d.id === id) || { id, name: 'Spotify device', type: 'Unknown', supportsVolume: false, volume: null };
  }

  function handleCommandError(e, retry) {
    if (guardAuth(e)) {
      notify(e.message, 'error');
      return;
    }
    if (e instanceof SpotifyApiError) {
      if (e.reason === 'NO_ACTIVE_DEVICE' || (e.status === 404 && /device/i.test(e.message))) {
        store.set({ preferredDeviceId: null });
        writePref(null);
        refreshDevices().catch(() => {});
        emitEvent({ type: 'need-device', retry });
        return;
      }
      if (e.reason === 'PREMIUM_REQUIRED') store.set({ premiumIssue: true });
    }
    notify(describeSpotifyError(e), 'error');
    schedulePoll(300);
  }

  async function playOn(deviceId, request) {
    try {
      await api.play({ deviceId, uris: request.uris, contextUri: request.contextUri, offsetUri: request.offsetUri, offsetPosition: request.offsetPosition });
      store.set({ preferredDeviceId: deviceId });
      writePref(deviceId);
      if (request.track) {
        setPlayback({
          source: isSdkDevice(deviceId) ? 'sdk' : 'remote',
          isPlaying: true,
          progressMs: 0,
          updatedAt: Date.now(),
          durationMs: request.track.durationMs,
          track: request.track,
          device: deviceById(deviceId),
          contextUri: request.contextUri || null,
          disallows: {},
        });
      }
      schedulePoll(600);
      if (isSdkDevice(deviceId)) watchSdkStart();
    } catch (e) {
      handleCommandError(e, (id) => playOn(id, request));
    }
  }

  /** Returns false when playback was blocked (e.g. the decks are recording). */
  function play(request) {
    // Synchronous part: runs inside the tap (required for browser audio unlock).
    if (beforePlay() === false) return false;
    sdk?.activate();
    lastRequest = request;
    (async () => {
      const deviceId = await resolveDevice();
      if (!deviceId) {
        emitEvent({ type: 'need-device', retry: (id) => playOn(id, request) });
        return;
      }
      await playOn(deviceId, request);
    })();
    return true;
  }

  async function command(name, arg) {
    const pb = store.get().playback;
    if (!pb) return;
    const deviceId = pb.device?.id;
    const viaSdk = sdk && isSdkDevice(deviceId);
    const now = Date.now();
    if (name === 'pause') setPlayback({ ...pb, isPlaying: false, progressMs: liveProgress(pb, now), updatedAt: now });
    if (name === 'resume') setPlayback({ ...pb, isPlaying: true, progressMs: liveProgress(pb, now), updatedAt: now });
    if (name === 'seek') setPlayback({ ...pb, progressMs: arg, updatedAt: now });
    try {
      if (viaSdk) {
        if (name === 'pause') await sdk.pause();
        else if (name === 'resume') await sdk.resume();
        else if (name === 'next') await sdk.next();
        else if (name === 'previous') await sdk.previous();
        else if (name === 'seek') await sdk.seek(arg);
        else if (name === 'volume') await sdk.setVolume(arg / 100);
      } else {
        if (name === 'pause') await api.pause(deviceId);
        else if (name === 'resume') await api.play({ deviceId });
        else if (name === 'next') await api.next(deviceId);
        else if (name === 'previous') await api.previous(deviceId);
        else if (name === 'seek') await api.seek(arg, deviceId);
        else if (name === 'volume') await api.volume(arg, deviceId);
      }
      schedulePoll(name === 'next' || name === 'previous' ? 500 : 900);
    } catch (e) {
      if (e instanceof SpotifyApiError && (e.reason === 'ALREADY_PAUSED' || e.reason === 'NOT_PAUSED')) return;
      handleCommandError(e, null);
    }
  }

  const controller = {
    store,
    auth,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Handles the OAuth redirect (if any) and restores the session. */
    async init(params) {
      if (!getClientId()) {
        store.set({ phase: 'unconfigured' });
        return { handled: false };
      }
      let redirect = { handled: false };
      if (params) {
        redirect = await auth.handleRedirect(params);
        if (redirect.handled && !redirect.ok) store.set({ error: redirect.error.message });
      }
      if (!auth.isConnected()) {
        store.set({ phase: 'disconnected' });
        return redirect;
      }
      await start();
      return redirect;
    },

    async connect() {
      const url = await auth.beginLogin();
      location.assign(url);
    },

    disconnect() {
      stopPolling();
      try {
        sdk?.disconnect();
      } catch {
        /* ignore */
      }
      sdk = null;
      auth.disconnect();
      store.set({
        phase: getClientId() ? 'disconnected' : 'unconfigured',
        profile: null,
        playback: null,
        queue: [],
        devices: [],
        error: null,
        premiumIssue: false,
        sdk: { ...store.get().sdk, status: 'off', deviceId: null, message: '' },
      });
    },

    /** Re-evaluate after the client ID changed. */
    reconfigure() {
      controller.disconnect();
    },

    play,

    togglePlay() {
      const pb = store.get().playback;
      if (!pb) {
        if (lastRequest) play(lastRequest);
        else notify('Pick a track below to start playing.', 'info');
        return;
      }
      if (pb.isPlaying) {
        command('pause');
        return;
      }
      if (beforePlay() === false) return;
      sdk?.activate();
      command('resume');
    },

    next: () => command('next'),

    previous() {
      const pb = store.get().playback;
      if (pb && liveProgress(pb) > 3000) command('seek', 0);
      else command('previous');
    },

    seek: (ms) => command('seek', ms),
    setVolume: (percent) => command('volume', percent),

    async addToQueue(track) {
      const pb = store.get().playback;
      if (!pb) {
        notify('Start playing something first, then add tracks to the queue.', 'info');
        return;
      }
      try {
        await api.addToQueue(track.uri, pb.device?.id);
        notify(`Added to queue: ${track.name}`, 'ok');
        setTimeout(refreshQueue, 500);
      } catch (e) {
        handleCommandError(e, null);
      }
    },

    /**
     * Line up one song as Spotify's next track (POST /me/player/queue), quietly.
     * Spotify then moves on by itself when the current song ends, applying the
     * listener's own Crossfade setting if it is on. Throws on failure.
     */
    async lineUp(uri) {
      const pb = store.get().playback;
      await api.addToQueue(uri, pb?.device?.id);
    },

    /** True when the session may create playlists (optional scope). */
    canSavePlaylists() {
      return /(^|\s)playlist-modify-private(\s|$)/.test(auth.grantedScopes());
    },

    /**
     * Save songs as a new private playlist on the listener's account.
     * @returns {Promise<{ id: string, url: string, name: string }>}
     */
    async savePlaylist(name, uris, description = '') {
      const pl = await api.createPlaylist({ name, description, isPublic: false });
      for (let i = 0; i < uris.length; i += 100) await api.addPlaylistItems(pl.id, uris.slice(i, i + 100));
      return { id: pl.id, url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`, name: pl.name || name };
    },

    /** Pause Spotify if it is playing (used when local decks start). */
    pauseIfPlaying() {
      const pb = store.get().playback;
      if (pb?.isPlaying) {
        command('pause');
        return true;
      }
      return false;
    },

    get isPlaying() {
      return Boolean(store.get().playback?.isPlaying);
    },

    refreshDevices,
    refreshQueue,

    /** Enables the in-browser player on demand (opt-in on iPhone). */
    enableBrowserPlayer: () => initSdk(),

    /**
     * Picks a device from the device sheet. Call inside the tap.
     * With `then`, runs the pending action on it instead of transferring.
     */
    chooseDevice(deviceId, then) {
      if (isSdkDevice(deviceId)) sdk?.activate();
      store.set({ preferredDeviceId: deviceId });
      writePref(deviceId);
      if (then) {
        if (beforePlay() === false) return;
        then(deviceId);
        return;
      }
      const pb = store.get().playback;
      if (pb && pb.device?.id !== deviceId) {
        api
          .transfer(deviceId, pb.isPlaying)
          .then(() => schedulePoll(700))
          .catch((e) => handleCommandError(e, null));
      }
    },

    library: {
      async playlists(offset = 0) {
        const r = await api.myPlaylists(offset);
        const meId = store.get().profile?.id;
        return { items: (r?.items || []).map((p) => mapPlaylist(p, meId)).filter(Boolean), next: r?.next ? offset + 50 : null, total: r?.total ?? null };
      },
      async playlistItems(id, offset = 0) {
        const r = await api.playlistItems(id, offset);
        return { items: (r?.items || []).map(mapPlaylistEntry).filter(Boolean), next: r?.next ? offset + 50 : null, total: r?.total ?? null };
      },
      async liked(offset = 0) {
        const r = await api.likedTracks(offset);
        return { items: (r?.items || []).map(mapLikedEntry).filter(Boolean), next: r?.next ? offset + 50 : null, total: r?.total ?? null };
      },
      async recent() {
        const r = await api.recentlyPlayed();
        return { items: dedupeTracks((r?.items || []).map((i) => mapTrack(i.track))), next: null, total: null };
      },
      async search(q, offset = 0) {
        const r = await api.searchTracks(q, offset);
        const t = r?.tracks;
        return { items: (t?.items || []).map(mapTrack).filter(Boolean), next: t?.next ? offset + (t.limit || 10) : null, total: t?.total ?? null };
      },
    },
    describeError: describeSpotifyError,
    guardAuth,
  };
  return controller;
}
