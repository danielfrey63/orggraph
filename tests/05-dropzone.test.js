import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  isZipName,
  inflateRaw,
  readZipEntries,
  expandZipEntries,
  collectDropPayload,
  ensureOverlay,
  showDropZone,
  hideDropZone,
  installGlobalDrop,
  Logger,
} from '../src/sections/05-dropzone.js';

// ---- minimal ZIP builder for tests (local headers + central dir + EOCD) ----
const buildZip = (files) => {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };

  for (const f of files) {
    const name = enc.encode(f.path);
    const data = f.method === 8 ? new Uint8Array(deflateRawSync(Buffer.from(f.content || ''))) : enc.encode(f.content || '');
    const usize = enc.encode(f.content || '').length;
    const local = [u32(0x04034b50), u16(20), u16(f.flags || 0), u16(f.method || 0), u32(0), u32(0), u32(data.length), u32(usize), u16(name.length), u16(0), name, data];
    central.push({ f, name, csize: data.length, usize, localOff: offset });
    for (const c of local) { chunks.push(c); offset += c.length; }
  }

  const cdOff = offset;
  for (const c of central) {
    const rec = [u32(0x02014b50), u16(20), u16(20), u16(c.f.flags || 0), u16(c.f.method || 0), u32(0), u32(0), u32(c.csize), u32(c.usize), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.localOff), c.name];
    for (const r of rec) { chunks.push(r); offset += r.length; }
  }
  const eocd = [u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(offset - cdOff), u32(cdOff), u16(0)];
  for (const r of eocd) chunks.push(r);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
};

const zipFileOf = (bytes, name = 'archive.zip') => ({ name, arrayBuffer: async () => bytes.buffer });

const fireDrag = (type, dataTransfer) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = dataTransfer;
  window.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  globalThis._overlay = null;
  globalThis._dragDepth = 0;
  globalThis.debugMode = false;
  globalThis.showTemporaryNotification = vi.fn();
});

describe('ensureOverlay / showDropZone / hideDropZone', () => {
  it('creates the overlay once and reuses it (singleton)', () => {
    const a = ensureOverlay(() => {});
    const b = ensureOverlay(() => {});
    expect(a).toBe(b);
    expect(document.querySelectorAll('.dz-overlay')).toHaveLength(1);
    expect(a.querySelector('.dz-title').textContent).toBe('Daten hierher ziehen');
  });

  it('toggles visibility via the dz-visible class', () => {
    showDropZone(() => {});
    expect(document.querySelector('.dz-overlay').classList.contains('dz-visible')).toBe(true);
    hideDropZone();
    expect(document.querySelector('.dz-overlay').classList.contains('dz-visible')).toBe(false);
  });

  it('opens a multi-file picker and forwards chosen files as entries', async () => {
    const onFiles = vi.fn();
    ensureOverlay(onFiles);
    document.querySelector('.dz-pick').click();
    const picker = document.querySelector('input[type="file"]');
    expect(picker.multiple).toBe(true);
    expect(picker.accept).toContain('.json');
    expect(picker.accept).toContain('.zip');
    const file = { name: 'x.json' };
    Object.defineProperty(picker, 'files', { value: { length: 1, 0: file } });
    picker.dispatchEvent(new Event('change'));
    expect(document.querySelector('input[type="file"]')).toBeNull(); // removed after use
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([{ path: 'x.json', file }]));
  });
});

describe('isZipName', () => {
  it('matches .zip case-insensitively and rejects the rest', () => {
    expect(isZipName('a.zip')).toBe(true);
    expect(isZipName('A.ZIP')).toBe(true);
    expect(isZipName('a.json')).toBe(false);
    expect(isZipName('')).toBe(false);
    expect(isZipName(null)).toBe(false);
  });
});

