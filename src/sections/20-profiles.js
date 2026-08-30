// ========== Profile switcher (parallel configurations) ==========
// Renders a compact selector in the footer to switch between the configurations
// stored side by side in IndexedDB (see 04-storage.js). Switching, duplicating
// and deleting reload the page so the existing init path rebuilds cleanly from
// the newly active profile's namespace.

// Latest rendered state — the wired-once control handlers read these instead
// of stale render-scope closures.
let profileSwitcherProfiles = [];
let profileSwitcherActive = null;

/** (Re)fill the footer profile switcher from the stored profile list. */
export async function renderProfileSwitcher() {
  // Host span, label and select are static footer markup in
  // index.template.html; this fills the options and wires the controls
  // exactly once (dataset.wired), like the sibling #timeControls widget.
  const wrap = document.getElementById('profileSwitcher');
  const select = wrap && wrap.querySelector('#profileSelect');
  if (!wrap || !select) return;

  profileSwitcherProfiles = await listProfiles();
  profileSwitcherActive = await getActiveProfileId();

  select.innerHTML = '';
  for (const p of profileSwitcherProfiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    if (p.id === profileSwitcherActive) opt.selected = true;
    select.appendChild(opt);
  }

  if (!wrap.dataset.wired) {
    wrap.dataset.wired = 'true';

    select.addEventListener('change', async () => {
      if (select.value === profileSwitcherActive) return;
      try { await switchProfile(select.value); location.reload(); }
      catch (e) { console.error(e); showTemporaryNotification('Profilwechsel fehlgeschlagen'); }
    });

    // Buttons are static template markup; JS only wires them (like #resetData)
    const wireBtn = (id, handler) => {
      const b = wrap.querySelector('#' + id);
      if (b) b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handler(); });
    };

    wireBtn('profileNewBtn', () => openNewProfileDropZone());
    wireBtn('profileRenameBtn', async () => {
      const cur = profileSwitcherProfiles.find(p => p.id === profileSwitcherActive);
      const name = (typeof prompt === 'function') ? prompt('Profil umbenennen:', cur ? cur.name : profileSwitcherActive) : null;
      if (name && name.trim()) { await renameProfile(profileSwitcherActive, name.trim()); await renderProfileSwitcher(); }
    });
    wireBtn('profileDuplicateBtn', async () => {
      const cur = profileSwitcherProfiles.find(p => p.id === profileSwitcherActive);
      const newId = await duplicateProfile(profileSwitcherActive, (cur ? cur.name : profileSwitcherActive) + ' Kopie');
      if (newId) { try { await switchProfile(newId); } catch (_) {} location.reload(); }
    });
    wireBtn('profileDeleteBtn', async () => {
      const cur = profileSwitcherProfiles.find(p => p.id === profileSwitcherActive);
      const ok = (typeof confirm === 'function')
        ? confirm(`Profil "${cur ? cur.name : profileSwitcherActive}" und alle zugehörigen Daten löschen?`)
        : true;
      if (!ok) return;
      await deleteProfile(profileSwitcherActive);
      location.reload();
    });
  }

  wrap.hidden = false;
}

/** Open the drag-and-drop panel so a whole config (folder / ZIP / files) can be
 *  dropped at once. The global drop handler routes it through the normal pipeline,
 *  which creates (and activates) a new profile for any env/data configuration —
 *  no separate file dialog, and no dead-end when only env.json would be picked. */
export function openNewProfileDropZone() {
  showDropZone(handleDroppedFiles);
}

window.addEventListener('DOMContentLoaded', () => { renderProfileSwitcher(); });
