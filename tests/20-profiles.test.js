import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderProfileSwitcher, openNewProfileDropZone } from '../src/sections/20-profiles.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '<footer class="app-footer"><div class="footer-stats">' +
    '<span id="status">Bereit</span></div></footer>';
  globalThis.listProfiles = vi.fn(async () => [
    { id: 'default', name: 'Standard' },
    { id: 'hrm', name: 'HRM' },
  ]);
  globalThis.getActiveProfileId = vi.fn(async () => 'hrm');
  globalThis.switchProfile = vi.fn(async () => {});
  globalThis.renameProfile = vi.fn(async () => {});
  globalThis.duplicateProfile = vi.fn(async () => 'hrm-kopie');
  globalThis.deleteProfile = vi.fn(async () => 'default');
  globalThis.handleDroppedFiles = vi.fn(async () => {});
  globalThis.showDropZone = vi.fn();
  globalThis.showTemporaryNotification = vi.fn();
  vi.stubGlobal('location', { reload: vi.fn() });
  vi.stubGlobal('prompt', vi.fn(() => 'Renamed'));
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('renderProfileSwitcher', () => {
  it('renders a select with all profiles and the active one preselected', async () => {
    await renderProfileSwitcher();
    const select = document.getElementById('profileSelect');
    expect(select).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['default', 'hrm']);
    expect(select.value).toBe('hrm');
  });

  it('is idempotent — re-rendering does not duplicate the switcher', async () => {
    await renderProfileSwitcher();
    await renderProfileSwitcher();
    expect(document.querySelectorAll('#profileSwitcher').length).toBe(1);
  });

  it('switching the select activates the profile and reloads', async () => {
    await renderProfileSwitcher();
    const select = document.getElementById('profileSelect');
    select.value = 'default';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(globalThis.switchProfile).toHaveBeenCalledWith('default');
    expect(globalThis.location.reload).toHaveBeenCalled();
  });

  it('selecting the already-active profile does nothing', async () => {
    await renderProfileSwitcher();
    const select = document.getElementById('profileSelect');
    select.value = 'hrm';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(globalThis.switchProfile).not.toHaveBeenCalled();
  });

  it('rename button prompts and renames without reload', async () => {
    await renderProfileSwitcher();
    document.querySelector('.profile-btn[title*="umbenennen"]').click();
    await flush();
    expect(globalThis.renameProfile).toHaveBeenCalledWith('hrm', 'Renamed');
    expect(globalThis.location.reload).not.toHaveBeenCalled();
  });

  it('duplicate button copies, switches to the copy and reloads', async () => {
    await renderProfileSwitcher();
    document.querySelector('.profile-btn[title*="duplizieren"]').click();
    await flush();
    expect(globalThis.duplicateProfile).toHaveBeenCalled();
    expect(globalThis.switchProfile).toHaveBeenCalledWith('hrm-kopie');
    expect(globalThis.location.reload).toHaveBeenCalled();
  });

  it('delete button confirms, deletes and reloads', async () => {
    await renderProfileSwitcher();
    document.querySelector('.profile-btn[title*="löschen"]').click();
    await flush();
    expect(globalThis.deleteProfile).toHaveBeenCalledWith('hrm');
    expect(globalThis.location.reload).toHaveBeenCalled();
  });

  it('delete button aborts when not confirmed', async () => {
    globalThis.confirm.mockReturnValueOnce(false);
    await renderProfileSwitcher();
    document.querySelector('.profile-btn[title*="löschen"]').click();
    await flush();
    expect(globalThis.deleteProfile).not.toHaveBeenCalled();
  });
});

describe('openNewProfileDropZone', () => {
  it('opens the drag-and-drop panel routed through the normal drop pipeline', () => {
    openNewProfileDropZone();
    expect(globalThis.showDropZone).toHaveBeenCalledWith(globalThis.handleDroppedFiles);
  });

  it('the "+" button opens the drop panel instead of a file dialog', async () => {
    await renderProfileSwitcher();
    document.querySelector('.profile-btn[title*="Neue Konfiguration"]').click();
    await flush();
    expect(globalThis.showDropZone).toHaveBeenCalledWith(globalThis.handleDroppedFiles);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
