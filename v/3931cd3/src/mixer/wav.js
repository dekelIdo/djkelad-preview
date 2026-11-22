// 16-bit PCM WAV encoding (pure).

/** Interleave two float channels into 16-bit PCM. */
export function floatToInt16Interleaved(left, right) {
  const n = left.length;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right ? right[i] : left[i]));
    out[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
    out[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }
  return out;
}

/** 44-byte RIFF/WAVE header for PCM data of `dataBytes` bytes. */
export function wavHeader(dataBytes, sampleRate, channels = 2, bitsPerSample = 16) {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const writeStr = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  const blockAlign = (channels * bitsPerSample) / 8;
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  v.setUint32(40, dataBytes, true);
  return buf;
}
