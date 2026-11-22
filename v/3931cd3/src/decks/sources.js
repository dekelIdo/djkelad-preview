// Audio source adapters. The same two-deck UX (Queue A / Queue B, NOW / NEXT,
// automatic transitions) runs on every source, but each source only gets the
// capabilities it is technically and legally allowed to have.

export const SOURCES = {
  LOCAL_AUDIO: {
    key: 'local',
    label: 'My files',
    status: 'available',
    summary: 'Your own audio files. Both decks play at the same time in the browser: crossfader, AUTO MIX, CUE, tempo, EQ and mix recording.',
    capabilities: {
      independentDecks: true,
      overlap: true,
      crossfader: true,
      autoMix: 'crossfade',
      cue: true,
      tempo: true,
      eq: true,
      waveform: true,
      bpm: true,
      record: true,
    },
  },
  SPOTIFY_CONTROL: {
    key: 'spotify',
    label: 'Spotify',
    status: 'needs-spotify-app',
    summary:
      'Your Spotify Premium library. Two queues feed one Spotify player: one song plays at a time, the other deck waits as NEXT. No overlap, no crossfader, no recording (Spotify Developer Policy III.7).',
    capabilities: {
      independentDecks: false,
      overlap: false,
      crossfader: false,
      autoMix: 'sequential', // Spotify plays the next song itself (its own Crossfade setting applies, if on)
      cue: false,
      tempo: false,
      eq: false,
      waveform: false,
      bpm: false, // Spotify removed audio-features for new apps (Nov 2024) and forbids analysing its audio
      record: false,
    },
  },
  AUTHORIZED_DJ_STREAMING: {
    key: 'dj-streaming',
    label: 'Licensed DJ streaming',
    status: 'not-available',
    summary:
      'A future provider that licenses streaming tracks for real two-deck mixing. Spotify offers this only to DJ-software partners under a separate agreement; there is no self-service access.',
    capabilities: {
      independentDecks: true,
      overlap: true,
      crossfader: true,
      autoMix: 'crossfade',
      cue: true,
      tempo: true,
      eq: true,
      waveform: true,
      bpm: true,
      record: false,
    },
    requires: [
      'A signed DJ-integration agreement with the provider (Spotify: business partnership, as rekordbox, Serato, djay, VirtualDJ, Cross DJ and edjing have).',
      'A registered company and the provider’s commercial and security review.',
      'The provider’s DJ playback SDK or stream access (not the public Web API / Web Playback SDK).',
    ],
  },
};

const BY_KIND = { local: SOURCES.LOCAL_AUDIO, spotify: SOURCES.SPOTIFY_CONTROL };

export function sourceForKind(kind) {
  return BY_KIND[kind] || null;
}

export function canOverlap(kind) {
  return Boolean(BY_KIND[kind]?.capabilities.overlap);
}
