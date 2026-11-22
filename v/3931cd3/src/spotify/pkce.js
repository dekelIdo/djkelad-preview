// Spotify Authorization Code with PKCE: the pure parts (no storage, no network).
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

export const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

/**
 * Scopes DJKELAD asks for. `streaming`, `user-read-email` and `user-read-private`
 * are required by the Web Playback SDK; the rest cover playback control,
 * NOW / NEXT, the queue and the library lists.
 */
export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
];

/**
 * Asked for too, but not required to stay connected: saving a deck set as a
 * private Spotify playlist (so it can be opened in Spotify's Mix or a licensed DJ app).
 */
export const SPOTIFY_OPTIONAL_SCOPES = ['playlist-modify-private'];

const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Random string from the PKCE verifier alphabet (RFC 7636: 43-128 chars). */
export function randomString(length = 64, cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(length);
  cryptoImpl.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += VERIFIER_ALPHABET[b % VERIFIER_ALPHABET.length];
  return out;
}

/** base64url without padding. */
export function base64url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** S256 code challenge for a verifier. */
export async function codeChallenge(verifier, cryptoImpl = globalThis.crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

export function buildAuthorizeUrl({ clientId, redirectUri, challenge, state, scopes = [...SPOTIFY_SCOPES, ...SPOTIFY_OPTIONAL_SCOPES], showDialog = false }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: scopes.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    redirect_uri: redirectUri,
    state,
  });
  if (showDialog) params.set('show_dialog', 'true');
  return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * The redirect URI for the page DJKELAD is served from: origin + directory,
 * with a trailing slash and without `index.html`, query or hash. This must be
 * registered character for character in the Spotify Developer Dashboard.
 */
export function redirectUriFor(location) {
  let path = location.pathname || '/';
  path = path.replace(/index\.html?$/i, '');
  if (!path.endsWith('/')) path += '/';
  return `${location.origin}${path}`;
}

/** Spotify client IDs are 32 hexadecimal characters. */
export function isValidClientId(id) {
  return typeof id === 'string' && /^[0-9a-f]{32}$/i.test(id.trim());
}

export function hasScopes(granted, required = SPOTIFY_SCOPES) {
  const set = new Set(String(granted || '').split(/\s+/).filter(Boolean));
  return required.every((s) => set.has(s));
}
