import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDroppedFiles, resetAllData } from '../src/sections/18-files-reset.js';

beforeEach(() => {
  globalThis.storeEntries = vi.fn(async () => ({ stored: [], unknown: [], missing: [], ignored: [], rejected: [] }));
  globalThis.requestPersistence = vi.fn(async () => true);
  globalThis.showTemporaryNotification = vi.fn();
  globalThis.hideDropZone = vi.fn();
  globalThis.setStatus = vi.fn();
  globalThis.idbClear = vi.fn(async () => {});
  globalThis.createProfile = vi.fn(async () => 'new-id');
  globalThis.renameProfile = vi.fn(async () => {});
  globalThis.getActiveProfileId = vi.fn(async () => 'default');
  globalThis.hasStoredData = vi.fn(async () => true); // active profile already has data by default
  globalThis.classifyFile = vi.fn(async (file) => {
    const text = await file.text();
    if (text.includes('nodeTypes')) return { kind: 'registry', filename: file.name, text };
    if (text.includes('DATA_URL')) return { kind: 'env', filename: file.name, text };
    if (text.includes('persons')) return { kind: 'data', filename: file.name, text };
    return { kind: 'unknown', filename: file.name, text };
  });
  vi.stubGlobal('location', { reload: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const summaryOf = (overrides) => ({ stored: [], unknown: [], missing: [], ignored: [], rejected: [], ...overrides });

describe('handleDroppedFiles', () => {
  it('reports unknown files and stops when nothing was stored', async () => {
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ unknown: ['x.bin'] }));
    await handleDroppedFiles([{ path: 'x.bin', file: { name: 'x.bin' } }]);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('x.bin');
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('reports env references that were not part of the import', async () => {
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ missing: ['./data.json'] }));
    await handleDroppedFiles([{ path: 'env.json', file: { name: 'env.json' } }]);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('./data.json');
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('reports files that the authoritative env.json superseded', async () => {
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ ignored: ['data.sem.json'] }));
    await handleDroppedFiles([]);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('data.sem.json');
  });

  it('creates and activates a new profile only for a FULL tenant drop (env + registry, FR-8.9/AK 100)', async () => {
    const env = { name: 'env.hrm.json', text: async () => '{"DATA_URL":"./data.hrm.json"}' };
    const registry = { name: 'registry.json', text: async () => '{"nodeTypes":{}}' };
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({
      stored: [{ kind: 'env', filename: 'env.hrm.json' }, { kind: 'registry', filename: 'registry.json' }],
    }));
    await handleDroppedFiles([
      { path: 'env.hrm.json', file: env },
      { path: 'registry.json', file: registry },
    ]);
    expect(globalThis.createProfile).toHaveBeenCalledTimes(1);
    expect(globalThis.createProfile.mock.calls[0][0]).toBe('hrm');
    expect(globalThis.createProfile.mock.calls[0][1]).toMatchObject({ activate: true });
    expect(globalThis.location.reload).toHaveBeenCalled();
  });

  it('env-only drop on a loaded tenant updates the ACTIVE profile in place (FR-8.9/AK 100)', async () => {
    // hasStoredData stays true (default): the active profile carries a tenant
    const env = { name: 'env.hrm.json', text: async () => '{"DATA_URL":"./data.hrm.json"}' };
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ stored: [{ kind: 'env', filename: 'env.hrm.json' }] }));
    await handleDroppedFiles([{ path: 'env.hrm.json', file: env }]);
    expect(globalThis.createProfile).not.toHaveBeenCalled();
    expect(globalThis.renameProfile).not.toHaveBeenCalled();
    expect(globalThis.location.reload).toHaveBeenCalled();
  });

  it('fills the empty active profile instead of creating a phantom one', async () => {
    globalThis.hasStoredData.mockResolvedValueOnce(false); // active profile is empty
    const env = { name: 'env.hrm.json', text: async () => '{"DATA_URL":"./data.hrm.json"}' };
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ stored: [{ kind: 'env', filename: 'env.hrm.json' }] }));
    await handleDroppedFiles([{ path: 'env.hrm.json', file: env }]);
    expect(globalThis.createProfile).not.toHaveBeenCalled();
    expect(globalThis.renameProfile).toHaveBeenCalledWith('default', 'hrm');
    expect(globalThis.location.reload).toHaveBeenCalled();
  });

  it('rejected legacy drops surface the migration hint and never reload (E25/FR-6.7)', async () => {
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({
      rejected: [{ kind: 'attr', filename: 'Roles.tsv' }, { kind: 'data', filename: 'data.json' }],
    }));
    await handleDroppedFiles([{ path: 'Roles.tsv', file: { name: 'Roles.tsv', text: async () => 'a@b	X' } }]);
    const hint = globalThis.showTemporaryNotification.mock.calls.map(c => c[0]).find(m => m.includes('migrate-legacy'));
    expect(hint).toContain('Roles.tsv');
    expect(hint).toContain('data.json');
    expect(globalThis.createProfile).not.toHaveBeenCalled();
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('restarts via the init path when a snapshot/env/pseudo file is stored', async () => {
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({
      stored: [{ kind: 'snapshot', filename: 's.json' }],
    }));
    await handleDroppedFiles([{ path: 's.json', file: { name: 's.json' } }]);
    expect(globalThis.hideDropZone).toHaveBeenCalled();
    expect(globalThis.setStatus).toHaveBeenCalledWith('Daten gespeichert – lade neu …');
    expect(globalThis.location.reload).toHaveBeenCalled();
  });
});

describe('resetAllData', () => {
  it('clears the local store and reloads', async () => {
    await resetAllData();
    expect(globalThis.idbClear).toHaveBeenCalled();
    expect(globalThis.location.reload).toHaveBeenCalled();
  });

  it('reloads even when clearing fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.idbClear.mockRejectedValueOnce(new Error('idb down'));
    await resetAllData();
    expect(errorSpy).toHaveBeenCalled();
    expect(globalThis.location.reload).toHaveBeenCalled();
  });
});
