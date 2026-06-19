import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDroppedFiles, resetAllData } from '../src/sections/18-files-reset.js';

beforeEach(() => {
  globalThis.storeEntries = vi.fn(async () => ({ stored: [], unknown: [], missing: [], ignored: [] }));
  globalThis.requestPersistence = vi.fn(async () => true);
  globalThis.showTemporaryNotification = vi.fn();
  globalThis.loadAttributesFromFile = vi.fn(async () => true);
  globalThis.hideDropZone = vi.fn();
  globalThis.setStatus = vi.fn();
  globalThis.idbClear = vi.fn(async () => {});
  globalThis.createProfile = vi.fn(async () => 'new-id');
  globalThis.renameProfile = vi.fn(async () => {});
  globalThis.getActiveProfileId = vi.fn(async () => 'default');
  globalThis.hasStoredData = vi.fn(async () => true); // active profile already has data by default
  globalThis.classifyFile = vi.fn(async (file) => {
    const text = await file.text();
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

const summaryOf = (overrides) => ({ stored: [], unknown: [], missing: [], ignored: [], ...overrides });

describe('handleDroppedFiles', () => {
  it('reports unknown files and stops when nothing was stored', async () => {
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ unknown: ['x.bin'] }));
    await handleDroppedFiles([{ path: 'x.bin', file: { name: 'x.bin' } }]);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('x.bin');
    expect(globalThis.location.reload).not.toHaveBeenCalled();
    expect(globalThis.loadAttributesFromFile).not.toHaveBeenCalled();
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

  it('creates and activates a new profile for a configuration drop (name from DATA_URL)', async () => {
    const env = { name: 'env.hrm.json', text: async () => '{"DATA_URL":"./data.hrm.json"}' };
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ stored: [{ kind: 'env', filename: 'env.hrm.json' }] }));
    await handleDroppedFiles([{ path: 'env.hrm.json', file: env }]);
    expect(globalThis.createProfile).toHaveBeenCalledTimes(1);
    expect(globalThis.createProfile.mock.calls[0][0]).toBe('hrm');
    expect(globalThis.createProfile.mock.calls[0][1]).toMatchObject({ activate: true });
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

  it('does not create a profile for an attribute-only drop', async () => {
    const tsv = { name: 'Roles.tsv', text: async () => 'a@b\tX' };
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({ stored: [{ kind: 'attr', filename: 'Roles.tsv' }] }));
    await handleDroppedFiles([{ path: 'Roles.tsv', file: tsv }]);
    expect(globalThis.createProfile).not.toHaveBeenCalled();
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('reloads attribute-only drops live without restarting', async () => {
    const teamFile = { name: 'Team.tsv' };
    const entries = [{ path: 'Team.tsv', file: teamFile }, { path: 'Rolle.tsv', file: { name: 'Rolle.tsv' } }];
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({
      stored: [{ kind: 'attr', filename: 'Team.tsv' }, { kind: 'attr', filename: 'Rolle.tsv' }],
    }));
    await handleDroppedFiles(entries);
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledTimes(2);
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledWith(teamFile);
    expect(globalThis.location.reload).not.toHaveBeenCalled();
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('2 Attribut-Datei(en)');
  });

  it('accepts plain File lists for attribute-only drops (picker compatibility)', async () => {
    const files = [{ name: 'A.tsv' }];
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({
      stored: [{ kind: 'attr', filename: 'A.tsv' }],
    }));
    await handleDroppedFiles(files);
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledWith(files[0]);
  });

  it('survives a failing attribute reload and continues with the rest', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entries = [{ path: 'A.tsv', file: { name: 'A.tsv' } }, { path: 'B.tsv', file: { name: 'B.tsv' } }];
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({
      stored: [{ kind: 'attr', filename: 'A.tsv' }, { kind: 'attr', filename: 'B.tsv' }],
    }));
    globalThis.loadAttributesFromFile.mockRejectedValueOnce(new Error('boom'));
    await handleDroppedFiles(entries);
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('restarts via the init path when a dataset/env/pseudo file is stored', async () => {
    globalThis.storeEntries.mockResolvedValueOnce(summaryOf({
      stored: [{ kind: 'data', filename: 'd.json' }, { kind: 'attr', filename: 'T.tsv' }],
    }));
    await handleDroppedFiles([{ path: 'd.json', file: { name: 'd.json' } }, { path: 'T.tsv', file: { name: 'T.tsv' } }]);
    expect(globalThis.hideDropZone).toHaveBeenCalled();
    expect(globalThis.setStatus).toHaveBeenCalledWith('Daten gespeichert – lade neu …');
    expect(globalThis.location.reload).toHaveBeenCalled();
    expect(globalThis.loadAttributesFromFile).not.toHaveBeenCalled();
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
