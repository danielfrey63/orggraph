import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleDroppedFiles, resetAllData } from '../src/sections/18-files-reset.js';

beforeEach(() => {
  globalThis.storeFiles = vi.fn(async () => ({ stored: [], unknown: [] }));
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

describe('handleDroppedFiles', () => {
  it('reports unknown files and stops when nothing was stored', async () => {
    globalThis.storeFiles.mockResolvedValueOnce({ stored: [], unknown: ['x.bin'] });
    await handleDroppedFiles([{ name: 'x.bin' }]);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('x.bin');
    expect(globalThis.location.reload).not.toHaveBeenCalled();
    expect(globalThis.loadAttributesFromFile).not.toHaveBeenCalled();
  });

  it('reloads attribute-only drops live without restarting', async () => {
    const files = [{ name: 'Team.tsv' }, { name: 'Rolle.tsv' }];
    globalThis.storeFiles.mockResolvedValueOnce({
      stored: [{ kind: 'attr', filename: 'Team.tsv' }, { kind: 'attr', filename: 'Rolle.tsv' }],
      unknown: [],
    });
    await handleDroppedFiles(files);
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledTimes(2);
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledWith(files[0]);
    expect(globalThis.location.reload).not.toHaveBeenCalled();
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('2 Attribut-Datei(en)');
  });

  it('survives a failing attribute reload and continues with the rest', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const files = [{ name: 'A.tsv' }, { name: 'B.tsv' }];
    globalThis.storeFiles.mockResolvedValueOnce({
      stored: [{ kind: 'attr', filename: 'A.tsv' }, { kind: 'attr', filename: 'B.tsv' }],
      unknown: [],
    });
    globalThis.loadAttributesFromFile.mockRejectedValueOnce(new Error('boom'));
    await handleDroppedFiles(files);
    expect(globalThis.loadAttributesFromFile).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('restarts via the init path when a dataset/env/pseudo file is stored', async () => {
    globalThis.storeFiles.mockResolvedValueOnce({
      stored: [{ kind: 'data', filename: 'd.json' }, { kind: 'attr', filename: 'T.tsv' }],
      unknown: [],
    });
    await handleDroppedFiles([{ name: 'd.json' }, { name: 'T.tsv' }]);
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
