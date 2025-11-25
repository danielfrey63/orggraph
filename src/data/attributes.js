/**
 * Attribut-Verarbeitungs-System [SF][DRY]
 * Verwaltet das Laden, Parsen und Zuordnen von Attributen.
 */

import { Logger } from '../utils/logger.js';

// Attribut-State
let personAttributes = new Map();
let attributeTypes = new Map();
let activeAttributes = new Set();
let emptyCategories = new Set();
let categorySourceFiles = new Map();
let modifiedCategories = new Set();
let hiddenCategories = new Set();
let collapsedCategories = new Set();

/**
 * Parst eine Attribut-Liste aus Text [SF]
 * @param {string} text - Roher Text
 * @returns {Object} { attributes, types, count, isEmpty, hasTabFormat }
 */
export function parseAttributeList(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const attributes = new Map();
  const types = new Set();
  let count = 0;
  
  // Format erkennen (Tab oder Komma)
  const hasTabFormat = lines.some(l => l.includes('\t'));
  const separator = hasTabFormat ? '\t' : ',';
  
  for (const line of lines) {
    const parts = line.split(separator).map(p => p.trim());
    if (parts.length < 2) continue;
    
    const [identifier, ...rest] = parts;
    if (!identifier) continue;
    
    // Attributname und Wert extrahieren
    let attrName, attrValue;
    if (rest.length >= 2) {
      attrName = rest[0];
      attrValue = rest[1] || '1';
    } else {
      attrName = rest[0];
      attrValue = '1';
    }
    
    if (!attrName) continue;
    
    if (!attributes.has(identifier)) {
      attributes.set(identifier, new Map());
    }
    attributes.get(identifier).set(attrName, attrValue);
    types.add(attrName);
    count++;
  }
  
  return {
    attributes,
    types,
    count,
    isEmpty: count === 0,
    hasTabFormat
  };
}

/**
 * Extrahiert Kategorie aus URL [SF]
 * @param {string} url - Attribut-URL
 * @returns {string} Kategoriename
 */
export function categoryFromUrl(url) {
  const filename = url.split('/').pop() || url;
  return filename.replace(/\.[^/.]+$/, '');
}

/**
 * Generiert eine Farbe für ein Attribut [SF]
 * @param {string} attrName - Attributname
 * @returns {string} HSL-Farbe
 */
export function generateAttributeColor(attrName) {
  const hash = hashCode(attrName);
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Einfache Hash-Funktion [SF]
 * @param {string} str - String
 * @returns {number} Hash-Wert
 */
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

/**
 * Lädt Attribute von einer URL [SF][REH]
 * @param {string} url - Attribut-URL
 * @returns {Promise<Object>} Ergebnis
 */
export async function loadAttributesFromUrl(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const text = await res.text();
    const { attributes, types, count, isEmpty } = parseAttributeList(text);
    const category = categoryFromUrl(url);
    
    Logger.log(`[Attributes] Geladen von ${url}: ${count} Einträge`);
    
    return {
      loaded: true,
      category,
      attributes,
      types,
      count,
      isEmpty,
      originalText: text
    };
  } catch (e) {
    Logger.warn(`[Attributes] Fehler beim Laden von ${url}:`, e.message);
    return { loaded: false, error: e.message };
  }
}

/**
 * Berechnet Levenshtein-Distanz [SF]
 * @param {string} a - String A
 * @param {string} b - String B
 * @returns {number} Distanz
 */
export function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  
  const d = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  
  return d[m][n];
}

/**
 * Normalisierte Ähnlichkeit [SF]
 * @param {string} a - String A
 * @param {string} b - String B
 * @returns {number} Ähnlichkeit (0-1)
 */
export function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// Getter/Setter für State
export function getPersonAttributes() { return personAttributes; }
export function setPersonAttributes(attrs) { personAttributes = attrs; }
export function getAttributeTypes() { return attributeTypes; }
export function setAttributeTypes(types) { attributeTypes = types; }
export function getActiveAttributes() { return activeAttributes; }
export function setActiveAttributes(attrs) { activeAttributes = attrs; }
export function getEmptyCategories() { return emptyCategories; }
export function setEmptyCategories(cats) { emptyCategories = cats; }
export function getCategorySourceFiles() { return categorySourceFiles; }
export function setCategorySourceFiles(files) { categorySourceFiles = files; }
export function getModifiedCategories() { return modifiedCategories; }
export function setModifiedCategories(cats) { modifiedCategories = cats; }
export function getHiddenCategories() { return hiddenCategories; }
export function setHiddenCategories(cats) { hiddenCategories = cats; }
export function getCollapsedCategories() { return collapsedCategories; }
export function setCollapsedCategories(cats) { collapsedCategories = cats; }

export default {
  parseAttributeList,
  categoryFromUrl,
  generateAttributeColor,
  loadAttributesFromUrl,
  levenshteinDistance,
  similarity,
  getPersonAttributes,
  setPersonAttributes,
  getAttributeTypes,
  setAttributeTypes,
  getActiveAttributes,
  setActiveAttributes
};
