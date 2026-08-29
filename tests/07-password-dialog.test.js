import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showPasswordDialog } from '../src/sections/07-password-roots.js';
import { createModal } from '../src/sections/03-export-dialog.js';

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.createModal = createModal;
  globalThis.envConfig = { TOOLBAR_PSEUDO_PASSWORD: 'geheim' };
});

const dialog = () => document.getElementById('passwordDialog');
const input = () => dialog().querySelector('input[type="password"]');
const buttons = () => Array.from(dialog().querySelectorAll('button'));
const key = (k) => input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('showPasswordDialog', () => {
  it('opens the dialog and replaces an already open instance', () => {
    showPasswordDialog(() => {});
    showPasswordDialog(() => {});
    expect(document.querySelectorAll('#passwordDialog')).toHaveLength(1);
  });

  it('submits on correct password and closes the dialog', () => {
    const onSubmit = vi.fn();
    showPasswordDialog(onSubmit);
    input().value = 'geheim';
    buttons().find((b) => b.textContent === 'Bestätigen').click();
    expect(onSubmit).toHaveBeenCalledWith('geheim');
    expect(dialog()).toBeNull();
  });

  it('shows an error and stays open on a wrong password', () => {
    const onSubmit = vi.fn();
    showPasswordDialog(onSubmit);
    input().value = 'falsch';
    key('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(dialog().textContent).toContain('Falsches Passwort');
    expect(input().classList.contains('modal-input--error')).toBe(true);
  });

  it('submits via Enter key', () => {
    const onSubmit = vi.fn();
    showPasswordDialog(onSubmit);
    input().value = 'geheim';
    key('Enter');
    expect(onSubmit).toHaveBeenCalledWith('geheim');
  });

  it('closes without submit on Escape, cancel button and overlay click', () => {
    const onSubmit = vi.fn();
    showPasswordDialog(onSubmit);
    key('Escape');
    expect(dialog()).toBeNull();

    showPasswordDialog(onSubmit);
    buttons().find((b) => b.textContent === 'Abbrechen').click();
    expect(dialog()).toBeNull();

    showPasswordDialog(onSubmit);
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog()).toBeNull();

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
