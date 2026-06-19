import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  KEY_DATA,
  KEY_PROFILES,
  ATTR_PREFIX,
  DEFAULT_PROFILE_ID,
  openDb,
  putStored,
  getStoredText,
  getStoredAttributes,
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
      [KEY_DATA, '{"persons":[]}'],                 // un-namespaced legacy keys
      [ATTR_PREFIX + 'Team.tsv', 'a@b\tX'],
      [ATTR_PREFIX + 'Team.tsv::name', 'Team.tsv'],
    ]);
    _resetProfilesCache();

    expect(await ensureProfilesInitialized()).toBe(DEFAULT_PROFILE_ID);
    expect(await getStoredText(KEY_DATA)).toBe('{"persons":[]}');
    const attrs = await getStoredAttributes();
    expect(attrs.map((a) => a.filename)).toEqual(['Team.tsv']);

    // The obsolete single store is gone; the profile got its own store.
    const db = await openDb();
    expect(Array.from(db.objectStoreNames)).not.toContain('files');
    expect(Array.from(db.objectStoreNames)).toContain('p:default');

    // Re-running must not duplicate or move anything.
    _resetProfilesCache();
    await ensureProfilesInitialized();
    expect((await listProfiles()).length).toBe(1);
    expect(await getStoredText(KEY_DATA)).toBe('{"persons":[]}');
  });

  it('migrates the prefixed multi-profile layout into per-profile stores', async () => {
    await seedLegacyFilesStore([
      [KEY_PROFILES, { active: 'hrm', list: [
        { id: 'default', name: 'Standard' },
        { id: 'hrm', name: 'HRM' },
      ] }],
      ['p:default:' + KEY_DATA, 'DEF'],
      ['p:hrm:' + KEY_DATA, 'HRM-DATA'],
    ]);
    _resetProfilesCache();

    expect(await ensureProfilesInitialized()).toBe('hrm');
    expect((await listProfiles()).map((p) => p.id).sort()).toEqual(['default', 'hrm']);
    expect(await getStoredText(KEY_DATA)).toBe('HRM-DATA');   // active = hrm
    await switchProfile('default');
    expect(await getStoredText(KEY_DATA)).toBe('DEF');

    const db = await openDb();
    expect(Array.from(db.objectStoreNames)).not.toContain('files');
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['__meta__', 'p:default', 'p:hrm']);
  });
});

describe('profile CRUD & isolation', () => {
  it('keeps data of parallel profiles isolated', async () => {
    const alpha = await createProfile('Alpha');         // created and activated
    await putStored(KEY_DATA, 'ALPHA');
    const beta = await createProfile('Beta');           // active alpha has data → parallel profile
    await putStored(KEY_DATA, 'BETA');

    await switchProfile(alpha);
    expect(await getStoredText(KEY_DATA)).toBe('ALPHA');
    await switchProfile(beta);
    expect(await getStoredText(KEY_DATA)).toBe('BETA');
  });

  it('prunes the empty default profile as soon as another profile exists', async () => {
    const hrm = await createProfile('HRM');             // default is empty + not active → pruned
    expect((await listProfiles()).map((p) => p.id)).toEqual([hrm]);
    expect(await getActiveProfileId()).toBe(hrm);
  });

  it('keeps the default profile when it still holds data', async () => {
    await putStored(KEY_DATA, '{"persons":[]}');        // default (active) has data
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
    await putStored(KEY_DATA, 'D');
    await putStored(ATTR_PREFIX + 'X.csv', 'x');
    await putStored(ATTR_PREFIX + 'X.csv::name', 'X.csv');

    const copy = await duplicateProfile('src', 'Copy');
    await switchProfile(copy);
    expect(await getStoredText(KEY_DATA)).toBe('D');
    expect((await getStoredAttributes()).map((a) => a.filename)).toEqual(['X.csv']);
  });

  it('deleteProfile removes its store and picks a new active profile', async () => {
    const x = await createProfile('X');
    await putStored(KEY_DATA, 'GONE');

    const newActive = await deleteProfile(x);
    expect(newActive).toBe(DEFAULT_PROFILE_ID);
    expect((await listProfiles()).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
    // The deleted profile's store is gone.
    const db = await openDb();
    expect(Array.from(db.objectStoreNames)).not.toContain('p:' + x);
  });

  it('deleting the active profile lands on a remaining profile that has data', async () => {
    await createProfile('WithData');           // default pruned → list=[withdata], active=withdata
    await putStored(KEY_DATA, '{"persons":[]}');
    await createProfile('Empty');              // list=[withdata, empty], active=empty (no data)

    const newActive = await deleteProfile('empty');
    expect(newActive).toBe('withdata');        // lands on the data-bearing profile
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
