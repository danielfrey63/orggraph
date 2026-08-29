// Prop values join the search domain (FR-7.6): in pseudo mode ONLY values
// whitelisted as nonSensitive in the tenant registry are searchable (E60);
// without pseudo, every scalar prop value matches.
export function comboPropText(n) {
  if (!n || !n.props || typeof og2Active !== 'function' || !og2Active() || !og2State()) return '';
  const decls = ((og2State().registry.nodeTypes || {})[n.type] || {}).props || {};
  const parts = [];
  for (const [key, value] of Object.entries(n.props)) {
    if (value === undefined || value === null) continue;
    if (pseudonymizationEnabled && !(decls[key] && decls[key].nonSensitive === true)) continue;
    parts.push(String(value).toLowerCase());
  }
  return parts.join(' ');
}

export function matchesWordPrefixes(termWords, text) {
  if (termWords.length === 0) return false;
  if (termWords.length === 1) return text.includes(termWords[0]);
  const textWords = text.split(/\s+/);
  const used = new Uint8Array(textWords.length);
  for (const tw of termWords) {
    let found = false;
    for (let i = 0; i < textWords.length; i++) {
      if (!used[i] && textWords[i].startsWith(tw)) { used[i] = 1; found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

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
    list.replaceChildren(createComboHint(`Mindestens ${MIN_SEARCH_LENGTH} Zeichen eingeben...`));
    list.hidden = false;
    filteredItems = [];
    activeIndex = -1;
    return;
  }
  
  // Fast filtering with early termination
  // Suche nach Display-Labels (pseudonymisiert wenn aktiv) und IDs [SF]
  const termWords = term.split(/\s+/).filter(Boolean);
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
    // E60: raw node ids identify (emails, name slugs) - in pseudo mode the
    // search runs over pseudo labels and nonSensitive values only.
    const idStr = pseudonymizationEnabled ? '' : String(n.id).toLowerCase();
    if (matchesWordPrefixes(termWords, displayLabel) || (idStr && idStr.includes(term))
      || comboPropText(n).includes(term)) {
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
    // E60/E48 fail-closed: raw node ids identify — never shown in pseudo mode.
    li.textContent = pseudonymizationEnabled ? displayLbl : `${displayLbl} — ${n.id}`;
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
    frag.appendChild(createComboHint(`Nur erste ${MAX_DROPDOWN_ITEMS} Ergebnisse angezeigt. Suchbegriff verfeinern...`, { more: true }));
  }
  
  list.appendChild(frag);
  list.hidden = filteredItems.length === 0;
}

// Informational entry of the search dropdown (.combo-hint; more = truncation notice)
export function createComboHint(text, { more = false } = {}) {
  const li = document.createElement('li');
  li.className = more ? 'combo-hint combo-hint--more' : 'combo-hint';
  li.textContent = text;
  return li;
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
