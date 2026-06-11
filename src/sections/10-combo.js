export function populateCombo(filterText) {
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  if (!input || !list) return;
  const term = (filterText || "").toLowerCase().trim();
  
  // Bei leerem Suchbegriff keine Vorschlagsliste anzeigen
  if (!term) {
    list.innerHTML = "";
    list.hidden = true;
    filteredItems = [];
    activeIndex = -1;
    return;
  }

  // Require minimum search length for large datasets
  if (term.length > 0 && term.length < MIN_SEARCH_LENGTH) {
    list.innerHTML = '<li style="padding: 8px; color: #666; font-style: italic;">Mindestens ' + MIN_SEARCH_LENGTH + ' Zeichen eingeben...</li>';
    list.hidden = false;
    filteredItems = [];
    activeIndex = -1;
    return;
  }
  
  // Fast filtering with early termination
  // Suche nach Display-Labels (pseudonymisiert wenn aktiv) und IDs [SF]
  filteredItems = [];
  let count = 0;
  for (const n of allNodesUnique) {
    if (count >= MAX_DROPDOWN_ITEMS) break;
    
    if (!term) {
      filteredItems.push(n);
      count++;
      continue;
    }
    
    const displayLabel = getDisplayLabel(n).toLowerCase();
    const idStr = String(n.id).toLowerCase();
    if (displayLabel.includes(term) || idStr.includes(term)) {
      filteredItems.push(n);
      count++;
    }
  }
  
  // Sortiere nach Display-Labels
  filteredItems.sort((a, b) => getDisplayLabel(a).localeCompare(getDisplayLabel(b)));

  list.innerHTML = '';
  activeIndex = -1;
  const frag = document.createDocumentFragment();
  
  filteredItems.forEach((n, idx) => {
    const li = document.createElement('li');
    const displayLbl = getDisplayLabel(n);
    li.textContent = `${displayLbl} — ${n.id}`;
    li.setAttribute('data-id', String(n.id));
    li.tabIndex = -1;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Shift-Klick fügt als weiteren Root hinzu, sonst ersetzt
      const addMode = !!(e.shiftKey);
      chooseItem(idx, addMode);
    });
    frag.appendChild(li);
  });
  
  // Show "more results" hint if truncated
  if (count >= MAX_DROPDOWN_ITEMS) {
    const hint = document.createElement('li');
    hint.style.padding = '8px';
    hint.style.color = '#666';
    hint.style.fontStyle = 'italic';
    hint.style.borderTop = '1px solid #e5e7eb';
    hint.textContent = `Nur erste ${MAX_DROPDOWN_ITEMS} Ergebnisse angezeigt. Suchbegriff verfeinern...`;
    frag.appendChild(hint);
  }
  
  list.appendChild(frag);
  list.hidden = filteredItems.length === 0;
}

export function setActive(idx) {
  const list = document.querySelector(LIST_COMBO_ID);
  if (!list) return;
  const items = Array.from(list.children);
  items.forEach((el, i) => {
    if (i === idx) el.classList.add('is-active'); else el.classList.remove('is-active');
  });
  activeIndex = idx;
  if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
}

export function chooseItem(idx, addMode) {
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  if (!input || !list) return;
  if (idx < 0 || idx >= filteredItems.length) return;
  const n = filteredItems[idx];
  const nid = String(n.id);
  if (addMode) {
    try { if (debugMode) console.log('[ui] chooseItem addMode', { idx, nid }); } catch {}
    // Wenn dies der erste Shift-Add ist, initialisiere die Multi-Root-Liste
    if (selectedRootIds.length === 0) {
      let seed = currentSelectedId || lastSingleRootId;
      if (!seed) {
        // Versuche aus dem aktuellen Eingabetext einen Start zu erraten
        const inputVal = (input && input.value) ? input.value : '';
        const guessed = guessIdFromInput(inputVal);
        if (guessed && guessed !== nid) seed = guessed;
      }
      if (seed && String(seed) !== nid) {
        selectedRootIds = [String(seed)];
        try { if (debugMode) console.log('[roots] initial seed in chooseItem', { seed: String(seed) }); } catch {}
      }
    }
    if (addRoot(nid)) {
      currentSelectedId = nid;
    }
  } else {
    Logger.log('[ui] chooseItem replaceMode', { idx, nid });
    setSingleRoot(nid);
    currentSelectedId = nid;
  }
  input.value = getDisplayLabel(n);
  list.hidden = true;
  // Auto-apply and re-center when selecting from dropdown
  applyFromUI('comboSelect');
}

/**
 * Findet Knoten-ID aus Benutzereingabe
 */
export function guessIdFromInput(val) {
  if (!val) return null;
  
  // Priorität 1: Exakte Übereinstimmung mit Label
  const exactByLabel = raw.nodes.find(n => (n.label || "") === val);
  if (exactByLabel) return String(exactByLabel.id);
  
  // Priorität 2: Exakte Übereinstimmung mit ID
  const exactById = raw.nodes.find(n => String(n.id) === val);
  if (exactById) return String(exactById.id);
  
  // Priorität 3: Teilweise Übereinstimmung mit Label (case-insensitive)
  const part = raw.nodes.find(n => (n.label || "").toLowerCase().includes(val.toLowerCase()));
  return part ? String(part.id) : null;
}

/**
 * Erstellt Adjazenzliste des Graphen
 */
