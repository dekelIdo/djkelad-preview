// Local music library (imported files) and saved mixes, persisted on this device.
import { db } from '../store/db.js';
import { createStore, isAudioFile, mixFileName, parseTrackName, uid } from '../util.js';

export function createLocalLibrary() {
  const store = createStore({ tracks: [], recordings: [], loaded: false, importing: false });

  async function refresh() {
    const [tracks, recordings] = await Promise.all([db.listTracks(), db.listRecordings()]);
    store.set({ tracks, recordings, loaded: true });
  }

  return {
    store,
    refresh,

    /** @returns {Promise<{ added: object[], skipped: string[] }>} */
    async importFiles(fileList) {
      const files = Array.from(fileList || []);
      const added = [];
      const skipped = [];
      store.set({ importing: true });
      try {
        let i = 0;
        for (const file of files) {
          if (!isAudioFile(file)) {
            skipped.push(file.name);
            continue;
          }
          const { title, artist } = parseTrackName(file.name);
          const rec = {
            id: uid(),
            name: file.name,
            title,
            artist,
            size: file.size,
            type: file.type || '',
            addedAt: Date.now() + i++,
            blob: file,
          };
          await db.saveTrack(rec);
          added.push(rec);
        }
        if (added.length) db.requestPersistence();
        await refresh();
      } finally {
        store.set({ importing: false });
      }
      return { added, skipped };
    },

    async removeTrack(id) {
      await db.deleteTrack(id);
      await refresh();
    },

    /** Remember duration / BPM / peaks so the next load is instant. */
    async cacheAnalysis(id, { duration, bpm, peaks }) {
      const next = await db.updateTrack(id, { duration, bpm: bpm ?? null, peaks });
      if (next) store.set({ tracks: store.get().tracks.map((t) => (t.id === id ? next : t)) });
    },

    async addRecording({ blob, mime, ext, durationSec }) {
      const createdAt = Date.now();
      const rec = { id: uid(), name: mixFileName(new Date(createdAt), ext), createdAt, durationSec, mime, size: blob.size, blob };
      await db.saveRecording(rec);
      await refresh();
      return rec;
    },

    async removeRecording(id) {
      await db.deleteRecording(id);
      await refresh();
    },

    get persistent() {
      return db.persistent;
    },
  };
}
