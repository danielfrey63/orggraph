/**
 * CSS-Variable-Helpers [PA][DRY]
 * Gecachte CSS-Variablen-Abfragen für Performance-Optimierung.
 */

// Cache für CSS-Variablen
const cssCache = new Map();
let cacheValid = false;

// Liste aller zu cachenden CSS-Variablen
const CSS_VARS = [
  '--node-radius',
  '--node-stroke-width',
  '--node-fill',
  '--node-stroke',
  '--node-fill-top-level',
  '--node-fill-mid-level',
  '--node-fill-low-level',
  '--node-with-attributes-stroke-width',
  '--node-with-attributes-fill',
  '--node-with-attributes-stroke',
  '--nodes-without-attributes-opacity',
  '--root-node-stroke',
  '--root-node-stroke-width',
  '--link-distance',
  '--link-strength',
  '--link-stroke',
  '--link-stroke-width',
  '--link-opacity',
  '--charge-strength',
  '--alpha-decay',
  '--velocity-decay',
  '--collide-padding',
  '--cluster-pad',
  '--cluster-fill',
  '--cluster-stroke',
  '--cluster-opacity',
  '--attribute-circle-gap',
  '--attribute-circle-stroke-width',
  '--arrow-length',
  '--canvas-bg',
  '--collide-strength',
  '--center-strength',
  '--level-height',
  '--level-force-strength'
];

/**
 * Invalidiert den CSS-Cache (bei Theme-Wechsel aufrufen) [SF]
 */
export function invalidateCSSCache() {
  cacheValid = false;
  cssCache.clear();
}

/**
 * Aktualisiert den gesamten Cache [PA]
 */
function refreshCache() {
  if (typeof document === 'undefined') return;
  
  const style = getComputedStyle(document.documentElement);
  
  for (const varName of CSS_VARS) {
    const value = style.getPropertyValue(varName);
    const numValue = parseFloat(value);
    cssCache.set(varName, Number.isFinite(numValue) ? numValue : value.trim());
  }
  
  cacheValid = true;
}

/**
 * Holt einen CSS-Variablenwert als Zahl (gecacht) [PA][DRY]
 * @param {string} varName - CSS-Variablenname (z.B. '--node-radius')
 * @param {number} fallback - Fallback-Wert wenn Variable nicht existiert
 * @returns {number} Der numerische Wert
 */
export function cssNumber(varName, fallback) {
  if (!cacheValid) {
    refreshCache();
  }
  
  const cached = cssCache.get(varName);
  if (typeof cached === 'number') {
    return cached;
  }
  
  // Fallback: Direkt abfragen (für nicht-gecachte Variablen)
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  
  return fallback;
}

/**
 * Holt einen CSS-Variablenwert als String (gecacht) [PA][DRY]
 * @param {string} varName - CSS-Variablenname
 * @param {string} fallback - Fallback-Wert
 * @returns {string} Der String-Wert
 */
export function cssString(varName, fallback = '') {
  if (!cacheValid) {
    refreshCache();
  }
  
  const cached = cssCache.get(varName);
  if (cached !== undefined) {
    return String(cached);
  }
  
  // Fallback: Direkt abfragen
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
    return v.trim() || fallback;
  }
  
  return fallback;
}

/**
 * Batch-Abfrage mehrerer CSS-Variablen [PA]
 * @param {Object} varsWithDefaults - Objekt mit {varName: defaultValue}
 * @returns {Object} Objekt mit den Werten
 */
export function cssNumberBatch(varsWithDefaults) {
  if (!cacheValid) {
    refreshCache();
  }
  
  const result = {};
  for (const [varName, defaultValue] of Object.entries(varsWithDefaults)) {
    result[varName] = cssNumber(varName, defaultValue);
  }
  return result;
}

/**
 * Holt alle Styling-Parameter für Nodes auf einmal [PA][DRY]
 * @returns {Object} Alle Node-bezogenen CSS-Werte
 */
export function getNodeStyleParams() {
  return {
    radius: cssNumber('--node-radius', 8),
    strokeWidth: cssNumber('--node-stroke-width', 3),
    attrCircleGap: cssNumber('--attribute-circle-gap', 4),
    attrCircleWidth: cssNumber('--attribute-circle-stroke-width', 2),
    attrStrokeWidth: cssNumber('--node-with-attributes-stroke-width', 3),
    collidePadding: cssNumber('--collide-padding', 6),
    noAttrOpacity: cssNumber('--nodes-without-attributes-opacity', 0.2)
  };
}

/**
 * Holt alle Styling-Parameter für Links auf einmal [PA][DRY]
 * @returns {Object} Alle Link-bezogenen CSS-Werte
 */
export function getLinkStyleParams() {
  return {
    distance: cssNumber('--link-distance', 60),
    strength: cssNumber('--link-strength', 0.4),
    arrowLength: cssNumber('--arrow-length', 10),
    strokeWidth: cssNumber('--link-stroke-width', 3)
  };
}

/**
 * Holt alle Simulation-Parameter auf einmal [PA][DRY]
 * @returns {Object} Alle Simulation-bezogenen CSS-Werte
 */
export function getSimulationParams() {
  return {
    linkDistance: cssNumber('--link-distance', 10),
    linkStrength: cssNumber('--link-strength', 0.1),
    chargeStrength: cssNumber('--charge-strength', -90),
    alphaDecay: cssNumber('--alpha-decay', 0.0228),
    velocityDecay: cssNumber('--velocity-decay', 0.4),
    centerStrength: cssNumber('--center-strength', 0.05),
    levelHeight: cssNumber('--level-height', 200),
    levelForceStrength: cssNumber('--level-force-strength', 0.5)
  };
}

export default {
  cssNumber,
  cssString,
  cssNumberBatch,
  invalidateCSSCache,
  getNodeStyleParams,
  getLinkStyleParams,
  getSimulationParams
};
