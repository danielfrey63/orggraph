import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  KEY_ENV,
  KEY_PROFILES,
  DEFAULT_PROFILE_ID,
  openDb,
  putStored,
  getStoredText,
  getProfilesMeta,
  listProfiles,
  getActiveProfileId,
  ensureProfilesInitialized,
  createProfile,
  switchProfile,
  renameProfile,
  duplicateProfile,
  deleteProfile,
  _resetProfilesCache,
} from '../src/sections/04-storage.js';

// A profile "has data" when it carries a v2 configuration (env or registry);
// legacy 'data'/'attr:' keys survive migration as opaque entries only.
const ENV_TEXT = '{"DATA_URL":"./snap.json"}';

/** Wipe the whole database so each test starts from a clean slate. */
function deleteDb() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('orggraph');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Recreate the obsolete single-store ('files') layout to exercise migration. */
function seedLegacyFilesStore(entries) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('orggraph', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      for (const [k, v] of entries) store.put(v, k);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  _resetProfilesCache();
  await deleteDb();
  _resetProfilesCache();
});

describe('profile initialization & migration', () => {
  it('creates a default profile on a fresh database', async () => {
    expect(await getActiveProfileId()).toBe(DEFAULT_PROFILE_ID);
    expect((await listProfiles()).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
  });

  it('migrates the legacy single-store layout into per-profile stores (idempotent)', async () => {
    await seedLegacyFilesStore([
      ['data', '{"persons":[]}'],                   // un-namespaced legacy keys
      ['attr:Team.tsv', 'a@b\tX'],
      ['attr:Team.tsv::name', 'Team.tsv'],
    ]);
    _resetProfilesCache();

    expect(await ensureProfilesInitialized()).toBe(DEFAULT_PROFILE_ID);
    // legacy entries survive as opaque keys inside the migrated profile store
    expect(await getStoredText('data')).toBe('{"persons":[]}');
    expect(await getStoredText('attr:Team.tsv')).toBe('a@b\tX');

    // The obsolete single store is gone; the profile got its own store.
    const db = await openDb();
    expect(Array.from(db.objectStoreNames)).not.toContain('files');
    expect(Array.from(db.objectStoreNames)).toContain('p:default');

    // Re-running must not duplicate or move anything.
    _resetProfilesCache();
    await ensureProfilesInitialized();
    expect((await listProfiles()).length).toBe(1);
    expect(await getStoredText('data')).toBe('{"persons":[]}');
  });

  it('migrates the prefixed multi-profile layout into per-profile stores', async () => {
    await seedLegacyFilesStore([
      [KEY_PROFILES, { active: 'hrm', list: [
        { id: 'default', name: 'Standard' },
        { id: 'hrm', name: 'HRM' },
      ] }],
      ['p:default:env', 'DEF'],
      ['p:hrm:env', 'HRM-ENV'],
    ]);
    _resetProfilesCache();

    expect(await ensureProfilesInitialized()).toBe('hrm');
    expect((await listProfiles()).map((p) => p.id).sort()).toEqual(['default', 'hrm']);
    expect(await getStoredText(KEY_ENV)).toBe('HRM-ENV');   // active = hrm
    await switchProfile('default');
    expect(await getStoredText(KEY_ENV)).toBe('DEF');

    const db = await openDb();
    expect(Array.from(db.objectStoreNames)).not.toContain('files');
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['__meta__', 'p:default', 'p:hrm']);
  });
});

describe('profile CRUD & isolation', () => {
  it('keeps data of parallel profiles isolated', async () => {
    const alpha = await createProfile('Alpha');         // created and activated
    await putStored(KEY_ENV, 'ALPHA');
    const beta = await createProfile('Beta');
    await putStored(KEY_ENV, 'BETA');

    await switchProfile(alpha);
    expect(await getStoredText(KEY_ENV)).toBe('ALPHA');
    await switchProfile(beta);
    expect(await getStoredText(KEY_ENV)).toBe('BETA');
  });

  it('prunes the empty default profile as soon as another profile exists', async () => {
    const hrm = await createProfile('HRM');             // default is empty + not active → pruned
    expect((await listProfiles()).map((p) => p.id)).toEqual([hrm]);
    expect(await getActiveProfileId()).toBe(hrm);
  });

  it('keeps the default profile when it still holds a configuration', async () => {
    await putStored(KEY_ENV, ENV_TEXT);                 // default (active) has a config
    await createProfile('HRM');                         // → not pruned
    expect((await listProfiles()).map((p) => p.id).sort()).toEqual(['default', 'hrm']);
  });

  it('assigns unique ids on name collision', async () => {
    expect(await createProfile('Team')).toBe('team');
    expect(await createProfile('Team')).toBe('team-2');
  });

  it('renameProfile updates the stored name', async () => {
    const id = await createProfile('Old');
    await renameProfile(id, 'New');
    const meta = await getProfilesMeta();
    expect(meta.list.find((p) => p.id === id).name).toBe('New');
  });

  it('duplicateProfile copies the whole profile store', async () => {
    await createProfile('Src');
    await putStored(KEY_ENV, ENV_TEXT);
    await putStored('og2Snapshot::s.json', '{"meta":{}}');

    const copy = await duplicateProfile('src', 'Copy');
    await switchProfile(copy);
    expect(await getStoredText(KEY_ENV)).toBe(ENV_TEXT);
    expect(await getStoredText('og2Snapshot::s.json')).toBe('{"meta":{}}');
  });

  it('deleteProfile removes its store and picks a new active profile', async () => {
    const x = await createProfile('X');
    await putStored(KEY_ENV, 'GONE');

    const newActive = await deleteProfile(x);
    expect(newActive).toBe(DEFAULT_PROFILE_ID);
    expect((await listProfiles()).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
    // The deleted profile's store is gone.
    const db = await openDb();
    expect(Array.from(db.objectStoreNames)).not.toContain('p:' + x);
  });

  it('deleting the active profile lands on a remaining profile that has a configuration', async () => {
    await createProfile('WithData');           // default pruned → list=[withdata], active=withdata
    await putStored(KEY_ENV, ENV_TEXT);
    await createProfile('Empty');              // list=[withdata, empty], active=empty (no config)

    const newActive = await deleteProfile('empty');
    expect(newActive).toBe('withdata');        // lands on the config-bearing profile
  });

  it('deleting the last profile recreates an empty default', async () => {
    const after = await deleteProfile(DEFAULT_PROFILE_ID);
    expect(after).toBe(DEFAULT_PROFILE_ID);
    expect((await listProfiles()).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
  });

  it('switchProfile rejects an unknown id', async () => {
    await expect(switchProfile('does-not-exist')).rejects.toThrow();
  });
});
