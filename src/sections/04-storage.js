export const DB_NAME = 'orggraph';
// One object store per tenant lives under this single database. The __meta__
// store tracks the profile list + active profile; each profile's data goes into
// its own store named `p:<id>`, so the DevTools tree shows tenants as separate
// nodes instead of one flat, prefix-namespaced key list. The DB version grows on
// demand whenever a profile store is added or removed (ensureStores/dropStores).
export const META_STORE = '__meta__';
export const LEGACY_STORE = 'files';

// Stable logical keys (decoupled from env URLs).
export const KEY_ENV = 'env';
export const KEY_PSEUDO = 'pseudo';
// OrgGraph 2.0 tenant persistence (FR-8.9): serialized tenant store, tenant
// registry, and dropped-but-not-yet-imported snapshots (imported with their
// confirmation dialogs on the next boot, then removed).
export const KEY_STORE = 'og2Store';
export const KEY_STORE_PART_PREFIX = 'og2Store::part:';
export const KEY_REGISTRY = 'og2Registry';
export const SNAPSHOT_PREFIX = 'og2Snapshot::';

let _dbPromise = null;

/** Object-store name holding one profile's data ('p:<id>'). */
function profileStoreName(id) { return 'p:' + id; }

/** Drop our connection when another tab upgrades the schema, so it isn't blocked. */
function attachVersionChange(db) {
  db.onversionchange = () => { try { db.close(); } catch (_) {} _dbPromise = null; };
  return db;
}

function openWithUpgrade(version, upgrade) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = (version == null) ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(attachVersionChange(req.result));
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another connection'));
  });
}

export function openDb() {
  if (!_dbPromise) {
    _dbPromise = openWithUpgrade(undefined, (db) => {
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    });
  }
  return _dbPromise;
}

/**
 * Guarantee the given object stores exist, creating any missing ones in a single
 * version bump. Object stores can only be created during a versionchange, so we
 * close the current connection and reopen at version+1. Returns the connection.
 */
async function ensureStores(names) {
  const db = await openDb();
  const missing = names.filter(n => !db.objectStoreNames.contains(n));
  if (!missing.length) return db;
  const nextVersion = db.version + 1;
  try { db.close(); } catch (_) {}
  _dbPromise = openWithUpgrade(nextVersion, (d) => {
    if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE);
    for (const n of missing) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
  });
  return _dbPromise;
}

async function ensureStore(name) { return ensureStores([name]); }

/** Delete the given object stores (e.g. when a profile is removed). */
async function dropStores(names) {
  const db = await openDb();
  const present = names.filter(n => db.objectStoreNames.contains(n));
  if (!present.length) return db;
  const nextVersion = db.version + 1;
  try { db.close(); } catch (_) {}
  _dbPromise = openWithUpgrade(nextVersion, (d) => {
    for (const n of present) if (d.objectStoreNames.contains(n)) d.deleteObjectStore(n);
  });
  return _dbPromise;
}

