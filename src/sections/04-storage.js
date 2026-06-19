export const DB_NAME = 'orggraph';
export const DB_VERSION = 1;
export const STORE = 'files';

// Stable logical keys (decoupled from env URLs).
export const KEY_ENV = 'env';
export const KEY_DATA = 'data';
export const KEY_PSEUDO = 'pseudo';
export const ATTR_PREFIX = 'attr:';
export const KEY_ATTR_MATCHES = 'attrMatches';

let _dbPromise = null;

export function openDb() {
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

export function tx(mode, fn) {
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

export function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet(key) {
  try {
    return await tx('readonly', store => reqAsPromise(store.get(key)));
  } catch (e) {
    console.warn('[storage] get failed', key, e);
    return undefined;
  }
}

export async function idbPut(key, value) {
  return tx('readwrite', store => reqAsPromise(store.put(value, key)));
}

export async function idbDelete(key) {
  return tx('readwrite', store => reqAsPromise(store.delete(key)));
}

export async function idbKeys() {
  try {
    return await tx('readonly', store => reqAsPromise(store.getAllKeys()));
  } catch (e) {
    console.warn('[storage] keys failed', e);
    return [];
  }
}

export async function idbClear() {
  return tx('readwrite', store => reqAsPromise(store.clear()));
}

// ---- Profiles (parallel configurations) ----
//
// Multiple configurations live side by side in the same object store. Each
// profile namespaces the logical keys (env/data/pseudo/attr:*/attrMatches) as
// `p:<profileId>:<logicalKey>`. A single un-namespaced meta record tracks the
// list and the active profile. The primitives above stay raw; namespacing is a
// deliberate layer applied by getStored*/putStored and storeEntries.
export const KEY_PROFILES = '__profiles__';
export const DEFAULT_PROFILE_ID = 'default';
export const DEFAULT_PROFILE_NAME = 'Standard';

let _activeProfile = null;
let _profilesInit = null;

/** Test hook: forget the cached active profile so the next access re-resolves. */
export function _resetProfilesCache() { _activeProfile = null; _profilesInit = null; }

/** Keys already carrying a namespace (`p:`) or meta (`__`) are passed through raw. */
function isRawKey(k) {
  return typeof k === 'string' && (k.startsWith('p:') || k.startsWith('__'));
}

export async function getProfilesMeta() {
  const m = await idbGet(KEY_PROFILES);
  return (m && typeof m === 'object' && Array.isArray(m.list)) ? m : null;
}

async function putProfilesMeta(meta) { await idbPut(KEY_PROFILES, meta); return meta; }

/** One-time, idempotent: wrap pre-existing global keys into a 'default' profile. */
async function migrateLegacyToDefault() {
  const keys = await idbKeys();
  const legacy = keys.filter(k => typeof k === 'string' && !isRawKey(k) &&
    (k === KEY_ENV || k === KEY_DATA || k === KEY_PSEUDO || k === KEY_ATTR_MATCHES || k.startsWith(ATTR_PREFIX)));
  for (const k of legacy) {
    const v = await idbGet(k);
    await idbPut('p:' + DEFAULT_PROFILE_ID + ':' + k, v);
    await idbDelete(k);
  }
  return putProfilesMeta({
    active: DEFAULT_PROFILE_ID,
    list: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: Date.now() }],
  });
}

/** Resolve (and lazily create/migrate) the active profile id. Runs once per load. */
export async function ensureProfilesInitialized() {
  if (_activeProfile) return _activeProfile;
  if (!_profilesInit) {
    _profilesInit = (async () => {
      let meta = await getProfilesMeta();
      if (!meta || !meta.active) meta = await migrateLegacyToDefault();
      _activeProfile = meta.active;
      // Clean up a leftover empty 'default' from older installs on load.
      if (await pruneEmptyDefault(meta)) await putProfilesMeta(meta);
      return _activeProfile;
    })();
  }
  return _profilesInit;
}

/** Map a logical key into the active profile namespace (raw keys pass through). */
export async function profileKey(logicalKey) {
  if (isRawKey(logicalKey)) return logicalKey;
  const id = await ensureProfilesInitialized();
  return 'p:' + id + ':' + logicalKey;
}

/** Namespaced write into the active profile. */
export async function putStored(logicalKey, value) { return idbPut(await profileKey(logicalKey), value); }
/** Namespaced delete from the active profile. */
export async function delStored(logicalKey) { return idbDelete(await profileKey(logicalKey)); }

