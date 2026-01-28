/**
 * Zentrale Konfiguration mit ENV-Variablen-Unterstützung [SF][ISA]
 * Alle Konfigurationswerte können über Vite ENV-Variablen überschrieben werden.
 */

/**
 * Liest einen ENV-Wert mit Fallback auf Default
 * @param {string} key - ENV-Variablen-Name (ohne VITE_ Prefix)
 * @param {*} defaultValue - Default-Wert
 * @returns {*} Konfigurationswert
 */
function getEnvValue(key, defaultValue) {
  const envKey = `VITE_${key}`;
  const value = import.meta.env?.[envKey];
  
  if (value === undefined || value === '') {
    return defaultValue;
  }
  
  // Type-Konvertierung basierend auf Default-Wert-Typ
  if (typeof defaultValue === 'boolean') {
    return value === 'true' || value === true;
  }
  if (typeof defaultValue === 'number') {
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }
  if (Array.isArray(defaultValue)) {
    try {
      return JSON.parse(value);
    } catch {
      return defaultValue;
    }
  }
  
  return value;
}

/**
 * Standard-Konfigurationswerte
 */
const DEFAULTS = {
  // Daten-URLs
  DATA_URL: './data.json',
  DATA_ATTRIBUTES_URL: './attributes.txt',
  
  // Toolbar-Defaults
  TOOLBAR_DEPTH_DEFAULT: 2,
  TOOLBAR_DIRECTION_DEFAULT: 'both',
  TOOLBAR_MANAGEMENT_ACTIVE: true,
  TOOLBAR_HIERARCHY_ACTIVE: false,
  TOOLBAR_LABELS_ACTIVE: true,
  TOOLBAR_ZOOM_DEFAULT: 'fit',
  TOOLBAR_PSEUDO_ACTIVE: true,
  TOOLBAR_PSEUDO_PASSWORD: '',
  TOOLBAR_DEBUG_ACTIVE: false,
  TOOLBAR_SIMULATION_ACTIVE: false,
  
  // Legende-Defaults
  LEGEND_OES_COLLAPSED: false,
  LEGEND_ATTRIBUTES_COLLAPSED: false,
  LEGEND_ATTRIBUTES_ACTIVE: false,
  LEGEND_HIDDEN_COLLAPSED: true,
  LEGEND_HIDDEN_ROOTS_DEFAULT: [],
  
  // Graph-Defaults
  GRAPH_START_ID_DEFAULT: '',
  
  // Debug/Simulation-Parameter
  DEBUG_LINK_DISTANCE: 30,
  DEBUG_LINK_STRENGTH: 0.25,
  DEBUG_CHARGE_STRENGTH: -250,
  DEBUG_ALPHA_DECAY: 0.05,
  DEBUG_VELOCITY_DECAY: 0.5,
  DEBUG_NODE_RADIUS: 16,
  DEBUG_NODE_STROKE_WIDTH: 4,
  DEBUG_LABEL_FONT_SIZE: 21,
  DEBUG_LINK_STROKE_WIDTH: 4,
  DEBUG_ARROW_SIZE: 16
};

/**
 * Erstellt Konfigurationsobjekt mit ENV-Overrides
 * @param {Object} jsonConfig - Konfiguration aus JSON-Datei
 * @returns {Object} Finale Konfiguration
 */
export function buildConfig(jsonConfig = {}) {
  const config = {};
  
  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    // Priorität: ENV > JSON > Default
    const envValue = getEnvValue(key, undefined);
    if (envValue !== undefined) {
      config[key] = envValue;
    } else if (jsonConfig[key] !== undefined) {
      config[key] = jsonConfig[key];
    } else {
      config[key] = defaultValue;
    }
  }
  
  return config;
}

/**
 * Gibt einen einzelnen Konfigurationswert zurück
 * @param {string} key - Konfigurationsschlüssel
 * @param {Object} jsonConfig - Optionale JSON-Konfiguration
 * @returns {*} Konfigurationswert
 */
export function getConfigValue(key, jsonConfig = {}) {
  const defaultValue = DEFAULTS[key];
  if (defaultValue === undefined) {
    return undefined;
  }
  
  // ENV hat höchste Priorität
  const envValue = getEnvValue(key, undefined);
  if (envValue !== undefined) {
    return envValue;
  }
  
  // Dann JSON
  if (jsonConfig[key] !== undefined) {
    return jsonConfig[key];
  }
  
  // Schließlich Default
  return defaultValue;
}

/**
 * Prüft ob Example-Daten verwendet werden sollen
 * @returns {boolean}
 */
export function useExampleData() {
  return getEnvValue('USE_EXAMPLE_ENV', false);
}

/**
 * Gibt alle Default-Werte zurück (für Tests)
 * @returns {Object}
 */
export function getDefaults() {
  return { ...DEFAULTS };
}

export default {
  buildConfig,
  getConfigValue,
  useExampleData,
  getDefaults,
  DEFAULTS
};
