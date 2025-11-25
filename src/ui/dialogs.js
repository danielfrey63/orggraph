/**
 * Dialog-System [SF][DRY]
 * Verwaltet modale Dialoge.
 */

// import { showTemporaryNotification } from '../utils/dom.js';

/**
 * Zeigt einen Passwort-Dialog [SF][SFT]
 * @param {Function} onSubmit - Callback mit Passwort
 */
export function showPasswordDialog(onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'password-dialog-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const dialog = document.createElement('div');
  dialog.className = 'password-dialog';
  dialog.style.cssText = `
    background: var(--panel-bg, #1e1e1e);
    border: 1px solid var(--border-color, #3c3c3c);
    border-radius: 8px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;
  
  dialog.innerHTML = `
    <h3 style="margin: 0 0 16px 0; color: var(--text-strong, #fff);">Passwort erforderlich</h3>
    <p style="margin: 0 0 12px 0; color: var(--text-muted, #888);">
      Bitte geben Sie das Passwort ein, um die Pseudonymisierung zu deaktivieren.
    </p>
    <input type="password" class="password-input" style="
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border-color, #3c3c3c);
      border-radius: 4px;
      background: var(--input-bg, #2d2d2d);
      color: var(--text-strong, #fff);
      font-size: 14px;
      box-sizing: border-box;
    " placeholder="Passwort eingeben...">
    <div class="error-message" style="
      color: #f44336;
      font-size: 12px;
      margin-top: 8px;
      display: none;
    ">Falsches Passwort</div>
    <div style="display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;">
      <button class="cancel-btn" style="
        padding: 8px 16px;
        border: 1px solid var(--border-color, #3c3c3c);
        border-radius: 4px;
        background: transparent;
        color: var(--text-muted, #888);
        cursor: pointer;
      ">Abbrechen</button>
      <button class="submit-btn" style="
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: var(--accent-color, #0078d4);
        color: #fff;
        cursor: pointer;
      ">Bestätigen</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  const input = dialog.querySelector('.password-input');
  const errorMsg = dialog.querySelector('.error-message');
  const cancelBtn = dialog.querySelector('.cancel-btn');
  const submitBtn = dialog.querySelector('.submit-btn');
  
  const close = () => {
    overlay.remove();
  };
  
  const submit = () => {
    const password = input.value;
    if (onSubmit(password)) {
      close();
    } else {
      errorMsg.style.display = 'block';
      input.value = '';
      input.focus();
    }
  };
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      close();
    }
  });
  
  cancelBtn.addEventListener('click', close);
  submitBtn.addEventListener('click', submit);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  
  input.focus();
}

/**
 * Zeigt einen Bestätigungs-Dialog [SF]
 * @param {string} message - Nachricht
 * @param {Function} onConfirm - Callback bei Bestätigung
 * @param {Function} onCancel - Callback bei Abbruch
 */
export function showConfirmDialog(message, onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-dialog-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const dialog = document.createElement('div');
  dialog.className = 'confirm-dialog';
  dialog.style.cssText = `
    background: var(--panel-bg, #1e1e1e);
    border: 1px solid var(--border-color, #3c3c3c);
    border-radius: 8px;
    padding: 20px;
    min-width: 300px;
    max-width: 400px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;
  
  dialog.innerHTML = `
    <p style="margin: 0 0 16px 0; color: var(--text-strong, #fff);">${message}</p>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button class="cancel-btn" style="
        padding: 8px 16px;
        border: 1px solid var(--border-color, #3c3c3c);
        border-radius: 4px;
        background: transparent;
        color: var(--text-muted, #888);
        cursor: pointer;
      ">Abbrechen</button>
      <button class="confirm-btn" style="
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: var(--accent-color, #0078d4);
        color: #fff;
        cursor: pointer;
      ">Bestätigen</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  const cancelBtn = dialog.querySelector('.cancel-btn');
  const confirmBtn = dialog.querySelector('.confirm-btn');
  
  const close = () => overlay.remove();
  
  cancelBtn.addEventListener('click', () => {
    close();
    if (onCancel) onCancel();
  });
  
  confirmBtn.addEventListener('click', () => {
    close();
    if (onConfirm) onConfirm();
  });
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
      if (onCancel) onCancel();
    }
  });
  
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') {
      close();
      if (onCancel) onCancel();
      document.removeEventListener('keydown', handler);
    } else if (e.key === 'Enter') {
      close();
      if (onConfirm) onConfirm();
      document.removeEventListener('keydown', handler);
    }
  });
}

/**
 * Zeigt einen Eingabe-Dialog [SF]
 * @param {string} title - Titel
 * @param {string} placeholder - Platzhalter
 * @param {Function} onSubmit - Callback mit Eingabe
 * @param {string} defaultValue - Standardwert
 */
export function showInputDialog(title, placeholder, onSubmit, defaultValue = '') {
  const overlay = document.createElement('div');
  overlay.className = 'input-dialog-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const dialog = document.createElement('div');
  dialog.className = 'input-dialog';
  dialog.style.cssText = `
    background: var(--panel-bg, #1e1e1e);
    border: 1px solid var(--border-color, #3c3c3c);
    border-radius: 8px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;
  
  dialog.innerHTML = `
    <h3 style="margin: 0 0 16px 0; color: var(--text-strong, #fff);">${title}</h3>
    <input type="text" class="dialog-input" style="
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border-color, #3c3c3c);
      border-radius: 4px;
      background: var(--input-bg, #2d2d2d);
      color: var(--text-strong, #fff);
      font-size: 14px;
      box-sizing: border-box;
    " placeholder="${placeholder}" value="${defaultValue}">
    <div style="display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;">
      <button class="cancel-btn" style="
        padding: 8px 16px;
        border: 1px solid var(--border-color, #3c3c3c);
        border-radius: 4px;
        background: transparent;
        color: var(--text-muted, #888);
        cursor: pointer;
      ">Abbrechen</button>
      <button class="submit-btn" style="
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: var(--accent-color, #0078d4);
        color: #fff;
        cursor: pointer;
      ">OK</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  const input = dialog.querySelector('.dialog-input');
  const cancelBtn = dialog.querySelector('.cancel-btn');
  const submitBtn = dialog.querySelector('.submit-btn');
  
  const close = () => overlay.remove();
  
  const submit = () => {
    const value = input.value.trim();
    if (value) {
      close();
      onSubmit(value);
    }
  };
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      close();
    }
  });
  
  cancelBtn.addEventListener('click', close);
  submitBtn.addEventListener('click', submit);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  
  input.focus();
  input.select();
}

export default {
  showPasswordDialog,
  showConfirmDialog,
  showInputDialog
};
