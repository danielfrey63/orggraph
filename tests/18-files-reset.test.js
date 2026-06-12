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
