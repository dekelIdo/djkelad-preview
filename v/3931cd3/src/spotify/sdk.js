// Spotify Web Playback SDK loader and wrapper.
// https://developer.spotify.com/documentation/web-playback-sdk

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
let sdkPromise = null;

export function loadSpotifySdk(timeoutMs = 15000) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.Spotify?.Player) {
      resolve(window.Spotify);
      return;
    }
    const timer = setTimeout(() => reject(new Error('The Spotify player script did not load.')), timeoutMs);
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timer);
      resolve(window.Spotify);
    };
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('The Spotify player script could not be loaded.'));
    };
    document.head.appendChild(s);
  }).catch((e) => {
    sdkPromise = null;
    throw e;
  });
  return sdkPromise;
}

/**
 * Creates and connects a Web Playback SDK player. Events are forwarded to `handlers`.
 * @param {{ name: string, getToken: () => Promise<string>, volume?: number, handlers: Record<string, Function> }} opts
 */
export async function createWebPlayer({ name, getToken, volume = 0.8, handlers }) {
  const Spotify = await loadSpotifySdk();
  const player = new Spotify.Player({
    name,
    volume,
    getOAuthToken: (cb) => {
      getToken().then(cb, () => {});
    },
  });
  const events = ['ready', 'not_ready', 'player_state_changed', 'initialization_error', 'authentication_error', 'account_error', 'playback_error', 'autoplay_failed'];
  for (const ev of events) {
    if (handlers[ev]) player.addListener(ev, (payload) => handlers[ev](payload));
  }
  const connected = await player.connect();
  if (!connected) throw new Error('The Spotify player could not connect.');
  return {
    player,
    /** Must run synchronously inside a user gesture (Safari / mobile autoplay rules). */
    activate() {
      try {
        const p = player.activateElement?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* older SDK */
      }
    },
    getState: () => player.getCurrentState(),
    togglePlay: () => player.togglePlay(),
    resume: () => player.resume(),
    pause: () => player.pause(),
    next: () => player.nextTrack(),
    previous: () => player.previousTrack(),
    seek: (ms) => player.seek(Math.max(0, Math.round(ms))),
    setVolume: (v) => player.setVolume(Math.max(0, Math.min(1, v))),
    disconnect: () => player.disconnect(),
  };
}
