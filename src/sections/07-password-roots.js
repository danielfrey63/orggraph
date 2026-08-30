export function showPasswordDialog(onSubmit) {
  // Existierenden Dialog entfernen falls vorhanden
  const existing = document.getElementById('passwordDialog');
  if (existing) existing.remove();
  
  // Dialog über die gemeinsame Modal-Factory (gleicher Vertrag wie #exportModal)
  const { content, close: closeDialog } = createModal({ id: 'passwordDialog', title: 'Passwort' });

  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'Passwort eingeben...';
  input.className = 'modal-input';

  const errorMsg = document.createElement('div');
  errorMsg.className = 'modal-error';

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-btn-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Abbrechen';
  cancelBtn.className = 'btn';

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Bestätigen';
  submitBtn.className = 'btn-primary';
  
  const trySubmit = () => {
    const pw = input.value;
    if (pw === envConfig?.TOOLBAR_PSEUDO_PASSWORD) {
      closeDialog();
      onSubmit(pw);
    } else {
      errorMsg.textContent = 'Falsches Passwort';
      input.classList.add('modal-input--error');
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

  btnRow.append(cancelBtn, submitBtn);
  content.append(input, errorMsg, btnRow);
  
  // Fokus auf Input setzen
    setTimeout(() => input.focus(), cssNumber('--legend-settle-ms'));
}

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

