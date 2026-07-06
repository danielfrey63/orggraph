import { fnv1a64 } from './21-og2-util.js';

export async function loadPseudoData() {
  resetPseudoAssignments();
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

// Pool assignment state, one mapping/index per pool key (generic across
// capability pools; replaces the fixed name/org maps).
let pseudoPoolMappings = new Map();
let pseudoPoolIndices = new Map();

/** Drop all pool assignments (new pseudo data / tenant switch / tests). */
export function resetPseudoAssignments() {
  pseudoPoolMappings = new Map();
  pseudoPoolIndices = new Map();
}

// The tenant's pseudonymize capability of a node's type (FR-8.5): v2 reads
// the tenant registry; the legacy tenant maps its structural tags onto the
// classic pools. The capability only selects the NICER pool — it never
// decides WHETHER masking happens (E48).
export function pseudoCapabilityOf(node) {
  if (typeof og2Active === 'function' && og2Active() && og2State()) {
    const decl = (og2State().registry.nodeTypes || {})[node.type];
    return (decl && decl.pseudonymize) || null;
  }
  if (node.type === 'person') return { pool: 'names' };
  if (node.type === 'org') return { pool: 'organizationalUnits', byLevel: true };
  return null;
}

// Fail-closed generic fallback "<Typname> N" (E48): deterministic and stable
// per identity (id hash) — never the real label, never random.
export function pseudoFallbackLabel(node) {
  // fnv1a64 returns a hex string — reduce to a compact stable number.
  const n = Number(BigInt('0x' + fnv1a64(String(node.id))) % 100000n);
  return `${node.type || 'Knoten'} ${n}`;
}

function poolState(poolKey) {
  if (!pseudoPoolMappings.has(poolKey)) {
    pseudoPoolMappings.set(poolKey, new Map());
    pseudoPoolIndices.set(poolKey, 0);
  }
  return pseudoPoolMappings.get(poolKey);
}

function assignFromPool(poolKey, list, originalKey, nameOf) {
  const mapping = poolState(poolKey);
  if (mapping.has(originalKey)) return mapping.get(originalKey);
  const idx = pseudoPoolIndices.get(poolKey) || 0;
  const entry = list[idx % list.length];
  pseudoPoolIndices.set(poolKey, idx + 1);
  const label = nameOf(entry);
  mapping.set(originalKey, label);
  return label;
}

/** Pseudonym aus einem flachen Pool (konsistentes Mapping). */
export function getPseudoName(originalName, pool = 'names', node = null) {
  const list = pseudoData && pseudoData[pool];
  if (!list?.length) return node ? pseudoFallbackLabel(node) : String(originalName);
  return assignFromPool(pool, list, String(originalName), (e) => (typeof e === 'string' ? e : e.name));
}

/** Pseudonym aus einem level-basierten Pool (konsistentes Mapping). */
export function getPseudoOrgLabel(originalLabel, level, pool = 'organizationalUnits', node = null) {
  const fallback = () => (node ? pseudoFallbackLabel(node) : String(originalLabel));
  if (!pseudoData) return fallback();
  const key = String(originalLabel);
  const mapping = poolState(pool);
  if (mapping.has(key)) return mapping.get(key);

  const pickFrom = (lvl) => {
    const list = pseudoData[`${pool}${lvl}`];
    if (!list?.length) return null;
    const idxKey = `${pool}${lvl}`;
    const idx = pseudoPoolIndices.get(idxKey) || 0;
    pseudoPoolIndices.set(idxKey, idx + 1);
    const entry = list[idx % list.length];
    const label = typeof entry === 'string' ? entry : entry.name;
    mapping.set(key, label);
    return label;
  };

  const direct = pickFrom(level);
  if (direct !== null) return direct;
  // Fallback: nächst-passendes verfügbares Level
  const availableLevels = Object.keys(pseudoData)
    .filter(k => k.startsWith(pool) && /\d+$/.test(k))
    .map(k => parseInt(k.slice(pool.length), 10))
    .sort((a, b) => b - a);
  if (availableLevels.length === 0) return fallback();
  const fallbackLevel = availableLevels.find(l => l <= level) ?? availableLevels[0];
  const picked = pickFrom(fallbackLevel);
  return picked !== null ? picked : fallback();
}

/**
 * Anzuzeigendes Label eines Knotens, capability-getrieben (FR-8.5, E48):
 * Pseudo aktiv => IMMER maskiert — Capability-Pool wenn vorhanden und
 * befüllt, sonst der deterministische Fallback "<Typname> N"; das echte
 * Label erscheint im Pseudo-Modus an keiner Stelle (fail-closed).
 */
export function getDisplayLabel(node, level) {
  if (!node) return '';
  const originalLabel = node.label || node.id || '';
  if (!pseudonymizationEnabled) return originalLabel;

  const cap = pseudoCapabilityOf(node);
  if (!cap || !pseudoData) return pseudoFallbackLabel(node);
  if (cap.byLevel) {
    const lvl = (level !== undefined) ? level : orgDepth(node.id);
    return getPseudoOrgLabel(originalLabel, lvl, cap.pool, node);
  }
  return getPseudoName(originalLabel, cap.pool, node);
}

/**
 * Gibt das anzuzeigende Label für eine OE-ID zurück
 */
export function getDisplayOrgLabel(orgId) {
  const node = byId.get(String(orgId));
  if (!node) return orgId;
  return getDisplayLabel(node, orgDepth(orgId));
}

/**
 * Aktualisiert alle sichtbaren Labels nach Pseudonymisierungs-Toggle
 */
export function refreshAllLabels() {
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