function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profil';
}

async function uniqueProfileId(base, meta) {
  const ids = new Set(meta.list.map(p => p.id));
  let id = base, n = 2;
  while (ids.has(id)) id = base + '-' + (n++);
  return id;
}

export async function listProfiles() {
  const m = await getProfilesMeta();
  return m ? m.list.slice() : [];
}

export async function getActiveProfileId() { return ensureProfilesInitialized(); }

export async function createProfile(name, { activate = true, source = null } = {}) {
  await ensureProfilesInitialized();
  const meta = (await getProfilesMeta()) || { active: _activeProfile, list: [] };
  const id = await uniqueProfileId(slugify(name), meta);
  meta.list.push({ id, name: name || id, createdAt: Date.now(), source });
  if (activate) { meta.active = id; _activeProfile = id; }
  await pruneEmptyDefault(meta);
  await putProfilesMeta(meta);
  return id;
}

export async function switchProfile(id) {
  await ensureProfilesInitialized();
  const meta = await getProfilesMeta();
  if (!meta || !meta.list.some(p => p.id === id)) throw new Error('Unbekanntes Profil: ' + id);
  meta.active = id;
  await putProfilesMeta(meta);
  _activeProfile = id;
  return id;
}

export async function renameProfile(id, name) {
  await ensureProfilesInitialized();
  const meta = await getProfilesMeta();
  if (!meta) return;
  const p = meta.list.find(x => x.id === id);
  if (p) { p.name = name; await putProfilesMeta(meta); }
}

async function copyProfileKeys(srcId, dstId) {
  const srcPrefix = 'p:' + srcId + ':', dstPrefix = 'p:' + dstId + ':';
  for (const k of await idbKeys()) {
    if (typeof k === 'string' && k.startsWith(srcPrefix)) {
      await idbPut(dstPrefix + k.slice(srcPrefix.length), await idbGet(k));
    }
  }
}

export async function duplicateProfile(id, name) {
  await ensureProfilesInitialized();
  const meta = await getProfilesMeta();
  if (!meta) return null;
  const newId = await uniqueProfileId(slugify(name || (id + '-kopie')), meta);
  await copyProfileKeys(id, newId);
  meta.list.push({ id: newId, name: name || (id + ' Kopie'), createdAt: Date.now() });
  await pruneEmptyDefault(meta);
  await putProfilesMeta(meta);
  return newId;
}

async function deleteProfileKeys(id) {
  const prefix = 'p:' + id + ':';
  for (const k of await idbKeys()) {
    if (typeof k === 'string' && k.startsWith(prefix)) await idbDelete(k);
  }
}

/** True when the given profile has a stored dataset (KEY_DATA). */
async function profileHasData(id) {
  const v = await idbGet('p:' + id + ':' + KEY_DATA);
  return typeof v === 'string' && v.length > 0;
}

/** Prefer a profile that actually holds data, so a switch lands on something visible. */
async function pickActiveProfile(list) {
  for (const p of list) if (await profileHasData(p.id)) return p.id;
  return list[0].id;
}

/**
 * Drop the initial 'default' profile once it has become a useless empty husk:
 * it carries no data, is not the active profile, and at least one other profile
 * exists. Mutates meta.list and returns true when something was pruned (caller
 * persists meta). The active profile is never pruned, so _activeProfile stays valid.
 */
async function pruneEmptyDefault(meta) {
  if (meta.active === DEFAULT_PROFILE_ID) return false;
  if (meta.list.length <= 1) return false;
  if (!meta.list.some(p => p.id === DEFAULT_PROFILE_ID)) return false;
  if (await profileHasData(DEFAULT_PROFILE_ID)) return false;
  await deleteProfileKeys(DEFAULT_PROFILE_ID);
  meta.list = meta.list.filter(p => p.id !== DEFAULT_PROFILE_ID);
  return true;
}

export async function deleteProfile(id) {
  await ensureProfilesInitialized();
  const meta = await getProfilesMeta();
  if (!meta) return null;
  await deleteProfileKeys(id);
  meta.list = meta.list.filter(p => p.id !== id);
  if (!meta.list.length) {
    meta.list.push({ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: Date.now() });
  }
  if (!meta.list.some(p => p.id === meta.active)) meta.active = await pickActiveProfile(meta.list);
  await putProfilesMeta(meta);
  _activeProfile = meta.active;
  return meta.active;
}