export function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run `fn(store)` inside a transaction on a single, existing object store. */
function storeTx(storeName, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Full local reset: drop every profile store, wipe the meta, forget caches.
 *  Stores are removed (not just emptied) so no orphaned empty tenants linger. */
export async function idbClear() {
  try {
    const db = await openDb();
    const profileStores = Array.from(db.objectStoreNames).filter(n => n !== META_STORE);
    if (db.objectStoreNames.contains(META_STORE)) {
      await storeTx(META_STORE, 'readwrite', s => reqAsPromise(s.clear()));
    }
    if (profileStores.length) await dropStores(profileStores);
  } catch (e) {
    console.warn('[storage] clear failed', e);
  }
  _resetProfilesCache();
}

// ---- Profiles (parallel configurations) ----
//
// Each configuration ("tenant") lives in its own object store `p:<id>` inside
// the single 'orggraph' database. A small `__meta__` store keeps one record,
// KEY_PROFILES, with the profile list and the active profile. Logical keys
// (env/data/pseudo/attr:*/attrMatches) are stored raw inside the active
// profile's store — no key namespacing, the store itself is the namespace.
export const KEY_PROFILES = '__profiles__';
export const DEFAULT_PROFILE_ID = 'default';
export const DEFAULT_PROFILE_NAME = 'Standard';

let _activeProfile = null;
let _profilesInit = null;
let _migrated = false;

/** Test hook: forget cached state and drop the DB connection so it reopens fresh. */
export function _resetProfilesCache() {
  _activeProfile = null;
  _profilesInit = null;
  _migrated = false;
  if (_dbPromise) {
    _dbPromise.then(db => { try { db.close(); } catch (_) {} }).catch(() => {});
    _dbPromise = null;
  }
}

/** Read/write the single profiles meta record from the __meta__ store. */
async function metaTx(mode, fn) {
  await ensureStore(META_STORE);
  return storeTx(META_STORE, mode, fn);
}

export async function getProfilesMeta() {
  try {
    const m = await metaTx('readonly', s => reqAsPromise(s.get(KEY_PROFILES)));
    return (m && typeof m === 'object' && Array.isArray(m.list)) ? m : null;
  } catch (e) {
    console.warn('[storage] profiles meta read failed', e);
    return null;
  }
}

async function putProfilesMeta(meta) {
  await metaTx('readwrite', s => reqAsPromise(s.put(meta, KEY_PROFILES)));
  return meta;
}

/** Read all [key, value] pairs of an object store (issued in one transaction). */
async function readAllPairs(storeName) {
  return storeTx(storeName, 'readonly', (s) => {
    const kReq = s.getAllKeys();
    const vReq = s.getAll();
    return Promise.all([reqAsPromise(kReq), reqAsPromise(vReq)])
      .then(([keys, vals]) => keys.map((k, i) => [k, vals[i]]));
  });
}

/**
 * One-time, idempotent migration from the previous single-store layout (object
 * store 'files' holding either raw legacy keys or `p:<id>:<key>` namespaced keys)
 * to one object store per profile. Pre-profiles installs land in 'default'.
 */
async function migrateLegacyStore() {
  if (_migrated) return;
  const db = await openDb();
  if (!db.objectStoreNames.contains(LEGACY_STORE)) { _migrated = true; return; }

  const all = await readAllPairs(LEGACY_STORE);
  let meta = null;
  const buckets = new Map(); // profileId -> [[logicalKey, value], ...]
  const bucket = (pid) => { if (!buckets.has(pid)) buckets.set(pid, []); return buckets.get(pid); };
  for (const [k, v] of all) {
    if (k === KEY_PROFILES) { if (v && Array.isArray(v.list)) meta = v; continue; }
    if (typeof k === 'string' && k.startsWith('p:')) {
      const rest = k.slice(2);
      const i = rest.indexOf(':');
      if (i > 0) { bucket(rest.slice(0, i)).push([rest.slice(i + 1), v]); continue; }
    }
    bucket(DEFAULT_PROFILE_ID).push([k, v]); // un-namespaced legacy key
  }
  if (!meta) {
    meta = { active: DEFAULT_PROFILE_ID,
      list: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: Date.now() }] };
  }

  const storeNames = new Set([META_STORE]);
  for (const p of meta.list) storeNames.add(profileStoreName(p.id));
  for (const pid of buckets.keys()) storeNames.add(profileStoreName(pid));
  await ensureStores([...storeNames]);

  for (const [pid, entries] of buckets) {
    if (!entries.length) continue;
    await storeTx(profileStoreName(pid), 'readwrite', (s) => { for (const [k, v] of entries) s.put(v, k); });
  }
  await putProfilesMeta(meta);
  await dropStores([LEGACY_STORE]);
  _migrated = true;
}

/** Resolve (and lazily create/migrate) the active profile id. Runs once per load. */
export async function ensureProfilesInitialized() {
  if (_activeProfile) return _activeProfile;
  if (!_profilesInit) {
    _profilesInit = (async () => {
      await migrateLegacyStore();
      let meta = await getProfilesMeta();
      if (!meta || !meta.active) {
        await ensureStore(profileStoreName(DEFAULT_PROFILE_ID));
        meta = await putProfilesMeta({
          active: DEFAULT_PROFILE_ID,
          list: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: Date.now() }],
        });
      }
      _activeProfile = meta.active;
      await ensureStore(profileStoreName(_activeProfile));
      // Clean up a leftover empty 'default' from older installs on load.
      if (await pruneEmptyDefault(meta)) await putProfilesMeta(meta);
      return _activeProfile;
    })();
  }
  return _profilesInit;
}

/** Run `fn(store)` against a profile's own object store. Readonly access to a
 *  not-yet-created store yields undefined instead of materializing it. */
