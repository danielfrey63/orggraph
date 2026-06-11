/* v8 ignore start */
export function showPasswordDialog(onSubmit) {
  // Existierenden Dialog entfernen falls vorhanden
  const existing = document.getElementById('passwordDialog');
  if (existing) existing.remove();
  
  // Dialog erstellen
  const overlay = document.createElement('div');
  overlay.id = 'passwordDialog';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); z-index: 10000;
    display: flex; align-items: center; justify-content: center;
  `;
  
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: var(--bg-primary, #1e1e1e); border-radius: 8px;
    padding: 20px; min-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;
  
  const title = document.createElement('h3');
  title.textContent = 'Passwort erforderlich';
  title.style.cssText = 'margin: 0 0 16px 0; color: var(--text-primary, #fff);';
  
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'Passwort eingeben...';
  input.style.cssText = `
    width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #444);
    border-radius: 4px; background: var(--bg-secondary, #2d2d2d);
    color: var(--text-primary, #fff); font-size: 14px; box-sizing: border-box;
  `;
  
  const errorMsg = document.createElement('div');
  errorMsg.style.cssText = `
    color: #ef4444; font-size: 12px; margin-top: 8px; min-height: 18px;
  `;
  
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;';
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Abbrechen';
  cancelBtn.style.cssText = `
    padding: 8px 16px; border: 1px solid var(--border-color, #444);
    border-radius: 4px; background: transparent; color: var(--text-primary, #fff);
    cursor: pointer;
  `;
  
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Bestätigen';
  submitBtn.style.cssText = `
    padding: 8px 16px; border: none; border-radius: 4px;
    background: var(--accent-color, #4F46E5); color: #fff; cursor: pointer;
  `;
  
  const closeDialog = () => overlay.remove();
  
  const trySubmit = () => {
    const pw = input.value;
    if (pw === envConfig?.TOOLBAR_PSEUDO_PASSWORD) {
      closeDialog();
      onSubmit(pw);
    } else {
      errorMsg.textContent = 'Falsches Passwort';
      input.style.borderColor = '#ef4444';
      input.focus();
      input.select();
    }
  };
  
  cancelBtn.addEventListener('click', closeDialog);
  submitBtn.addEventListener('click', trySubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') trySubmit();
    if (e.key === 'Escape') closeDialog();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  dialog.appendChild(title);
  dialog.appendChild(input);
  dialog.appendChild(errorMsg);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  // Fokus auf Input setzen
  setTimeout(() => input.focus(), 50);
}
/* v8 ignore stop */

// ========== Ende Pseudonymisierung ==========

export function isRoot(id){ return selectedRootIds.includes(String(id)); }
export function setSingleRoot(id){
  selectedRootIds = [String(id)];
  lastSingleRootId = String(id);
  // Simulation NICHT auf null setzen - Positionen müssen für transitionGraph erhalten bleiben [SF][PA]
  // Die Simulation wird in renderGraph wiederverwendet oder neu erstellt
  Logger.log('[roots] setSingleRoot', { id: String(id) });
}
export function addRoot(id){
  const s = String(id);
  // Wenn noch kein Multi-Root aktiv ist, aber es einen aktuellen Einzel-Root gibt, übernehme ihn als Start
  if (selectedRootIds.length === 0) {
    const seed = currentSelectedId ? String(currentSelectedId) : (lastSingleRootId ? String(lastSingleRootId) : null);
    if (seed && seed !== s) {
      selectedRootIds = [seed];
      Logger.log('[roots] seed multi-root from', { seed, add: s });
    }
  }
  if (selectedRootIds.includes(s)) return true;
  if (selectedRootIds.length >= MAX_ROOTS) { showTemporaryNotification(`Maximal ${MAX_ROOTS} Roots`); return false; }
  const before = selectedRootIds.slice();
  selectedRootIds = selectedRootIds.concat([s]);
  // Falls dies der erste Add ist und wir einen letzten Einzel-Root kennen, füge ihn nachträglich hinzu
  if (before.length === 0 && lastSingleRootId && lastSingleRootId !== s) {
    selectedRootIds = [String(lastSingleRootId)].concat(selectedRootIds);
    Logger.log('[roots] retro-seed after add', { lastSingleRootId, add: s, after: selectedRootIds.slice() });
  }
  Logger.log('[roots] addRoot', { add: s, before, after: selectedRootIds.slice() });
  return true;
}
export function removeRoot(id){
  const s = String(id);
  selectedRootIds = selectedRootIds.filter(x => x !== s);
}

