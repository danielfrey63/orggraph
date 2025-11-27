/**
 * CSS-Variable-Helpers [PA][DRY]
 * Gecachte CSS-Variablen-Abfragen für Performance-Optimierung.
 * Zentraler Parameter-Store für Graph-Parameter.
 */

// Cache für CSS-Variablen
const cssCache = new Map();
let cacheValid = false;

// Zentraler Parameter-Store für Runtime-Werte [SF][DRY]
// Diese Werte werden von Slidern/ENV gesetzt und überschreiben CSS-Defaults
const graphParams = {
  // Simulation
  linkDistance: null,
  linkStrength: null,
  chargeStrength: null,
  alphaDecay: null,
  velocityDecay: null,
  // Visuals
  nodeRadius: null,
  nodeStrokeWidth: null,
  labelFontSize: null,
  linkStrokeWidth: null,
  arrowSize: null
};

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
  '--root-node-fill',
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
 * Nutzt zentralen Store für konfigurierbare Parameter.
 * @returns {Object} Alle Node-bezogenen CSS-Werte
 */
export function getNodeStyleParams() {
  return {
    radius: getGraphParam('nodeRadius'),
    strokeWidth: getGraphParam('nodeStrokeWidth'),
    attrCircleGap: cssNumber('--attribute-circle-gap', 4),
    attrCircleWidth: getGraphParam('nodeStrokeWidth'), // Ring-Breite = Border-Breite [SF]
    attrStrokeWidth: cssNumber('--node-with-attributes-stroke-width', 3),
    collidePadding: cssNumber('--collide-padding', 6),
    noAttrOpacity: cssNumber('--nodes-without-attributes-opacity', 0.2)
  };
}

/**
 * Holt alle Styling-Parameter für Links auf einmal [PA][DRY]
 * Nutzt zentralen Store für konfigurierbare Parameter.
 * @returns {Object} Alle Link-bezogenen CSS-Werte
 */
export function getLinkStyleParams() {
  return {
    distance: getGraphParam('linkDistance'),
    strength: getGraphParam('linkStrength'),
    arrowLength: getGraphParam('arrowSize'),
    strokeWidth: getGraphParam('linkStrokeWidth')
  };
}

/**
 * Holt alle Simulation-Parameter auf einmal [PA][DRY]
 * Nutzt zentralen Store für konfigurierbare Parameter.
 * @returns {Object} Alle Simulation-bezogenen CSS-Werte
 */
export function getSimulationParams() {
  return {
    linkDistance: getGraphParam('linkDistance'),
    linkStrength: getGraphParam('linkStrength'),
    chargeStrength: getGraphParam('chargeStrength'),
    alphaDecay: getGraphParam('alphaDecay'),
    velocityDecay: getGraphParam('velocityDecay'),
    centerStrength: cssNumber('--center-strength', 0.05),
    levelHeight: cssNumber('--level-height', 200),
    levelForceStrength: cssNumber('--level-force-strength', 0.5)
  };
}

// Mapping von Parameter-Namen zu CSS-Variablen und Defaults [CMV]
const PARAM_CONFIG = {
  linkDistance: { cssVar: '--link-distance', default: 10 },
  linkStrength: { cssVar: '--link-strength', default: 0.1 },
  chargeStrength: { cssVar: '--charge-strength', default: -90 },
  alphaDecay: { cssVar: '--alpha-decay', default: 0.0228 },
  velocityDecay: { cssVar: '--velocity-decay', default: 0.4 },
  nodeRadius: { cssVar: '--node-radius', default: 8 },
  nodeStrokeWidth: { cssVar: '--node-stroke-width', default: 3 },
  labelFontSize: { cssVar: '--label-font-size', default: 12 },
  linkStrokeWidth: { cssVar: '--link-stroke-width', default: 1.5 },
  arrowSize: { cssVar: '--arrow-length', default: 8 }
};

/**
 * Setzt einen Graph-Parameter [SF]
 * @param {string} name - Parameter-Name
 * @param {number} value - Neuer Wert
 */
export function setGraphParam(name, value) {
  if (name in graphParams) {
    graphParams[name] = value;
  }
}

/**
 * Holt einen Graph-Parameter [SF][DRY]
 * Priorität: 1. Runtime-Wert (Slider/ENV), 2. CSS-Variable, 3. Default
 * @param {string} name - Parameter-Name
 * @returns {number} Der aktuelle Wert
 */
export function getGraphParam(name) {
  // Runtime-Wert hat Priorität
  if (graphParams[name] !== null) {
    return graphParams[name];
  }
  // Fallback auf CSS/Default
  const config = PARAM_CONFIG[name];
  if (config) {
    return cssNumber(config.cssVar, config.default);
  }
  return 0;
}

/**
 * Holt alle Graph-Parameter [SF][DRY]
 * @returns {Object} Alle Parameter mit aktuellen Werten
 */
export function getAllGraphParams() {
  const result = {};
  for (const name of Object.keys(PARAM_CONFIG)) {
    result[name] = getGraphParam(name);
  }
  return result;
}

/**
 * Initialisiert Graph-Parameter aus ENV-Config [SF]
 * @param {Object} envConfig - ENV-Konfiguration
 */
export function initGraphParamsFromEnv(envConfig) {
  if (!envConfig) return;
  
  const envMapping = {
    DEBUG_LINK_DISTANCE: 'linkDistance',
    DEBUG_LINK_STRENGTH: 'linkStrength',
    DEBUG_CHARGE_STRENGTH: 'chargeStrength',
    DEBUG_ALPHA_DECAY: 'alphaDecay',
    DEBUG_VELOCITY_DECAY: 'velocityDecay',
    DEBUG_NODE_RADIUS: 'nodeRadius',
    DEBUG_NODE_STROKE_WIDTH: 'nodeStrokeWidth',
    DEBUG_LABEL_FONT_SIZE: 'labelFontSize',
    DEBUG_LINK_STROKE_WIDTH: 'linkStrokeWidth',
    DEBUG_ARROW_SIZE: 'arrowSize'
  };
  
  for (const [envKey, paramName] of Object.entries(envMapping)) {
    if (typeof envConfig[envKey] === 'number') {
      graphParams[paramName] = envConfig[envKey];
    }
  }
}

/**
 * Setzt alle Parameter auf CSS-Defaults zurück [SF]
 */
export function resetGraphParams() {
  for (const name of Object.keys(graphParams)) {
    graphParams[name] = null;
  }
}

/**
 * Gibt die Parameter-Konfiguration zurück [SF]
 * @returns {Object} PARAM_CONFIG
 */
export function getParamConfig() {
  return PARAM_CONFIG;
}

export default {
  cssNumber,
  cssString,
  cssNumberBatch,
  invalidateCSSCache,
  getNodeStyleParams,
  getLinkStyleParams,
  getSimulationParams,
  setGraphParam,
  getGraphParam,
  getAllGraphParams,
  initGraphParamsFromEnv,
  resetGraphParams,
  getParamConfig
};