async function profileTx(id, mode, fn) {
  const name = profileStoreName(id);
  if (mode === 'readonly') {
    const db = await openDb();
    if (!db.objectStoreNames.contains(name)) return undefined;
  } else {
    await ensureStore(name);
  }
  return storeTx(name, mode, fn);
}

/** Write a logical key into the active profile's store. */
export async function putStored(logicalKey, value) {
  const id = await ensureProfilesInitialized();
  return profileTx(id, 'readwrite', s => reqAsPromise(s.put(value, logicalKey)));
}

/** Delete a logical key from the active profile's store. */
export async function delStored(logicalKey) {
  const id = await ensureProfilesInitialized();
  return profileTx(id, 'readwrite', s => reqAsPromise(s.delete(logicalKey)));
}

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
  await ensureStore(profileStoreName(id)); // materialize the (empty) store right away
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
  await ensureStore(profileStoreName(id));
  return id;
}

export async function renameProfile(id, name) {
  await ensureProfilesInitialized();
  const meta = await getProfilesMeta();
  if (!meta) return;
  const p = meta.list.find(x => x.id === id);
  if (p) { p.name = name; await putProfilesMeta(meta); }
}

async function copyProfileData(srcId, dstId) {
  await ensureStore(profileStoreName(dstId));
  const db = await openDb();
  if (!db.objectStoreNames.contains(profileStoreName(srcId))) return;
  const pairs = await readAllPairs(profileStoreName(srcId));
  if (!pairs.length) return;
  await storeTx(profileStoreName(dstId), 'readwrite', (s) => { for (const [k, v] of pairs) s.put(v, k); });
}

export async function duplicateProfile(id, name) {
  await ensureProfilesInitialized();
  const meta = await getProfilesMeta();
  if (!meta) return null;
  const newId = await uniqueProfileId(slugify(name || (id + '-kopie')), meta);
  await copyProfileData(id, newId);
  meta.list.push({ id: newId, name: name || (id + ' Kopie'), createdAt: Date.now() });
  await pruneEmptyDefault(meta);
  await putProfilesMeta(meta);
  return newId;
}

/** True when the given profile carries a v2 configuration (env or registry). */
async function profileHasData(id) {
  for (const key of [KEY_ENV, KEY_REGISTRY]) {
    const v = await profileTx(id, 'readonly', s => reqAsPromise(s.get(key)));
    if (typeof v === 'string' && v.length > 0) return true;
  }
  return false;
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
  await dropStores([profileStoreName(DEFAULT_PROFILE_ID)]);
  meta.list = meta.list.filter(p => p.id !== DEFAULT_PROFILE_ID);
  return true;
}