// Ask the browser to keep our data durable (avoid eviction under storage pressure).
export async function requestPersistence() {
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

export function looksLikeEnv(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).some(k =>
    k.startsWith('DATA_') || k.startsWith('TOOLBAR_') || k.startsWith('LEGEND_'));
}

export function looksLikePseudo(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj.names)) return true;
  return Object.keys(obj).some(k => k.startsWith('organizationalUnits'));
}

export function looksLikeData(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Array.isArray(obj.persons) || Array.isArray(obj.orgs) || Array.isArray(obj.links);
}

export const ATTR_EXT = /\.(tsv|txt|csv)$/i;

/**
 * Classify a single dropped/picked file into a logical kind.
 * Returns { kind: 'env'|'pseudo'|'data'|'attr'|'unknown', key, filename, text }.
 */
export async function classifyFile(file) {
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

// ---- Relative-path resolution for folder/ZIP drops ----

/** Normalize a relative path: backslashes to slashes, resolve '.'/'..' segments. */
export function normalizeRelPath(path) {
  const out = [];
  for (const part of String(path || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

/** Directory portion of a normalized path ('a/b/c.json' -> 'a/b', 'c.json' -> ''). */
export function dirOf(path) {
  const n = normalizeRelPath(path);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(0, i) : '';
}

/** Final path segment without query/fragment ('a/b/c.txt?v=1' -> 'c.txt'). */
export function basenameOf(path) {
  const n = normalizeRelPath(String(path || '').split('?')[0].split('#')[0]);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

/**
 * Resolve an env reference (e.g. "./data.json") against the env file's
 * location inside the dropped file set. Absolute URLs (http:, data:, …)
 * cannot be resolved within a drop and yield null.
 */
export function resolveRefPath(envPath, ref) {
  const r = String(ref || '');
  if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r)) return null;
  return normalizeRelPath(dirOf(envPath) + '/' + r.split('?')[0].split('#')[0]);
}

/** True when `path` lies inside `dirPath` (both relative to the drop root). */
export function isPathUnderDir(path, dirPath) {
  if (dirPath == null) return false;
  const n = normalizeRelPath(path);
  const d = normalizeRelPath(dirPath);
  return d === '' ? true : n.startsWith(d + '/');
}

/** Find the dropped entry an env reference points at (path match, unique-basename fallback). */
export function findEntryByRef(entries, envPath, ref) {
  const target = resolveRefPath(envPath, ref);
  if (target) {
    const hit = entries.find(en => normalizeRelPath(en.path) === target);
    if (hit) return hit;
  }
  const base = basenameOf(ref);
  const hits = entries.filter(en => basenameOf(en.path) === base);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Persist dropped entries [{path, file}] from a folder/ZIP/multi-file drop;
 * plain File objects are tolerated (path defaults to the filename). When an
 * env config is part of the drop it is authoritative: its DATA_URL /
 * DATA_ATTRIBUTES_URL references decide which dataset/attribute files are
 * stored, and unreferenced dataset/env candidates are ignored instead of
 * clobbering each other. Without an env file every entry is classified by
 * content as before. Returns { stored, unknown, missing, ignored }.
 */
export async function storeEntries(entryList) {
  const stored = [];
  const unknown = [];
  const missing = [];
  const ignored = [];

  const classified = [];
  for (const raw of Array.from(entryList || [])) {
    const file = raw && raw.file ? raw.file : raw;
    if (!file || typeof file.text !== 'function') continue;
    const path = (raw && raw.path) || file.name || 'unnamed';
    classified.push({ path, ...(await classifyFile(file)) });
  }

  const storeAttr = async (c) => {
    // remember original filename alongside the content for category derivation
    await putStored(ATTR_PREFIX + c.filename, c.text);
    await putStored(ATTR_PREFIX + c.filename + '::name', c.filename);
    stored.push({ kind: 'attr', filename: c.filename });
  };

  // Pick the authoritative env: a file named env.json wins over variants.
  const envs = classified.filter(c => c.kind === 'env');
  const env = envs.length <= 1
    ? (envs[0] || null)
    : envs.find(c => basenameOf(c.path).toLowerCase() === 'env.json')
      || [...envs].sort((a, b) => a.path.localeCompare(b.path))[0];

  const used = new Set();
  if (env) {
    used.add(env);
    await putStored(KEY_ENV, env.text);
    stored.push({ kind: 'env', filename: env.filename });

    // classifyFile only marks parseable JSON as env, so this cannot throw.
    const cfg = JSON.parse(env.text);

    if (cfg.DATA_URL) {
      const hit = findEntryByRef(classified, env.path, cfg.DATA_URL);
      if (hit) {
        used.add(hit);
        await putStored(KEY_DATA, hit.text);
        stored.push({ kind: 'data', filename: hit.filename });
      } else {
        missing.push(String(cfg.DATA_URL));
      }
    }

    const attrRefs = cfg.DATA_ATTRIBUTES_URL
      ? (Array.isArray(cfg.DATA_ATTRIBUTES_URL) ? cfg.DATA_ATTRIBUTES_URL : [cfg.DATA_ATTRIBUTES_URL])
      : [];
    for (const ref of attrRefs) {
      const hit = findEntryByRef(classified, env.path, ref);
      if (hit) { used.add(hit); await storeAttr(hit); }
      else missing.push(String(ref));
    }

    // Attribute directories (DATA_ATTRIBUTES_DIR): every attribute file
    // inside the directory counts as referenced — no explicit listing needed
    const attrDirs = cfg.DATA_ATTRIBUTES_DIR
      ? (Array.isArray(cfg.DATA_ATTRIBUTES_DIR) ? cfg.DATA_ATTRIBUTES_DIR : [cfg.DATA_ATTRIBUTES_DIR])
      : [];
    for (const dirRef of attrDirs) {
      const dirPath = resolveRefPath(env.path, String(dirRef).replace(/\/+$/, ''));
      const hits = classified.filter(c =>
        c.kind === 'attr' && !used.has(c) && isPathUnderDir(c.path, dirPath));
      if (!hits.length) { missing.push(String(dirRef)); continue; }
      for (const hit of hits) { used.add(hit); await storeAttr(hit); }
    }
  }

  for (const c of classified) {
    if (used.has(c)) continue;
    if (c.kind === 'unknown') { unknown.push(c.filename); continue; }
    if (env && (c.kind === 'env' || c.kind === 'data')) { ignored.push(c.filename); continue; }
    if (c.kind === 'attr') { await storeAttr(c); continue; }
    await putStored(c.key, c.text);
    stored.push({ kind: c.kind, filename: c.filename });
  }

  return { stored, unknown, missing, ignored };
}

/**
 * Persist a list of files (from a drop or multi-file picker). Returns a summary
 * { stored: [{kind, filename}], unknown: [filename], missing, ignored }.
 */
export async function storeFiles(fileList) {
  return storeEntries(Array.from(fileList || []));
}

export async function getStoredText(key) {
  const v = await idbGet(await profileKey(key));
  return typeof v === 'string' ? v : undefined;
}

export async function getStoredJson(key) {
  const t = await getStoredText(key);
  if (t == null) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** List stored attribute files of the active profile as [{ key, filename, text }]. */
export async function getStoredAttributes() {
  const prefix = await profileKey(ATTR_PREFIX); // p:<active>:attr:
  const keys = await idbKeys();
  const out = [];
  for (const k of keys) {
    if (typeof k !== 'string') continue;
    if (!k.startsWith(prefix) || k.endsWith('::name')) continue;
    const text = await idbGet(k);
    if (typeof text !== 'string') continue;
    const nameVal = await idbGet(k + '::name');
    const filename = (typeof nameVal === 'string' ? nameVal : null) || k.slice(prefix.length);
    out.push({ key: k, filename, text });
  }
  return out;
}

export async function hasStoredData() {
  return (await getStoredText(KEY_DATA)) != null;
}

/**
 * Persisted resolutions for attribute identifiers without an exact match:
 * identifier -> person id (confirmed assignment) or null (confirmed unmatched).
 * Saves re-running the fuzzy search and re-asking the user on every reload.
 */
export async function getStoredAttrMatches() {
  return (await getStoredJson(KEY_ATTR_MATCHES)) || {};
}

export async function mergeStoredAttrMatches(updates) {
  const merged = { ...(await getStoredAttrMatches()), ...updates };
  await putStored(KEY_ATTR_MATCHES, JSON.stringify(merged));
  return merged;
}


// ===== src/dropzone.js =====
// ========== Drag & drop file intake (standalone) ==========
// Renders an overlay prompting for files when nothing is loaded, and accepts
// drops anywhere in the window to (re)load data. Dependency-free.

let _overlay = null;
let _dragDepth = 0;

