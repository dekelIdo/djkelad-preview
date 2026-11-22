// File picking for local audio (iPhone Files app, desktop file dialog, drag and drop).
import { h } from './dom.js';

export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.aif,.aiff,.flac,.ogg,.opus';

/** Opens the system picker. Must be called from a tap/click. */
export function pickAudioFiles(onFiles, { multiple = true } = {}) {
  const input = h('input', {
    type: 'file',
    accept: AUDIO_ACCEPT,
    multiple,
    class: 'visually-hidden-input',
    'aria-hidden': 'true',
    tabindex: '-1',
  });
  input.addEventListener('change', () => {
    const files = input.files ? Array.from(input.files) : [];
    input.remove();
    if (files.length) onFiles(files);
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.append(input);
  input.click();
}

/** Drag and drop audio files anywhere on `target` (desktop). */
export function enableDrop(target, onFiles) {
  let depth = 0;
  target.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    depth++;
    target.classList.add('dropping');
  });
  target.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });
  target.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) target.classList.remove('dropping');
  });
  target.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    target.classList.remove('dropping');
    onFiles(Array.from(e.dataTransfer.files));
  });
}
