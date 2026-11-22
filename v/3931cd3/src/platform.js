// Browser and device specifics: iOS detection, audio session, screen wake lock, file sharing.
import { wavHeader } from './mixer/wav.js';

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isTouch() {
  return matchMedia('(pointer: coarse)').matches;
}

let silentEl = null;

/**
 * Put the page in "playback" audio mode so Web Audio plays with the iPhone
 * silent switch on. Safari 16.4+ has navigator.audioSession; older iOS needs a
 * silent <audio> element started inside a user gesture.
 */
export function setPlaybackAudioSession(active) {
  try {
    if ('audioSession' in navigator && navigator.audioSession) {
      navigator.audioSession.type = active ? 'playback' : 'auto';
      return;
    }
  } catch {
    /* not supported */
  }
  if (!isIOS()) return;
  if (active) {
    if (!silentEl) {
      silentEl = document.createElement('audio');
      silentEl.setAttribute('playsinline', '');
      silentEl.setAttribute('x-webkit-airplay', 'deny');
      silentEl.preload = 'auto';
      silentEl.loop = true;
      // 0.2 s of real silence as a 16-bit WAV.
      const frames = 9600;
      silentEl.src = URL.createObjectURL(new Blob([wavHeader(frames * 4, 48000), new Int16Array(frames * 2)], { type: 'audio/wav' }));
    }
    silentEl.play().catch(() => {});
  } else if (silentEl) {
    silentEl.pause();
  }
}

let wakeLock = null;
let wantAwake = false;

/** Keep the screen on while decks play or a recording runs (Safari 16.4+, Chrome). */
export async function keepScreenAwake(on) {
  wantAwake = on;
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantAwake && !wakeLock) keepScreenAwake(true);
});

export function canShareFile(file) {
  try {
    return Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
