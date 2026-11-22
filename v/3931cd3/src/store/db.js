// IndexedDB persistence for imported tracks and saved mixes (this device only).
// Falls back to memory when IndexedDB is unavailable (some private modes).

const DB_NAME = 'djkelad';
const DB_VERSION = 1;
const STORES = ['tracks', 'recordings'];

let dbPromise = null;
const memory = { tracks: new Map(), recordings: new Map() };
let persistent = true;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      persistent = false;
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      persistent = false;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      persistent = false;
      resolve(null);
    };
    req.onblocked = () => {
      persistent = false;
      resolve(null);
    };
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const req = fn(s);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function getAll(store) {
  const db = await open();
  if (!db) return [...memory[store].values()];
  try {
    const stored = (await tx(db, store, 'readonly', (s) => s.getAll())) || [];
    // Records that could not be written (quota) still live in memory this session.
    const ids = new Set(stored.map((r) => r.id));
    return stored.concat([...memory[store].values()].filter((r) => !ids.has(r.id)));
  } catch {
    return [...memory[store].values()];
  }
}

async function put(store, record) {
  memory[store].set(record.id, record);
  const db = await open();
  if (!db) return false;
  try {
    await tx(db, store, 'readwrite', (s) => s.put(record));
    return true;
  } catch {
    // Quota or Blob storage failure: keep it in memory for this session.
    persistent = false;
    return false;
  }
}

async function remove(store, id) {
  memory[store].delete(id);
  const db = await open();
  if (!db) return;
  try {
    await tx(db, store, 'readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}

async function patch(store, id, changes) {
  const db = await open();
  let rec = memory[store].get(id);
  if (!rec && db) {
    try {
      rec = await tx(db, store, 'readonly', (s) => s.get(id));
    } catch {
      rec = null;
    }
  }
  if (!rec) return null;
  const next = { ...rec, ...changes };
  await put(store, next);
  return next;
}

export const db = {
  get persistent() {
    return persistent;
  },
  listTracks: async () => (await getAll('tracks')).sort((a, b) => b.addedAt - a.addedAt),
  saveTrack: (rec) => put('tracks', rec),
  updateTrack: (id, changes) => patch('tracks', id, changes),
  deleteTrack: (id) => remove('tracks', id),
  listRecordings: async () => (await getAll('recordings')).sort((a, b) => b.createdAt - a.createdAt),
  saveRecording: (rec) => put('recordings', rec),
  deleteRecording: (id) => remove('recordings', id),
  async requestPersistence() {
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch {
      /* optional */
    }
  },
};
