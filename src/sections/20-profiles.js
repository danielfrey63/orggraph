// ========== Profile switcher (parallel configurations) ==========
// Renders a compact selector in the footer to switch between the configurations
// stored side by side in IndexedDB (see 04-storage.js). Switching, duplicating
// and deleting reload the page so the existing init path rebuilds cleanly from
// the newly active profile's namespace.

/** (Re)build the footer profile switcher from the stored profile list. */
export async function renderProfileSwitcher() {
  // The host span is static footer markup in index.template.html.
  const wrap = document.getElementById('profileSwitcher');
  if (!wrap) return;

  const profiles = await listProfiles();
  const active = await getActiveProfileId();

  wrap.innerHTML = '';

  const label = document.createElement('label');
  label.className = 'profile-switcher-label';
  label.textContent = 'Konfig:';
  label.htmlFor = 'profileSelect';
  wrap.appendChild(label);

  const select = document.createElement('select');
  select.id = 'profileSelect';
  select.className = 'profile-select';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    if (p.id === active) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', async () => {
    if (select.value === active) return;
    try { await switchProfile(select.value); location.reload(); }
    catch (e) { console.error(e); showTemporaryNotification('Profilwechsel fehlgeschlagen', 4000); }
  });
  wrap.appendChild(select);

  // Icon buttons share the createIconButton primitive (12-legend-org.js)
  const mkBtn = (icon, title, handler) =>
    wrap.appendChild(createIconButton({ icon, title, className: 'profile-btn', onClick: handler }));

  mkBtn('plus', 'Neue Konfiguration laden (Ordner/ZIP/Dateien hierher ziehen) …', () => openNewProfileDropZone());
  mkBtn('edit', 'Aktuelles Profil umbenennen', async () => {
    const cur = profiles.find(p => p.id === active);
    const name = (typeof prompt === 'function') ? prompt('Profil umbenennen:', cur ? cur.name : active) : null;
    if (name && name.trim()) { await renameProfile(active, name.trim()); await renderProfileSwitcher(); }
  });
  mkBtn('copy', 'Aktuelles Profil duplizieren', async () => {
    const cur = profiles.find(p => p.id === active);
    const newId = await duplicateProfile(active, (cur ? cur.name : active) + ' Kopie');
    if (newId) { try { await switchProfile(newId); } catch (_) {} location.reload(); }
  });
  mkBtn('close', 'Aktuelles Profil löschen', async () => {
    const cur = profiles.find(p => p.id === active);
    const ok = (typeof confirm === 'function')
      ? confirm(`Profil "${cur ? cur.name : active}" und alle zugehörigen Daten löschen?`)
      : true;
    if (!ok) return;
    await deleteProfile(active);
    location.reload();
  });
}

/** Open the drag-and-drop panel so a whole config (folder / ZIP / files) can be
 *  dropped at once. The global drop handler routes it through the normal pipeline,
 *  which creates (and activates) a new profile for any env/data configuration —
 *  no separate file dialog, and no dead-end when only env.json would be picked. */
export function openNewProfileDropZone() {
  showDropZone(handleDroppedFiles);
}

window.addEventListener('DOMContentLoaded', () => { renderProfileSwitcher(); });
