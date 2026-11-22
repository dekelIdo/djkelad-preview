// Spotify session: PKCE login, token exchange, storage and refresh.
import {
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN_URL,
  buildAuthorizeUrl,
  codeChallenge,
  hasScopes,
  randomString,
} from './pkce.js';

const PKCE_KEY = 'djkelad.spotify.pkce';
const TOKEN_KEY = 'djkelad.spotify.token';
const PKCE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;

export class SpotifyAuthError extends Error {
  /** @param {'NOT_CONNECTED'|'REFRESH_FAILED'|'STATE_MISMATCH'|'EXCHANGE_FAILED'|'DENIED'|'NO_CLIENT_ID'} code */
  constructor(code, message) {
    super(message || code);
    this.name = 'SpotifyAuthError';
    this.code = code;
  }
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode quota): the session lasts for this page only */
  }
}

/**
 * @param {{
 *   storage: Storage,
 *   fetchImpl?: typeof fetch,
 *   clientId: () => string,
 *   redirectUri: () => string,
 *   now?: () => number,
 *   onChange?: (connected: boolean) => void,
 * }} deps
 */
export function createSpotifyAuth(deps) {
  const fetchImpl = deps.fetchImpl ?? ((...a) => fetch(...a));
  const now = deps.now ?? (() => Date.now());
  const storage = deps.storage;
  let memoryToken = readJson(storage, TOKEN_KEY);
  let refreshing = null;

  function saveToken(json, previous) {
    const token = {
      accessToken: json.access_token,
      // PKCE refresh tokens rotate: keep the new one when Spotify sends it.
      refreshToken: json.refresh_token || previous?.refreshToken || null,
      expiresAt: now() + (Number(json.expires_in) || 3600) * 1000,
      scope: json.scope ?? previous?.scope ?? '',
      clientId: deps.clientId(),
    };
    memoryToken = token;
    writeJson(storage, TOKEN_KEY, token);
    deps.onChange?.(true);
    return token;
  }

  function clear() {
    memoryToken = null;
    writeJson(storage, TOKEN_KEY, null);
    deps.onChange?.(false);
  }

  async function postToken(body) {
    const res = await fetchImpl(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  }

  const api = {
    /** Builds the authorize URL and remembers the verifier for the redirect. */
    async beginLogin({ showDialog = false } = {}) {
      const clientId = deps.clientId();
      if (!clientId) throw new SpotifyAuthError('NO_CLIENT_ID', 'No Spotify client ID is configured.');
      const verifier = randomString(64);
      const state = randomString(24);
      const challenge = await codeChallenge(verifier);
      writeJson(storage, PKCE_KEY, { verifier, state, createdAt: now(), redirectUri: deps.redirectUri() });
      return buildAuthorizeUrl({ clientId, redirectUri: deps.redirectUri(), challenge, state, showDialog });
    },

    /**
     * Completes the login when the page was opened by Spotify's redirect.
     * @param {URLSearchParams} params
     * @returns {Promise<{handled: boolean, ok?: boolean, error?: SpotifyAuthError}>}
     */
    async handleRedirect(params) {
      const code = params.get('code');
      const error = params.get('error');
      const state = params.get('state');
      if (!code && !error) return { handled: false };
      const pending = readJson(storage, PKCE_KEY);
      writeJson(storage, PKCE_KEY, null);
      if (error) {
        return { handled: true, ok: false, error: new SpotifyAuthError('DENIED', error === 'access_denied' ? 'Spotify access was not granted.' : `Spotify returned: ${error}`) };
      }
      if (!pending || pending.state !== state || now() - pending.createdAt > PKCE_MAX_AGE_MS) {
        return { handled: true, ok: false, error: new SpotifyAuthError('STATE_MISMATCH', 'The Spotify sign-in expired or came from another tab. Please connect again.') };
      }
      const res = await postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirectUri || deps.redirectUri(),
        client_id: deps.clientId(),
        code_verifier: pending.verifier,
      });
      if (!res.ok || !res.json?.access_token) {
        const detail = res.json?.error_description || res.json?.error || `HTTP ${res.status}`;
        return { handled: true, ok: false, error: new SpotifyAuthError('EXCHANGE_FAILED', `Spotify sign-in failed: ${detail}`) };
      }
      saveToken(res.json, null);
      return { handled: true, ok: true };
    },

    isConnected() {
      return Boolean(memoryToken?.accessToken && memoryToken.clientId === deps.clientId());
    },

    grantedScopes() {
      return memoryToken?.scope ?? '';
    },

    hasAllScopes() {
      return hasScopes(memoryToken?.scope, SPOTIFY_SCOPES);
    },

    /** A valid access token, refreshed when it is about to expire. */
    async getAccessToken() {
      if (!api.isConnected()) throw new SpotifyAuthError('NOT_CONNECTED', 'Spotify is not connected.');
      if (memoryToken.expiresAt - REFRESH_MARGIN_MS > now()) return memoryToken.accessToken;
      const token = await api.refresh();
      return token.accessToken;
    },

    /** Single-flight refresh. Clears the session when Spotify rejects the refresh token. */
    async refresh() {
      if (refreshing) return refreshing;
      const previous = memoryToken;
      if (!previous?.refreshToken) {
        clear();
        throw new SpotifyAuthError('REFRESH_FAILED', 'Your Spotify session ended. Connect again.');
      }
      refreshing = (async () => {
        try {
          const res = await postToken({
            grant_type: 'refresh_token',
            refresh_token: previous.refreshToken,
            client_id: deps.clientId(),
          });
          if (!res.ok || !res.json?.access_token) {
            // 400 invalid_grant: revoked or rotated away. Network errors throw before this.
            if (res.status >= 400 && res.status < 500) clear();
            throw new SpotifyAuthError('REFRESH_FAILED', 'Your Spotify session ended. Connect again.');
          }
          return saveToken(res.json, previous);
        } finally {
          refreshing = null;
        }
      })();
      return refreshing;
    },

    disconnect() {
      clear();
    },
  };
  return api;
}