export async function deleteProfile(id) {
  await ensureProfilesInitialized();
  const meta = await getProfilesMeta();
  if (!meta) return null;
  await dropStores([profileStoreName(id)]);
  meta.list = meta.list.filter(p => p.id !== id);
  if (!meta.list.length) {
    meta.list.push({ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: Date.now() });
  }
  if (!meta.list.some(p => p.id === meta.active)) meta.active = await pickActiveProfile(meta.list);
  await putProfilesMeta(meta);
  _activeProfile = meta.active;
  await ensureStore(profileStoreName(meta.active));
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

/** OrgGraph 2.0 snapshot (§3): meta.source/snapshot + schema + nodes/edges. */
export function looksLikeSnapshot(obj) {
  return !!(obj && obj.meta && typeof obj.meta.source === 'string' && typeof obj.meta.snapshot === 'string'
    && obj.schema && Array.isArray(obj.nodes) && Array.isArray(obj.edges));
}

/** OrgGraph 2.0 type registry (FR-4.1): version + nodeTypes/edgeTypes. */
export function looksLikeRegistry(obj) {
  return !!(obj && typeof obj.version === 'string' && obj.nodeTypes && obj.edgeTypes
    && !obj.meta && !Array.isArray(obj.nodes));
}

export const ATTR_EXT = /\.(tsv|txt|csv)$/i;

/**
 * Classify a single dropped/picked file into a logical kind.
 * Returns { kind: 'env'|'pseudo'|'data'|'attr'|'unknown', key, filename, text }.
 */
export async function classifyFile(file) {
  const filename = file.name || 'unnamed';
  const text = await file.text();

  // Legacy attribute lists are recognized only to reject them with a
  // migration hint (E25/FR-6.7) — they are never stored in a v2 tenant.
  if (ATTR_EXT.test(filename)) {
    return { kind: 'attr', key: null, filename, text };
  }

  // JSON-ish: classify by content.
  let obj = null;
  try { obj = JSON.parse(text); } catch { /* not JSON */ }

  if (looksLikeEnv(obj)) return { kind: 'env', key: KEY_ENV, filename, text };
  if (looksLikePseudo(obj)) return { kind: 'pseudo', key: KEY_PSEUDO, filename, text };
  // OrgGraph 2.0 artifacts first — a snapshot/registry never matches the
  // legacy shape, but keep the order explicit (FR-6.7, E25).
  if (looksLikeSnapshot(obj)) return { kind: 'snapshot', key: SNAPSHOT_PREFIX + filename, filename, text };
  if (looksLikeRegistry(obj)) return { kind: 'registry', key: KEY_REGISTRY, filename, text };
  if (looksLikeData(obj)) return { kind: 'data', key: null, filename, text };

  return { kind: 'unknown', key: null, filename, text };
}

/** Dropped snapshots awaiting import: [{ key, filename, text }]. */
export async function getPendingSnapshots() {
  const id = await ensureProfilesInitialized();
  const db = await openDb();
  if (!db.objectStoreNames.contains(profileStoreName(id))) return [];
  const pairs = await readAllPairs(profileStoreName(id));
  const out = [];
  for (const [k, text] of pairs) {
    if (typeof k !== 'string' || !k.startsWith(SNAPSHOT_PREFIX)) continue;
    if (typeof text !== 'string') continue;
    out.push({ key: k, filename: k.slice(SNAPSHOT_PREFIX.length), text });
  }
  return out.sort((a, b) => a.filename.localeCompare(b.filename));
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
  const rejected = [];

  const classified = [];
  for (const raw of Array.from(entryList || [])) {
    const file = raw && raw.file ? raw.file : raw;
    if (!file || typeof file.text !== 'function') continue;
    const path = (raw && raw.path) || file.name || 'unnamed';
    classified.push({ path, ...(await classifyFile(file)) });
  }

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

    // DATA_URL references point at snapshots in a v2 tenant (FR-8.10);
    // a referenced legacy dataset is rejected with the migration hint.
    const dataRefs = cfg.DATA_URL
      ? (Array.isArray(cfg.DATA_URL) ? cfg.DATA_URL : [cfg.DATA_URL])
      : [];
    for (const ref of dataRefs) {
      const hit = findEntryByRef(classified, env.path, ref);
      if (!hit) { missing.push(String(ref)); continue; }
      used.add(hit);
      if (hit.kind === 'snapshot') {
        await putStored(hit.key, hit.text);
        stored.push({ kind: 'snapshot', filename: hit.filename });
      } else {
        rejected.push({ kind: hit.kind, filename: hit.filename });
      }
    }
  }

  for (const c of classified) {
    if (used.has(c)) continue;
    if (c.kind === 'unknown') { unknown.push(c.filename); continue; }
    // Legacy classes are rejected, never persisted (E25/FR-6.7).
    if (c.kind === 'data' || c.kind === 'attr') { rejected.push({ kind: c.kind, filename: c.filename }); continue; }
    if (env && c.kind === 'env') { ignored.push(c.filename); continue; }
    await putStored(c.key, c.text);
    stored.push({ kind: c.kind, filename: c.filename });
  }

  return { stored, unknown, missing, ignored, rejected };
}

/**
 * Persist a list of files (from a drop or multi-file picker). Returns a summary
 * { stored: [{kind, filename}], unknown: [filename], missing, ignored }.
 */
export async function storeFiles(fileList) {
  return storeEntries(Array.from(fileList || []));
}

export async function getStoredText(key) {
  const id = await ensureProfilesInitialized();
  const v = await profileTx(id, 'readonly', s => reqAsPromise(s.get(key)));
  return typeof v === 'string' ? v : undefined;
}

export async function getStoredJson(key) {
  const t = await getStoredText(key);
  if (t == null) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

/** True when the given profile already carries a v2 configuration. */
export async function hasStoredData() {
  return (await getStoredText(KEY_ENV)) != null || (await getStoredText(KEY_REGISTRY)) != null;
}


// ===== src/dropzone.js =====
// ========== Drag & drop file intake (standalone) ==========
// Renders an overlay prompting for files when nothing is loaded, and accepts
// drops anywhere in the window to (re)load data. Dependency-free.

let _overlay = null;
let _dragDepth = 0;
