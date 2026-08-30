import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initializeExport,
  showExportDialog,
  hideExportDialog,
  exportAsSvg,
  exportAsPng,
  getTimestamp,
  sanitizeExportClone,
} from '../src/sections/03-export-dialog.js';
import { SVG_ID, WIDTH, HEIGHT } from '../src/sections/01-config-status.js';
import { cssVar, cssNumber } from '../src/sections/08-color-geometry.js';
import { setExclusiveActive } from '../src/sections/12-legend-org.js';
import { LABEL_VISIBILITY_CLASSES } from '../src/sections/14-render.js';

let downloads;

const FIXTURE = `
  <button id="exportBtn"></button>
  <div id="exportModal" class="modal">
    <div class="modal-overlay"></div>
    <button class="modal-close-btn"></button>
    <button class="format-btn active" data-format="png"></button>
    <button class="format-btn" data-format="svg"></button>
  </div>
  <div id="svgOptions" hidden></div>
  <div id="pngOptions"></div>
  <button id="downloadSvg"></button>
  <button id="downloadPng"></button>
  <button class="resolution-preset" data-width="1920" data-height="1080"></button>
  <button class="resolution-preset" data-width="3840" data-height="2160"></button>
  <input id="customWidth" value="1200"><input id="customHeight" value="800">
  <svg id="graph" viewBox="0 0 100 50"><g class="node"></g></svg>`;

class FakeImage {
  set src(_) { setTimeout(() => this.onload && this.onload(), 0); }
}

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  downloads = [];
  globalThis.SVG_ID = SVG_ID;
        globalThis.cssVar = cssVar;
    globalThis.cssNumber = cssNumber;
  globalThis.setExclusiveActive = setExclusiveActive;
  globalThis.LABEL_VISIBILITY_CLASSES = LABEL_VISIBILITY_CLASSES;
  globalThis.WIDTH = WIDTH;
  globalThis.HEIGHT = HEIGHT;
  globalThis.showTemporaryNotification = vi.fn();
  vi.stubGlobal('Blob', class FakeBlob {
    constructor(parts, opts) { this.content = parts.join(''); this.type = opts?.type; }
  });
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = vi.fn((blob) => { downloads.push({ blob }); return '#blob-mock'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloads.push({ href: this.href, download: this.download });
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(), drawImage: vi.fn(),
    set fillStyle(_) {}, set imageSmoothingEnabled(_) {}, set imageSmoothingQuality(_) {},
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,MOCK');
  initializeExport();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const modal = () => document.getElementById('exportModal');

describe('getTimestamp', () => {
  it('formats YYYYMMDD_HHmmss', () => {
    expect(getTimestamp()).toMatch(/^\d{8}_\d{6}$/);
  });
});

describe('dialog flow', () => {
  it('opens via the export button with the first preset active and closes again', () => {
    document.getElementById('exportBtn').click();
    expect(modal().classList.contains('open')).toBe(true);
    expect(document.querySelectorAll('.resolution-preset')[0].classList.contains('active')).toBe(true);
    document.querySelector('.modal-close-btn').click();
    expect(modal().classList.contains('open')).toBe(false);
    showExportDialog();
    document.querySelector('.modal-overlay').click();
    expect(modal().classList.contains('open')).toBe(false);
  });

  it('switches format options between SVG and PNG', () => {
    const [pngBtn, svgBtn] = document.querySelectorAll('.format-btn');
    svgBtn.click();
    expect(svgBtn.classList.contains('active')).toBe(true);
    expect(pngBtn.classList.contains('active')).toBe(false);
    expect(document.getElementById('svgOptions').hidden).toBe(false);
    expect(document.getElementById('pngOptions').hidden).toBe(true);
    pngBtn.click();
    expect(document.getElementById('pngOptions').hidden).toBe(false);
  });

  it('presets fill the custom inputs; typing clears the preset state', () => {
    const [p1] = document.querySelectorAll('.resolution-preset');
    p1.click();
    expect(document.getElementById('customWidth').value).toBe('1920');
    expect(document.getElementById('customHeight').value).toBe('1080');
    document.getElementById('customWidth').dispatchEvent(new Event('input'));
    expect(p1.classList.contains('active')).toBe(false);
  });

  it('Escape closes and Enter triggers the export of the active format', () => {
    showExportDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(modal().classList.contains('open')).toBe(false);

    showExportDialog();
    document.querySelector('[data-format="svg"]').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(downloads.some((d) => d.download?.endsWith('.svg'))).toBe(true);
  });
});

describe('exportAsSvg', () => {
  it('serializes a styled clone and downloads it with a timestamped name', () => {
    exportAsSvg();
    const blobEntry = downloads.find((d) => d.blob);
    expect(blobEntry.blob.type).toContain('image/svg+xml');
    expect(blobEntry.blob.content).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(blobEntry.blob.content).toContain('.node-circle');
    const link = downloads.find((d) => d.download);
    expect(link.download).toMatch(/^orggraph_export_\d{8}_\d{6}\.svg$/);
    expect(modal().classList.contains('open')).toBe(false);
    expect(globalThis.showTemporaryNotification).toHaveBeenCalledWith('SVG-Export erfolgreich!');
  });

  it('reports a missing graph element', () => {
    document.querySelector('#graph').remove();
    exportAsSvg();
    expect(downloads).toHaveLength(0);
    expect(globalThis.showTemporaryNotification.mock.calls[0][0]).toContain('nicht gefunden');
  });
});

describe('exportAsPng', () => {
  it('renders the SVG onto a canvas and downloads the PNG', async () => {
    document.getElementById('customWidth').value = '100';
    document.getElementById('customHeight').value = '50';
    exportAsPng();
    await new Promise((r) => setTimeout(r, 0)); // FakeImage onload
    const link = downloads.find((d) => d.download);
    expect(link.download).toMatch(/^orggraph_export_\d{8}_\d{6}\.png$/);
    expect(link.href).toBe('data:image/png;base64,MOCK');
    expect(globalThis.showTemporaryNotification).toHaveBeenCalledWith('PNG-Export erfolgreich!');
  });

  it('reports image load failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('Image', class { set src(_) { setTimeout(() => this.onerror && this.onerror(new Error('x')), 0); } });
    exportAsPng();
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.showTemporaryNotification.mock.calls.at(-1)[0]).toContain('Bild konnte nicht geladen werden');
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('sanitizeExportClone (FR-8.5, AK 89)', () => {
  it('strips data-* attributes, title/desc and comments but keeps visible text', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.innerHTML = `
      <!-- raw comment vera@example.org -->
      <g class="node" data-id="p1"><title>Vera Chefin</title>
        <circle class="attribute-circle" data-attribute="Rolle::Lead"></circle>
        <text class="label">Person 7</text>
      </g>`;
    sanitizeExportClone(root);
    const out = new XMLSerializer().serializeToString(root);
    expect(out).not.toContain('data-id');
    expect(out).not.toContain('data-attribute');
    expect(out).not.toContain('Vera');
    expect(out).not.toContain('vera@example.org');
    expect(out).not.toContain('Rolle::Lead');
    expect(out).toContain('Person 7');
    expect(out).toContain('attribute-circle');
  });
});