describe('readZipEntries', () => {
  it('reads stored (uncompressed) entries with their archive paths', async () => {
    const bytes = buildZip([
      { path: 'pkg/env.json', content: '{"DATA_URL":"./data.json"}' },
      { path: 'pkg/data.json', content: '{"persons":[]}' },
    ]);
    const entries = await readZipEntries(zipFileOf(bytes));
    expect(entries.map((e) => e.path)).toEqual(['pkg/env.json', 'pkg/data.json']);
    expect(entries[0].file.name).toBe('env.json');
    expect(await entries[0].file.text()).toBe('{"DATA_URL":"./data.json"}');
    expect(new Uint8Array(await entries[1].file.arrayBuffer()).length).toBe(14);
  });

  it('inflates deflate-compressed entries', async () => {
    const content = JSON.stringify({ persons: [{ id: 'p-1', label: 'Compressed' }] });
    const bytes = buildZip([{ path: 'data.json', content, method: 8 }]);
    const entries = await readZipEntries(zipFileOf(bytes));
    expect(await entries[0].file.text()).toBe(content);
  });

  it('skips directory entries', async () => {
    const bytes = buildZip([
      { path: 'pkg/', content: '' },
      { path: 'pkg/a.txt', content: 'x@y\tZ' },
    ]);
    const entries = await readZipEntries(zipFileOf(bytes));
    expect(entries.map((e) => e.path)).toEqual(['pkg/a.txt']);
  });

  it('rejects archives without an end-of-central-directory record', async () => {
    await expect(readZipEntries(zipFileOf(new Uint8Array([1, 2, 3])))).rejects.toThrow('Kein gültiges ZIP-Archiv');
  });

  it('rejects encrypted and unsupported-compression entries', async () => {
    const encrypted = buildZip([{ path: 'secret.json', content: '{}', flags: 1 }]);
    await expect(readZipEntries(zipFileOf(encrypted))).rejects.toThrow('Verschlüsselte');
    const lzma = buildZip([{ path: 'weird.json', content: '{}', method: 14 }]);
    await expect(readZipEntries(zipFileOf(lzma))).rejects.toThrow('Nicht unterstützte ZIP-Kompression');
  });
});

describe('inflateRaw', () => {
  it('round-trips deflate-raw bytes', async () => {
    const original = 'orggraph '.repeat(50);
    const inflated = await inflateRaw(new Uint8Array(deflateRawSync(Buffer.from(original))));
    expect(new TextDecoder().decode(inflated)).toBe(original);
  });
});

describe('expandZipEntries', () => {
  it('unpacks zip entries inline and passes other entries through', async () => {
    const bytes = buildZip([{ path: 'inner/env.json', content: '{"DATA_URL":"./d.json"}' }]);
    const plain = { path: 'a.json', file: { name: 'a.json' } };
    const out = await expandZipEntries([plain, { path: 'pack.zip', file: zipFileOf(bytes, 'pack.zip') }]);
    expect(out.map((e) => e.path)).toEqual(['a.json', 'inner/env.json']);
    expect(out[0]).toBe(plain);
  });

  it('reports unreadable archives and keeps the rest of the drop', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await expandZipEntries([
      { path: 'broken.zip', file: zipFileOf(new Uint8Array([0, 0]), 'broken.zip') },
      { path: 'ok.json', file: { name: 'ok.json' } },
    ]);
    expect(out.map((e) => e.path)).toEqual(['ok.json']);
    expect(errorSpy).toHaveBeenCalled();
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('broken.zip');
    errorSpy.mockRestore();
  });
});

describe('collectDropPayload', () => {
  const fsFile = (name) => ({ isFile: true, name, file: (ok) => ok({ name }) });
  const fsDir = (name, children) => ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      // deliver children in two batches to exercise the readEntries loop
      const batches = [children.slice(0, 1), children.slice(1), []];
      return { readEntries: (ok) => ok(batches.shift() || []) };
    },
  });

  it('walks dropped directories recursively into flat path entries', async () => {
    const root = fsDir('pkg', [
      fsFile('env.json'),
      fsDir('attrs', [fsFile('Team.tsv')]),
      fsFile('data.json'),
    ]);
    const entries = await collectDropPayload({ items: [{ webkitGetAsEntry: () => root }] });
    expect(entries.map((e) => e.path).sort()).toEqual(['pkg/attrs/Team.tsv', 'pkg/data.json', 'pkg/env.json']);
    expect(entries.every((e) => e.file.name)).toBe(true);
  });

  it('falls back to getAsFile for items without filesystem entries', async () => {
    const file = { name: 'x.json' };
    const entries = await collectDropPayload({
      items: [{ webkitGetAsEntry: () => null, getAsFile: () => file }],
    });
    expect(entries).toEqual([{ path: 'x.json', file }]);
  });

  it('uses dataTransfer.files when items are unavailable', async () => {
    const file = { name: 'plain.json' };
    const entries = await collectDropPayload({ files: { length: 1, 0: file } });
    expect(entries).toEqual([{ path: 'plain.json', file }]);
  });

  it('returns an empty list for an empty or missing payload', async () => {
    expect(await collectDropPayload(null)).toEqual([]);
    expect(await collectDropPayload({ files: { length: 0 } })).toEqual([]);
  });

  // ---- file:// regression: Chromium's entry API fails there with EncodingError ----

  const handleFile = (name) => ({ kind: 'file', name, getFile: async () => ({ name }) });
  const handleDir = (name, children) => ({
    kind: 'directory',
    name,
    values: () => (async function* () { for (const c of children) yield c; })(),
  });
  const brokenDirEntry = (name) => ({
    isDirectory: true,
    name,
    createReader: () => ({ readEntries: (_ok, err) => err(new Error('EncodingError')) }),
  });

  it('prefers the File System Access API over the (file://-broken) entry API', async () => {
    const root = handleDir('pkg', [handleFile('env.json'), handleDir('attrs', [handleFile('T.tsv')])]);
    const entries = await collectDropPayload({
      items: [{ getAsFileSystemHandle: async () => root, webkitGetAsEntry: () => brokenDirEntry('pkg') }],
    });
    expect(entries.map((e) => e.path).sort()).toEqual(['pkg/attrs/T.tsv', 'pkg/env.json']);
  });

  it('uses getAsFile for file entries instead of entry.file()', async () => {
    const file = { name: 'data.json' };
    const entry = { isFile: true, name: 'data.json', file: (_ok, err) => err(new Error('EncodingError')) };
    const entries = await collectDropPayload({
      items: [{ webkitGetAsEntry: () => entry, getAsFile: () => file }],
    });
    expect(entries).toEqual([{ path: 'data.json', file }]);
  });

  it('falls back to the entry API when the handle promise rejects or traversal fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = fsDir('pkg', [fsFile('env.json')]);
    const rejected = await collectDropPayload({
      items: [{ getAsFileSystemHandle: () => Promise.reject(new Error('nope')), webkitGetAsEntry: () => root }],
    });
    expect(rejected.map((e) => e.path)).toEqual(['pkg/env.json']);

    const failingHandle = handleDir('pkg', [{ kind: 'file', name: 'x.json', getFile: async () => { throw new Error('io'); } }]);
    const root2 = fsDir('pkg', [fsFile('env.json')]);
    const walked = await collectDropPayload({
      items: [{ getAsFileSystemHandle: async () => failingHandle, webkitGetAsEntry: () => root2 }],
    });
    expect(walked.map((e) => e.path)).toEqual(['pkg/env.json']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reports unreadable folders with a ZIP hint and keeps the rest of the drop', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = { name: 'ok.json' };
    const entries = await collectDropPayload({
      items: [
        { webkitGetAsEntry: () => brokenDirEntry('pkg') },
        { webkitGetAsEntry: () => null, getAsFile: () => file },
      ],
    });
    expect(entries).toEqual([{ path: 'ok.json', file }]);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('ZIP');
    warnSpy.mockRestore();
  });
});

