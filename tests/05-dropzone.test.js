import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureOverlay,
  showDropZone,
  hideDropZone,
  installGlobalDrop,
  Logger,
} from '../src/sections/05-dropzone.js';

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

  it('opens a multi-file picker and forwards chosen files', () => {
    const onFiles = vi.fn();
    ensureOverlay(onFiles);
    document.querySelector('.dz-pick').click();
    const picker = document.querySelector('input[type="file"]');
    expect(picker.multiple).toBe(true);
    expect(picker.accept).toContain('.json');
    const fakeFiles = { length: 1, 0: { name: 'x.json' } };
    Object.defineProperty(picker, 'files', { value: fakeFiles });
    picker.dispatchEvent(new Event('change'));
    expect(onFiles).toHaveBeenCalledWith(fakeFiles);
    expect(document.querySelector('input[type="file"]')).toBeNull(); // removed after use
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

  it('delivers dropped files and resets the drag state', () => {
    const onFiles = vi.fn();
    installGlobalDrop(onFiles);
    fireDrag('dragenter', { types: ['Files'] });
    const files = { length: 2 };
    fireDrag('drop', { types: ['Files'], files });
    expect(onFiles).toHaveBeenCalledWith(files);
    expect(document.body.classList.contains('dz-dragging')).toBe(false);
  });

  it('ignores drops without files', () => {
    const onFiles = vi.fn();
    installGlobalDrop(onFiles);
    fireDrag('drop', { types: ['Files'], files: { length: 0 } });
    expect(onFiles).not.toHaveBeenCalled();
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
