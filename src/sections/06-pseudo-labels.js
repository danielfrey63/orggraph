async function loadPseudoData() {
  try {
    // 1) IndexedDB (standalone persistence)
    const storedPseudo = await getStoredJson(KEY_PSEUDO);
    if (storedPseudo) {
      pseudoData = storedPseudo;
      Logger.log('[Pseudo] Daten aus IndexedDB geladen');
      return true;
    }
    // 2) fetch fallback (dev server)
    const res = await fetch('./pseudo.data.json', { cache: 'no-store' });
    if (!res.ok) {
      Logger.log('[Pseudo] Konnte pseudo.data.json nicht laden:', res.status);
      return false;
    }
    pseudoData = await res.json();
    Logger.log('[Pseudo] Daten geladen:', {
      names: pseudoData.names?.length || 0,
      orgLevels: Object.keys(pseudoData).filter(k => k.startsWith('organizationalUnits')).length
    });
    return true;
  } catch (e) {
    Logger.log('[Pseudo] Fehler beim Laden:', e);
    pseudoData = null;
    return false;
  }
}

/**
 * Holt ein Pseudonym für einen Personennamen (konsistentes Mapping)
 */
function getPseudoName(originalName) {
  if (!pseudoData?.names?.length) return originalName;
  
  const key = String(originalName);
  if (pseudoNameMapping.has(key)) {
    return pseudoNameMapping.get(key);
  }
  
  // Neues Mapping erstellen
  const pseudoName = pseudoData.names[pseudoNameIndex % pseudoData.names.length];
  pseudoNameIndex++;
  pseudoNameMapping.set(key, pseudoName);
  return pseudoName;
}

/**
 * Holt ein Pseudonym für eine OE basierend auf ihrem Level (konsistentes Mapping)
 */
function getPseudoOrgLabel(originalLabel, level) {
  if (!pseudoData) return originalLabel;
  
  const key = String(originalLabel);
  if (pseudoOrgMapping.has(key)) {
    return pseudoOrgMapping.get(key);
  }
  
  // Level-basierte OE-Liste finden
  const levelKey = `organizationalUnits${level}`;
  const orgList = pseudoData[levelKey];
  
  if (!orgList?.length) {
    // Fallback: höchstes verfügbares Level verwenden
    const availableLevels = Object.keys(pseudoData)
      .filter(k => k.startsWith('organizationalUnits'))
      .map(k => parseInt(k.replace('organizationalUnits', '')))
      .sort((a, b) => b - a);
    
    if (availableLevels.length === 0) return originalLabel;
    
    const fallbackLevel = availableLevels.find(l => l <= level) ?? availableLevels[0];
    const fallbackKey = `organizationalUnits${fallbackLevel}`;
    const fallbackList = pseudoData[fallbackKey];
    if (!fallbackList?.length) return originalLabel;
    
    const idx = pseudoOrgIndices.get(fallbackLevel) || 0;
    const pseudoOrg = fallbackList[idx % fallbackList.length];
    pseudoOrgIndices.set(fallbackLevel, idx + 1);
    pseudoOrgMapping.set(key, pseudoOrg.name);
    return pseudoOrg.name;
  }
  
  // Neues Mapping erstellen
  const idx = pseudoOrgIndices.get(level) || 0;
  const pseudoOrg = orgList[idx % orgList.length];
  pseudoOrgIndices.set(level, idx + 1);
  pseudoOrgMapping.set(key, pseudoOrg.name);
  return pseudoOrg.name;
}

/**
 * Gibt das anzuzeigende Label für einen Knoten zurück (Person oder OE)
 * @param {Object} node - Der Knoten mit id, label, type
 * @param {number} [level] - Optional: OE-Level für level-basierte Pseudonyme
 */
function getDisplayLabel(node, level) {
  if (!node) return '';
  
  const originalLabel = node.label || node.id || '';
  
  // Wenn Pseudonymisierung deaktiviert, Original zurückgeben
  if (!pseudonymizationEnabled || !pseudoData) {
    return originalLabel;
  }
  
  // Personen pseudonymisieren
  if (node.type === 'person') {
    return getPseudoName(originalLabel);
  }
  
  // OEs pseudonymisieren
  if (node.type === 'org') {
    const orgLevel = (level !== undefined) ? level : orgDepth(node.id);
    return getPseudoOrgLabel(originalLabel, orgLevel);
  }
  
  return originalLabel;
}

/**
 * Gibt das anzuzeigende Label für eine OE-ID zurück
 */
function getDisplayOrgLabel(orgId) {
  const node = byId.get(String(orgId));
  if (!node) return orgId;
  return getDisplayLabel(node, orgDepth(orgId));
}

/**
 * Aktualisiert alle sichtbaren Labels nach Pseudonymisierungs-Toggle
 */
function refreshAllLabels() {
  const svg = d3.select('#graph');
  
  // Node-Labels aktualisieren
  svg.selectAll('.node text.label').text(d => {
    if (debugMode) {
      return `(${Math.round(d.x || 0)}, ${Math.round(d.y || 0)})`;
    }
    return getDisplayLabel(d);
  });
  
  // OE-Legende aktualisieren
  const legendChips = document.querySelectorAll('#legend .legend-label-chip');
  legendChips.forEach(chip => {
    const li = chip.closest('li');
    if (li?.dataset?.oid) {
      const node = byId.get(li.dataset.oid);
      if (node) {
        const label = getDisplayLabel(node, orgDepth(li.dataset.oid));
        chip.textContent = label;
        chip.title = label;
      }
    }
  });
  
  // Hidden-Legende aktualisieren
  const hiddenChips = document.querySelectorAll('#hiddenLegend .legend-label-chip');
  hiddenChips.forEach(chip => {
    const rootId = chip.dataset.rootId;
    if (rootId) {
      const node = byId.get(rootId);
      const setIds = hiddenByRoot.get(rootId);
      const count = setIds ? setIds.size : 0;
      const label = getDisplayLabel(node);
      chip.textContent = `${label} (${count})`;
      chip.title = label;
    }
  });
  
  // Such-Input aktualisieren (falls ein Knoten ausgewählt ist)
  const input = document.querySelector(INPUT_COMBO_ID);
  if (input && currentSelectedId) {
    const node = byId.get(String(currentSelectedId));
    if (node) {
      input.value = getDisplayLabel(node);
    }
  }
  
  // Tooltip ausblenden (wird beim nächsten Hover neu generiert)
  hideTooltip();
  
  Logger.log('[Pseudo] Labels aktualisiert, enabled:', pseudonymizationEnabled);
}

/**
 * Zeigt einen Passwort-Dialog für De-Pseudonymisierung [SF][SFT]
 * @param {Function} onSubmit - Callback mit eingegebenem Passwort
 */
