/**
 * Farb-Utilities [SF][DRY]
 * Hilfsfunktionen für Farbberechnungen.
 */

// Cache für Kategorie-Hues
const categoryHueCache = new Map();

// Aktuelle Farbpalette
let currentPalette = 'blue';

/**
 * Erzeugt eine Spektrum-Palette mit gut unterscheidbaren Farben [SF][DRY]
 * @param {number} startHue - Start-Hue (0-360)
 * @param {number} range - Hue-Bereich (z.B. 50 für unterscheidbare Farben)
 * @param {string} name - Paletten-Name
 * @param {string} description - Beschreibung
 * @returns {Object} Palette-Objekt
 */
function createSpectrumPalette(startHue, range, name, description) {
  // Vordefinierte Variationen für bessere Unterscheidbarkeit [SF]
  const variations = [
    { hueOffset: 0, sat: 75, light: 45 },      // Dunkel, gesättigt
    { hueOffset: 0.5, sat: 65, light: 60 },    // Hell, mittel gesättigt
    { hueOffset: 0.25, sat: 80, light: 35 },   // Sehr dunkel, sehr gesättigt
    { hueOffset: 0.75, sat: 55, light: 55 },   // Mittel, weniger gesättigt
    { hueOffset: 1, sat: 70, light: 50 },      // Ende des Bereichs
  ];
  
  return {
    name,
    description,
    getColor: (_category, ordinal) => {
      const idx = ordinal % variations.length;
      const v = variations[idx];
      const hue = (startHue + v.hueOffset * range) % 360;
      return `hsl(${hue}, ${v.sat}%, ${v.light}%)`;
    }
  };
}

/**
 * Vordefinierte Farbpaletten [SF][CMV]
 * 10 Spektrum-Paletten mit gut unterscheidbaren Farben
 */
export const COLOR_PALETTES = {
  red: createSpectrumPalette(350, 40, 'Rot', 'Rottöne'),
  orange: createSpectrumPalette(20, 40, 'Orange', 'Orangetöne'),
  yellow: createSpectrumPalette(40, 40, 'Gelb', 'Gelbtöne'),
  lime: createSpectrumPalette(80, 40, 'Limette', 'Limettentöne'),
  green: createSpectrumPalette(110, 40, 'Grün', 'Grüntöne'),
  teal: createSpectrumPalette(170, 40, 'Türkis', 'Türkistöne'),
  blue: createSpectrumPalette(210, 40, 'Blau', 'Blautöne'),
  purple: createSpectrumPalette(270, 40, 'Violett', 'Violetttöne'),
  pink: createSpectrumPalette(320, 40, 'Pink', 'Pinktöne'),
  gray: {
    name: 'Grau',
    description: 'Graustufen',
    getColor: (_category, ordinal) => {
      // Bessere Unterscheidbarkeit bei Graustufen [SF]
      const lights = [30, 45, 55, 40, 65];
      return `hsl(0, 0%, ${lights[ordinal % 5]}%)`;
    }
  }
};

/**
 * Setzt die aktuelle Farbpalette [SF]
 * @param {string} paletteId - ID der Palette
 */
export function setColorPalette(paletteId) {
  if (COLOR_PALETTES[paletteId]) {
    currentPalette = paletteId;
    categoryHueCache.clear(); // Cache leeren bei Palettenwechsel
  }
}

/**
 * Gibt die aktuelle Palette zurück [SF]
 * @returns {string} Palette-ID
 */
export function getCurrentPalette() {
  return currentPalette;
}

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
 * Verwendet die aktuell ausgewählte Farbpalette
 * @param {string} category - Kategoriename
 * @param {string} attrName - Attributname
 * @param {number} ordinal - Ordinalzahl
 * @returns {string} Farbe (HSL oder HEX)
 */
export function colorForCategoryAttribute(category, attrName, ordinal) {
  const palette = COLOR_PALETTES[currentPalette];
  if (palette && palette.getColor) {
    return palette.getColor(category, ordinal);
  }
  // Fallback auf Standard
  const baseHue = quantizedHueFromCategory(category);
  const localShift = (ordinal % 6) * 10;
  const hue = (baseHue + localShift) % 360;
  const sat = 65;
  const light = 50 + ((ordinal % 2) ? 5 : 0);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * Konvertiert eine Farbe in transparentes Format [DRY]
 * Unterstützt HSL und HEX-Farben
 * @param {string} color - Farbe im HSL- oder HEX-Format
 * @param {number} alpha - Alpha-Wert (0-1)
 * @returns {string} HSLA- oder RGBA-Farbe
 */
export function colorToTransparent(color, alpha = 0.25) {
  // HSL-Format
  const hslMatch = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(color);
  if (hslMatch) {
    const h = parseInt(hslMatch[1]);
    const s = parseInt(hslMatch[2]);
    const l = parseInt(hslMatch[3]);
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
  }
  
  // HEX-Format (#RGB oder #RRGGBB)
  const hexMatch = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.exec(color);
  if (hexMatch) {
    let hex = hexMatch[1];
    // Erweitere 3-stelliges HEX zu 6-stellig
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  getNodeFillByLevel,
  COLOR_PALETTES,
  setColorPalette,
  getCurrentPalette
};
