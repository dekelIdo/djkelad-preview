// Thin Spotify Web API client: auth header, retries, error mapping.
// Endpoint paths follow the February 2026 Development Mode changes
// (playlist contents live at /playlists/{id}/items, search returns max 10).

const API = 'https://api.spotify.com/v1';
export const SEARCH_PAGE_SIZE = 10;

export class SpotifyApiError extends Error {
  constructor({ status, reason, message, path }) {
    super(message || `Spotify API error ${status}`);
    this.name = 'SpotifyApiError';
    this.status = status;
    this.reason = reason || '';
    this.path = path || '';
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ auth: { getAccessToken(): Promise<string>, refresh(): Promise<any> }, fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void> }} deps
 */
export function createSpotifyApi({ auth, fetchImpl, sleep = defaultSleep }) {
  const doFetch = fetchImpl ?? ((...a) => fetch(...a));

  async function request(method, path, { query, body, attempt = 0 } = {}) {
    const url = new URL(API + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const token = await auth.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await doFetch(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      if (attempt < 1) {
        await sleep(600);
        return request(method, path, { query, body, attempt: attempt + 1 });
      }
      throw new SpotifyApiError({ status: 0, reason: 'NETWORK', message: 'Network error talking to Spotify.', path });
    }

    if (res.status === 401 && attempt < 1) {
      await auth.refresh();
      return request(method, path, { query, body, attempt: attempt + 1 });
    }
    if (res.status === 429 && attempt < 2) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 1;
      await sleep(Math.min(retryAfter, 8) * 1000);
      return request(method, path, { query, body, attempt: attempt + 1 });
    }
    if (res.status >= 500 && attempt < 1) {
      await sleep(500);
      return request(method, path, { query, body, attempt: attempt + 1 });
    }

    const text = res.status === 204 ? '' : await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const err = json?.error;
      throw new SpotifyApiError({
        status: res.status,
        reason: (typeof err === 'object' && (err.reason || json?.reason)) || json?.reason || '',
        message: (typeof err === 'object' ? err.message : err) || text || `HTTP ${res.status}`,
        path,
      });
    }
    return json;
  }

  const withDevice = (deviceId) => (deviceId ? { device_id: deviceId } : undefined);

  return {
    request,
    me: () => request('GET', '/me'),
    myPlaylists: (offset = 0) => request('GET', '/me/playlists', { query: { limit: 50, offset } }),
    playlist: (id) => request('GET', `/playlists/${encodeURIComponent(id)}`),
    playlistItems: (id, offset = 0) =>
      request('GET', `/playlists/${encodeURIComponent(id)}/items`, { query: { limit: 50, offset, additional_types: 'track,episode' } }),
    likedTracks: (offset = 0) => request('GET', '/me/tracks', { query: { limit: 50, offset } }),
    searchTracks: (q, offset = 0) => request('GET', '/search', { query: { q, type: 'track', limit: SEARCH_PAGE_SIZE, offset } }),
    recentlyPlayed: () => request('GET', '/me/player/recently-played', { query: { limit: 50 } }),

    playbackState: () => request('GET', '/me/player', { query: { additional_types: 'track,episode' } }),
    devices: () => request('GET', '/me/player/devices'),
    queue: () => request('GET', '/me/player/queue'),

    /** Start or resume. With no uris/context it resumes the current item. */
    play: ({ deviceId, uris, contextUri, offsetUri, offsetPosition, positionMs } = {}) => {
      const body = {};
      if (contextUri) body.context_uri = contextUri;
      if (uris && uris.length) body.uris = uris;
      if (offsetUri) body.offset = { uri: offsetUri };
      else if (Number.isInteger(offsetPosition)) body.offset = { position: offsetPosition };
      if (Number.isFinite(positionMs)) body.position_ms = Math.max(0, Math.round(positionMs));
      return request('PUT', '/me/player/play', { query: withDevice(deviceId), body: Object.keys(body).length ? body : undefined });
    },
    pause: (deviceId) => request('PUT', '/me/player/pause', { query: withDevice(deviceId) }),
    next: (deviceId) => request('POST', '/me/player/next', { query: withDevice(deviceId) }),
    previous: (deviceId) => request('POST', '/me/player/previous', { query: withDevice(deviceId) }),
    seek: (positionMs, deviceId) =>
      request('PUT', '/me/player/seek', { query: { position_ms: Math.max(0, Math.round(positionMs)), ...withDevice(deviceId) } }),
    volume: (percent, deviceId) =>
      request('PUT', '/me/player/volume', { query: { volume_percent: Math.round(Math.max(0, Math.min(100, percent))), ...withDevice(deviceId) } }),
    addToQueue: (uri, deviceId) => request('POST', '/me/player/queue', { query: { uri, ...withDevice(deviceId) } }),
    // February 2026: POST /me/playlists replaces /users/{id}/playlists, /items replaces /tracks.
    createPlaylist: ({ name, description = '', isPublic = false }) => request('POST', '/me/playlists', { body: { name, description, public: isPublic } }),
    addPlaylistItems: (id, uris) => request('POST', `/playlists/${encodeURIComponent(id)}/items`, { body: { uris } }),
    transfer: (deviceId, play = false) => request('PUT', '/me/player', { body: { device_ids: [deviceId], play } }),
  };
}

/** One plain sentence a person can act on. */
export function describeSpotifyError(err) {
  if (!err) return 'Something went wrong with Spotify.';
  if (err.name === 'SpotifyAuthError') return err.message;
  if (!(err instanceof SpotifyApiError)) return err.message || 'Something went wrong with Spotify.';
  const msg = String(err.message || '');
  if (err.reason === 'PREMIUM_REQUIRED') return 'Playback control needs Spotify Premium on this account.';
  if (err.reason === 'NO_ACTIVE_DEVICE') return 'No Spotify device is active. Choose where to play.';
  if (err.reason === 'VOLUME_CONTROL_DISALLOW') return 'This Spotify device does not allow remote volume control.';
  if (err.reason === 'QUOTA_EXCEEDED') return 'The DJKELAD Spotify app hit its Spotify request quota. Try again in a minute.';
  if (/not registered|not be registered|user may not be registered/i.test(msg))
    return 'This Spotify account is not on the DJKELAD app’s user list. The app owner adds it in the Spotify Developer Dashboard (User Management).';
  if (err.status === 0) return 'No connection to Spotify. Check the network and try again.';
  if (err.status === 401) return 'Your Spotify session ended. Connect again.';
  if (err.status === 403) return `Spotify refused this action${msg ? `: ${msg}` : '.'}`;
  if (err.status === 404 && /device/i.test(msg)) return 'That Spotify device is no longer available. Choose another.';
  if (err.status === 404) return 'Spotify could not find that item.';
  if (err.status === 429) return 'Spotify is rate limiting requests. Wait a moment.';
  if (err.status >= 500) return 'Spotify is having trouble right now. Try again.';
  return msg || 'Spotify returned an error.';
}
