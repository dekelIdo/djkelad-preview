// Spotify JSON -> the small shapes the UI renders. Pure and defensive: the
// February 2026 changes renamed playlist `tracks` to `items` and entry `track`
// to `item`, so both spellings are accepted.

export function pickImage(images, target = 64) {
  if (!Array.isArray(images) || images.length === 0) return '';
  const sized = images.filter((i) => i && i.url);
  if (sized.length === 0) return '';
  // Smallest image that is at least `target` px, else the largest available.
  const withSize = sized.map((i) => ({ url: i.url, size: Math.max(i.width || 0, i.height || 0) || 640 }));
  withSize.sort((a, b) => a.size - b.size);
  return (withSize.find((i) => i.size >= target) || withSize[withSize.length - 1]).url;
}

function artistNames(artists) {
  return Array.isArray(artists) ? artists.map((a) => a?.name).filter(Boolean).join(', ') : '';
}

export function mapTrack(t) {
  if (!t || typeof t !== 'object' || !t.uri) return null;
  const isEpisode = t.type === 'episode';
  const images = isEpisode ? t.images || t.show?.images : t.album?.images;
  const playable = !t.is_local && /^spotify:(track|episode):/.test(t.uri) && t.is_playable !== false;
  return {
    uri: t.uri,
    id: t.id || '',
    name: t.name || 'Untitled',
    artists: isEpisode ? t.show?.name || t.show?.publisher || '' : artistNames(t.artists),
    album: isEpisode ? '' : t.album?.name || '',
    image: pickImage(images, 64),
    imageLarge: pickImage(images, 300),
    durationMs: Number(t.duration_ms) || 0,
    playable,
    url: t.external_urls?.spotify || (t.id ? `https://open.spotify.com/${isEpisode ? 'episode' : 'track'}/${t.id}` : ''),
    type: isEpisode ? 'episode' : 'track',
  };
}

export function mapPlaylistEntry(entry) {
  return mapTrack(entry?.item ?? entry?.track ?? null);
}

export function mapLikedEntry(entry) {
  return mapTrack(entry?.track ?? entry?.item ?? null);
}

export function mapPlaylist(p, meId) {
  if (!p || !p.id) return null;
  const ownerId = p.owner?.id || '';
  const total = p.items?.total ?? p.tracks?.total ?? null;
  return {
    id: p.id,
    uri: p.uri || `spotify:playlist:${p.id}`,
    name: p.name || 'Untitled playlist',
    image: pickImage(p.images, 64),
    imageLarge: pickImage(p.images, 300),
    owner: p.owner?.display_name || ownerId,
    ownerId,
    total: Number.isFinite(total) ? total : null,
    collaborative: Boolean(p.collaborative),
    // Development Mode only returns contents for playlists the user owns or collaborates on.
    contentsAvailable: Boolean(meId && ownerId === meId) || Boolean(p.collaborative),
    url: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`,
  };
}

export function mapProfile(me) {
  if (!me) return null;
  return {
    id: me.id || '',
    name: me.display_name || me.id || 'Spotify user',
    image: pickImage(me.images, 64),
    // `product` was removed from /me in Development Mode; keep it when present.
    product: me.product || null,
  };
}

export function mapDevice(d) {
  if (!d) return null;
  return {
    id: d.id || '',
    name: d.name || 'Spotify device',
    type: d.type || 'Unknown',
    isActive: Boolean(d.is_active),
    isRestricted: Boolean(d.is_restricted),
    volume: Number.isFinite(d.volume_percent) ? d.volume_percent : null,
    supportsVolume: d.supports_volume !== false && Number.isFinite(d.volume_percent),
  };
}

/** GET /me/player -> playback snapshot (null when nothing is active). */
export function mapPlaybackState(s, receivedAt = Date.now()) {
  if (!s || !s.device) return null;
  const track = mapTrack(s.item);
  return {
    source: 'remote',
    isPlaying: Boolean(s.is_playing),
    progressMs: Number(s.progress_ms) || 0,
    updatedAt: receivedAt,
    durationMs: track?.durationMs || 0,
    track,
    device: mapDevice(s.device),
    contextUri: s.context?.uri || null,
    shuffle: Boolean(s.shuffle_state),
    repeat: s.repeat_state || 'off',
    disallows: s.actions?.disallows || {},
  };
}

function mapSdkTrack(t) {
  if (!t) return null;
  return mapTrack({
    uri: t.uri,
    id: t.id,
    name: t.name,
    type: t.type === 'episode' ? 'episode' : 'track',
    artists: t.artists,
    album: t.album,
    images: t.album?.images,
    duration_ms: t.duration_ms,
  });
}

/** Web Playback SDK `player_state_changed` -> playback snapshot. */
export function mapSdkState(state, deviceId, receivedAt = Date.now()) {
  if (!state || !state.track_window?.current_track) return null;
  const track = mapSdkTrack(state.track_window.current_track);
  return {
    source: 'sdk',
    isPlaying: !state.paused,
    progressMs: Number(state.position) || 0,
    updatedAt: receivedAt,
    durationMs: Number(state.duration) || track?.durationMs || 0,
    track,
    device: { id: deviceId, name: 'DJKELAD Web', type: 'Computer', isActive: true, isRestricted: false, volume: null, supportsVolume: true },
    contextUri: state.context?.uri || null,
    shuffle: Boolean(state.shuffle),
    repeat: ['off', 'context', 'track'][state.repeat_mode] || 'off',
    disallows: state.disallows || {},
    nextTracks: (state.track_window.next_tracks || []).map(mapSdkTrack).filter(Boolean),
  };
}

export function mapQueue(q) {
  return {
    current: mapTrack(q?.currently_playing),
    queue: Array.isArray(q?.queue) ? q.queue.map(mapTrack).filter(Boolean) : [],
  };
}

/** Progress right now, interpolated from the last snapshot. */
export function liveProgress(playback, now = Date.now()) {
  if (!playback) return 0;
  const base = playback.progressMs || 0;
  const elapsed = playback.isPlaying ? Math.max(0, now - (playback.updatedAt || now)) : 0;
  const pos = base + elapsed;
  return playback.durationMs ? Math.min(pos, playback.durationMs) : pos;
}

export function dedupeTracks(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (!t || seen.has(t.uri)) continue;
    seen.add(t.uri);
    out.push(t);
  }
  return out;
}
