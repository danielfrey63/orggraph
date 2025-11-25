/**
 * Pseudonymisierungs-System [SF][SFT]
 * Verwaltet die Pseudonymisierung von Namen und Organisationseinheiten.
 */

import { Logger } from '../utils/logger.js';

// Pseudonymisierungs-State
let pseudoData = null;
let pseudonymizationEnabled = true;
let nameIndex = 0;
const nameMapping = new Map();
const orgMapping = new Map();
const orgIndices = new Map();

/**
 * Lädt Pseudonymisierungsdaten [SF][REH]
 * @returns {Promise<boolean>} true wenn erfolgreich
 */
export async function loadPseudoData() {
  try {
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
    Logger.log('[Pseudo] Fehler beim Laden:', e.message);
    return false;
  }
}

/**
 * Gibt ein Pseudonym für einen Namen zurück [SF]
 * @param {string} realName - Echter Name
 * @returns {string} Pseudonym
 */
export function getPseudoName(realName) {
  if (!pseudoData?.names?.length) return realName;
  
  const key = String(realName).toLowerCase().trim();
  if (nameMapping.has(key)) return nameMapping.get(key);
  
  const pseudo = pseudoData.names[nameIndex % pseudoData.names.length];
  nameIndex++;
  nameMapping.set(key, pseudo);
  return pseudo;
}

/**
 * Gibt ein Pseudonym für eine OE zurück [SF]
 * @param {string} realLabel - Echtes Label
 * @param {number} depth - Hierarchietiefe
 * @returns {string} Pseudonym
 */
export function getPseudoOrgLabel(realLabel, depth = 0) {
  const levelKey = `organizationalUnitsLevel${depth}`;
  const orgList = pseudoData?.[levelKey] || pseudoData?.organizationalUnitsLevel0 || [];
  
  if (!orgList.length) return realLabel;
  
  const key = `${depth}::${String(realLabel).toLowerCase().trim()}`;
  if (orgMapping.has(key)) return orgMapping.get(key);
  
  if (!orgIndices.has(depth)) orgIndices.set(depth, 0);
  const idx = orgIndices.get(depth);
  const pseudo = orgList[idx % orgList.length];
  orgIndices.set(depth, idx + 1);
  orgMapping.set(key, pseudo);
  return pseudo;
}

/**
 * Gibt das anzuzeigende Label für einen Knoten zurück [SF]
 * @param {Object} node - Knoten-Objekt
 * @param {number} depth - Hierarchietiefe (für OEs)
 * @returns {string} Anzuzeigendes Label
 */
export function getDisplayLabel(node, depth = 0) {
  if (!node) return '';
  const realLabel = node.label || node.name || String(node.id);
  
  if (!pseudonymizationEnabled) return realLabel;
  
  if (node.type === 'org') {
    return getPseudoOrgLabel(realLabel, depth);
  }
  return getPseudoName(realLabel);
}

/**
 * Setzt den Pseudonymisierungs-Status [SF]
 * @param {boolean} enabled - Aktiviert/Deaktiviert
 */
export function setPseudonymizationEnabled(enabled) {
  pseudonymizationEnabled = !!enabled;
}

/**
 * Gibt den Pseudonymisierungs-Status zurück [SF]
 * @returns {boolean}
 */
export function isPseudonymizationEnabled() {
  return pseudonymizationEnabled;
}

/**
 * Setzt die Pseudonymisierungs-Mappings zurück [SF]
 */
export function resetPseudoMappings() {
  nameIndex = 0;
  nameMapping.clear();
  orgMapping.clear();
  orgIndices.clear();
}

export default {
  loadPseudoData,
  getPseudoName,
  getPseudoOrgLabel,
  getDisplayLabel,
  setPseudonymizationEnabled,
  isPseudonymizationEnabled,
  resetPseudoMappings
};
