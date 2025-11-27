/**
 * Farb-Utilities [SF][DRY]
 * Hilfsfunktionen für Farbberechnungen.
 */

// Cache für Kategorie-Hues
const categoryHueCache = new Map();

// Aktuelle Farbpalette
let currentPalette = 'blue';

/**
 * Erzeugt eine Spektrum-Palette mit 5 Farben [SF][DRY]
 * @param {number} startHue - Start-Hue (0-360)
 * @param {number} range - Hue-Bereich (z.B. 40 für ähnliche Farben)
 * @param {string} name - Paletten-Name
 * @param {string} description - Beschreibung
 * @returns {Object} Palette-Objekt
 */
function createSpectrumPalette(startHue, range, name, description) {
  return {
    name,
    description,
    getColor: (_category, ordinal) => {
      const step = range / 5;
      const hue = (startHue + (ordinal % 5) * step) % 360;
      const sat = 70;
      const light = 45 + (ordinal % 3) * 5;
      return `hsl(${hue}, ${sat}%, ${light}%)`;
    }
  };
}

/**
 * Vordefinierte Farbpaletten [SF][CMV]
 * 10 Spektrum-Paletten mit je 5 ähnlichen Farben
 */
export const COLOR_PALETTES = {
  red: createSpectrumPalette(0, 30, 'Rot', 'Rottöne (0°-30°)'),
  orange: createSpectrumPalette(25, 30, 'Orange', 'Orangetöne (25°-55°)'),
  yellow: createSpectrumPalette(45, 30, 'Gelb', 'Gelbtöne (45°-75°)'),
  lime: createSpectrumPalette(75, 30, 'Limette', 'Limettentöne (75°-105°)'),
  green: createSpectrumPalette(105, 30, 'Grün', 'Grüntöne (105°-135°)'),
  teal: createSpectrumPalette(165, 30, 'Türkis', 'Türkistöne (165°-195°)'),
  blue: createSpectrumPalette(210, 30, 'Blau', 'Blautöne (210°-240°)'),
  purple: createSpectrumPalette(270, 30, 'Violett', 'Violetttöne (270°-300°)'),
  pink: createSpectrumPalette(320, 30, 'Pink', 'Pinktöne (320°-350°)'),
  gray: {
    name: 'Grau',
    description: 'Graustufen',
    getColor: (_category, ordinal) => {
      const light = 35 + (ordinal % 5) * 10;
      return `hsl(0, 0%, ${light}%)`;
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
