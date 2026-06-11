const DB_NAME = 'orggraph';
const DB_VERSION = 1;
const STORE = 'files';

// Stable logical keys (decoupled from env URLs).
const KEY_ENV = 'env';
const KEY_DATA = 'data';
const KEY_PSEUDO = 'pseudo';
const ATTR_PREFIX = 'attr:';

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE); // out-of-line keys
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  try {
    return await tx('readonly', store => reqAsPromise(store.get(key)));
  } catch (e) {
    console.warn('[storage] get failed', key, e);
    return undefined;
  }
}

async function idbPut(key, value) {
  return tx('readwrite', store => reqAsPromise(store.put(value, key)));
}

async function idbDelete(key) {
  return tx('readwrite', store => reqAsPromise(store.delete(key)));
}

async function idbKeys() {
  try {
    return await tx('readonly', store => reqAsPromise(store.getAllKeys()));
  } catch (e) {
    console.warn('[storage] keys failed', e);
    return [];
  }
}

async function idbClear() {
  return tx('readwrite', store => reqAsPromise(store.clear()));
}

// Ask the browser to keep our data durable (avoid eviction under storage pressure).
async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    console.warn('[storage] persist() not available', e);
  }
  return false;
}

// ---- Classification of dropped files ----

function looksLikeEnv(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if ('DATA_URL' in obj) return true;
  return Object.keys(obj).some(k => k.startsWith('TOOLBAR_') || k.startsWith('LEGEND_'));
}

function looksLikePseudo(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj.names)) return true;
  return Object.keys(obj).some(k => k.startsWith('organizationalUnits'));
}

function looksLikeData(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Array.isArray(obj.persons) || Array.isArray(obj.orgs) || Array.isArray(obj.links);
}

const ATTR_EXT = /\.(tsv|txt|csv)$/i;

/**
 * Classify a single dropped/picked file into a logical kind.
 * Returns { kind: 'env'|'pseudo'|'data'|'attr'|'unknown', key, filename, text }.
 */
async function classifyFile(file) {
  const filename = file.name || 'unnamed';
  const text = await file.text();

  if (ATTR_EXT.test(filename)) {
    return { kind: 'attr', key: ATTR_PREFIX + filename, filename, text };
  }

  // JSON-ish: classify by content.
  let obj = null;
  try { obj = JSON.parse(text); } catch { /* not JSON */ }

  if (looksLikeEnv(obj)) return { kind: 'env', key: KEY_ENV, filename, text };
  if (looksLikePseudo(obj)) return { kind: 'pseudo', key: KEY_PSEUDO, filename, text };
  if (looksLikeData(obj)) return { kind: 'data', key: KEY_DATA, filename, text };

  return { kind: 'unknown', key: null, filename, text };
}

/**
 * Persist a list of files (from a drop or multi-file picker). Returns a summary
 * { stored: [{kind, filename}], unknown: [filename] }.
 */
async function storeFiles(fileList) {
  const stored = [];
  const unknown = [];
  for (const file of Array.from(fileList || [])) {
    const c = await classifyFile(file);
    if (c.kind === 'unknown') { unknown.push(c.filename); continue; }
    await idbPut(c.key, c.text);
    if (c.kind === 'attr') {
      // remember original filename alongside the content for category derivation
      await idbPut(c.key + '::name', c.filename);
    }
    stored.push({ kind: c.kind, filename: c.filename });
  }
  return { stored, unknown };
}

async function getStoredText(key) {
  const v = await idbGet(key);
  return typeof v === 'string' ? v : undefined;
}

async function getStoredJson(key) {
  const t = await getStoredText(key);
  if (t == null) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** List stored attribute files as [{ key, filename, text }]. */
async function getStoredAttributes() {
  const keys = await idbKeys();
  const out = [];
  for (const k of keys) {
    if (typeof k !== 'string') continue;
    if (!k.startsWith(ATTR_PREFIX) || k.endsWith('::name')) continue;
    const text = await getStoredText(k);
    if (text == null) continue;
    const filename = (await getStoredText(k + '::name')) || k.slice(ATTR_PREFIX.length);
    out.push({ key: k, filename, text });
  }
  return out;
}

async function hasStoredData() {
  return (await getStoredText(KEY_DATA)) != null;
}


// ===== src/dropzone.js =====
// ========== Drag & drop file intake (standalone) ==========
// Renders an overlay prompting for files when nothing is loaded, and accepts
// drops anywhere in the window to (re)load data. Dependency-free.

let _overlay = null;
let _dragDepth = 0;