describe('installGlobalDrop', () => {
  it('marks the body while dragging files and unmarks on leave', () => {
    installGlobalDrop(() => {});
    fireDrag('dragenter', { types: ['Files'] });
    expect(document.body.classList.contains('dz-dragging')).toBe(true);
    fireDrag('dragleave', {});
    expect(document.body.classList.contains('dz-dragging')).toBe(false);
  });

  it('ignores drags that carry no files', () => {
    installGlobalDrop(() => {});
    fireDrag('dragenter', { types: ['text/plain'] });
    expect(document.body.classList.contains('dz-dragging')).toBe(false);
    const over = fireDrag('dragover', { types: ['text/plain'] });
    expect(over.defaultPrevented).toBe(false);
  });

  it('sets the copy drop effect during dragover with files', () => {
    installGlobalDrop(() => {});
    const dt = { types: ['Files'], dropEffect: '' };
    const e = fireDrag('dragover', dt);
    expect(e.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('copy');
  });

  it('delivers dropped files as entries and resets the drag state', async () => {
    const onFiles = vi.fn();
    installGlobalDrop(onFiles);
    fireDrag('dragenter', { types: ['Files'] });
    const a = { name: 'a.json' };
    const b = { name: 'b.tsv' };
    fireDrag('drop', { types: ['Files'], files: { length: 2, 0: a, 1: b } });
    expect(document.body.classList.contains('dz-dragging')).toBe(false);
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([
      { path: 'a.json', file: a },
      { path: 'b.tsv', file: b },
    ]));
  });

  it('ignores drops without files', async () => {
    const onFiles = vi.fn();
    installGlobalDrop(onFiles);
    fireDrag('drop', { types: ['Files'], files: { length: 0 } });
    await Promise.resolve();
    await Promise.resolve();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('surfaces drop processing failures as a notification, not an uncaught error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFiles = vi.fn();
    installGlobalDrop(onFiles);
    fireDrag('drop', {
      types: ['Files'],
      items: { length: 1, 0: { webkitGetAsEntry: () => { throw new Error('boom'); } } },
    });
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(onFiles).not.toHaveBeenCalled();
    expect(globalThis.showTemporaryNotification.mock.calls.some(c => c[0].includes('ZIP'))).toBe(true);
    errorSpy.mockRestore();
  });
});

describe('Logger', () => {
  // debugMode is module-local to section 05; the loud path is only reachable
  // inside the assembled app, so tests cover the silent guard and timestamping.
  it('stays silent while debug mode is off', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.log('[test] quiet');
    Logger.log('[test] quiet with data', { a: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('produces zero-padded hh:mm:ss.mmm timestamps', () => {
    expect(Logger.ts()).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});
