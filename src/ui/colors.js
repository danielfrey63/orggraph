/**
 * Farb-Utilities [SF][DRY]
 * Hilfsfunktionen für Farbberechnungen.
 */

// Cache für Kategorie-Hues
const categoryHueCache = new Map();

/**
 * Einfache Hash-Funktion [SF]
 * @param {string} str - String
 * @returns {number} Hash-Wert
 */
export function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

/**
 * Berechnet quantisierten Hue für eine Kategorie [SF]
 * @param {string} category - Kategoriename
 * @returns {number} Hue-Wert (0-360)
 */
export function quantizedHueFromCategory(category) {
  if (categoryHueCache.has(category)) return categoryHueCache.get(category);
  
  const rawHue = Math.abs(hashCode(String(category))) % 360;
  const step = 40;
  const hue = (Math.round(rawHue / step) * step) % 360;
  categoryHueCache.set(category, hue);
  return hue;
}

/**
 * Generiert Farbe für Kategorie-Attribut [DRY]
 * @param {string} category - Kategoriename
 * @param {string} attrName - Attributname
 * @param {number} ordinal - Ordinalzahl
 * @returns {string} HSL-Farbe
 */
export function colorForCategoryAttribute(category, attrName, ordinal) {
  const baseHue = quantizedHueFromCategory(category);
  const localShift = (ordinal % 6) * 10;
  const hue = (baseHue + localShift) % 360;
  const sat = 65;
  const light = 50 + ((ordinal % 2) ? 5 : 0);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * Konvertiert eine Farbe in transparentes Format [DRY]
 * @param {string} color - Farbe im HSL-Format
 * @param {number} alpha - Alpha-Wert (0-1)
 * @returns {string} HSLA-Farbe
 */
export function colorToTransparent(color, alpha = 0.25) {
  const hslMatch = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(color);
  if (hslMatch) {
    const h = parseInt(hslMatch[1]);
    const s = parseInt(hslMatch[2]);
    const l = parseInt(hslMatch[3]);
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
  }
  return color;
}

/**
 * Berechnet Farbe für OE basierend auf Tiefe [SF]
 * @param {string} orgId - OE-ID
 * @param {Function} getOrgDepth - Funktion für OE-Tiefe
 * @returns {Object} { stroke, fill }
 */
export function colorForOrg(orgId, getOrgDepth) {
  const depth = getOrgDepth(orgId);
  const hue = (hashCode(String(orgId)) % 360);
  const sat = 60 + (depth * 5);
  const light = 45 + (depth * 3);
  
  const stroke = `hsl(${hue}, ${sat}%, ${light}%)`;
  const fill = colorToTransparent(stroke, 0.15);
  
  return { stroke, fill };
}

/**
 * Berechnet Knotenfüllung basierend auf Level [SF]
 * @param {number} level - Hierarchie-Level
 * @param {Object} colors - Farbobjekt mit topLevel, midLevel, lowLevel
 * @returns {string} Farbe
 */
export function getNodeFillByLevel(level, colors = {}) {
  const { topLevel = '#4CAF50', midLevel = '#2196F3', lowLevel = '#9E9E9E' } = colors;
  
  if (level === 0) return topLevel;
  if (level <= 2) return midLevel;
  return lowLevel;
}

export default {
  hashCode,
  quantizedHueFromCategory,
  colorForCategoryAttribute,
  colorToTransparent,
  colorForOrg,
  getNodeFillByLevel
};
