import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  KEY_DATA,
  ATTR_PREFIX,
  DEFAULT_PROFILE_ID,
  idbGet,
  idbPut,
  idbClear,
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

beforeEach(async () => {
  await idbClear();
  _resetProfilesCache();
});

describe('profile initialization & migration', () => {
  it('creates a default profile on a fresh database', async () => {
    expect(await getActiveProfileId()).toBe(DEFAULT_PROFILE_ID);
    expect((await listProfiles()).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
  });

  it('migrates pre-existing global keys into the default profile (idempotent)', async () => {
    await idbPut(KEY_DATA, '{"persons":[]}');           // legacy un-namespaced
    await idbPut(ATTR_PREFIX + 'Team.tsv', 'a@b\tX');
    await idbPut(ATTR_PREFIX + 'Team.tsv::name', 'Team.tsv');
    _resetProfilesCache();

    expect(await ensureProfilesInitialized()).toBe(DEFAULT_PROFILE_ID);
    expect(await idbGet(KEY_DATA)).toBeUndefined();      // legacy key moved away
    expect(await idbGet('p:default:' + KEY_DATA)).toBe('{"persons":[]}');
    expect(await getStoredText(KEY_DATA)).toBe('{"persons":[]}');
    const attrs = await getStoredAttributes();
    expect(attrs.map((a) => a.filename)).toEqual(['Team.tsv']);

    // Re-running must not duplicate or move anything.
    _resetProfilesCache();
    await ensureProfilesInitialized();
    expect((await listProfiles()).length).toBe(1);
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

  it('duplicateProfile copies all namespaced keys', async () => {
    await createProfile('Src');
    await putStored(KEY_DATA, 'D');
    await putStored(ATTR_PREFIX + 'X.csv', 'x');
    await putStored(ATTR_PREFIX + 'X.csv::name', 'X.csv');

    const copy = await duplicateProfile('src', 'Copy');
    await switchProfile(copy);
    expect(await getStoredText(KEY_DATA)).toBe('D');
    expect((await getStoredAttributes()).map((a) => a.filename)).toEqual(['X.csv']);
  });

  it('deleteProfile removes its keys and picks a new active profile', async () => {
    const x = await createProfile('X');
    await putStored(KEY_DATA, 'GONE');

    const newActive = await deleteProfile(x);
    expect(newActive).toBe(DEFAULT_PROFILE_ID);
    expect((await listProfiles()).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
    // The deleted profile's keys are gone.
    expect(await idbGet('p:' + x + ':' + KEY_DATA)).toBeUndefined();
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
