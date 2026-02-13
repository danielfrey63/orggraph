import { graphStore } from '../state/store.js';
import { initGraphParamsFromEnv } from '../utils/css.js';

/**
 * Zentrale Konfiguration mit sauberer Configuration Precedence [SF][ISA]
 *
 * Priorität (höchste zuerst):
 *
 *   1. CLI args / vite --define     ─┐
 *   2. Runtime injected (window)     │  → getLayerRuntimeInjected()
 *   3. System env (VITE_*)          ─┤  → getLayerViteEnv()
 *   4. .env files (.env, .env.prod) ─┘    (3+4+1 werden von Vite in import.meta.env gebündelt)
 *   5. env.json                      → fetchJsonLayer('./env.json')
 *   6. config.json                   → fetchJsonLayer('./config.json')
 *   7. Code defaults                 → DEFAULTS
 *
 * Layers 1/3/4 sind zur Build-Zeit in import.meta.env gebacken und
 * können zur Laufzeit nicht unterschieden werden.
 * Layer 2 (window.__ORGGRAPH_ENV__) ermöglicht Runtime-Overrides
 * ohne Rebuild (z.B. via Server-seitigem HTML-Injection).
 */

// ---------------------------------------------------------------------------
// DEFAULTS (Layer 7 – niedrigste Priorität)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // Daten-URLs
  DATA_URL: './data.json',
  DATA_ATTRIBUTES_URL: ['./attributes.txt'],

  // Toolbar-Defaults
  TOOLBAR_DEPTH_DEFAULT: 2,
  TOOLBAR_DIRECTION_DEFAULT: 'both',
  TOOLBAR_MANAGEMENT_ACTIVE: true,
  TOOLBAR_HIERARCHY_ACTIVE: false,
  TOOLBAR_LABELS_ACTIVE: 'all',
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

// ---------------------------------------------------------------------------
// Type Coercion
// ---------------------------------------------------------------------------

/**
 * Konvertiert einen Rohwert in den Typ des typeHint [SF]
 * @param {*} raw - Rohwert (String aus ENV, oder bereits typisiert aus JSON)
 * @param {*} typeHint - Referenzwert für Typ-Erkennung
 * @returns {*} Typisierter Wert
 */
function coerce(raw, typeHint) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeHint === undefined) return raw;

  if (typeof typeHint === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    return raw === 'true' || raw === true;
  }
  if (typeof typeHint === 'number') {
    if (typeof raw === 'number') return raw;
    const num = Number(raw);
    return isNaN(num) ? undefined : num;
  }
  if (Array.isArray(typeHint)) {
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
    if (typeof raw === 'string') {
      return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
    return undefined;
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Layer Loaders
// ---------------------------------------------------------------------------

/**
 * Layer 6/5: Lädt eine JSON-Datei als Config-Layer [SF]
 * @param {string} url - URL der JSON-Datei
 * @returns {Promise<Object>} Geladene Konfiguration oder leeres Objekt
 */
async function fetchJsonLayer(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* optional layer, ignore errors */ }
  return {};
}

/**
 * Layer 1/3/4: Liest alle VITE_*-Werte aus import.meta.env [SF]
 * Nur Keys die in DEFAULTS definiert sind werden berücksichtigt.
 * @returns {Object} Gefundene ENV-Werte (roh, noch nicht typisiert)
 */
function getLayerViteEnv() {
  const layer = {};
  for (const key of Object.keys(DEFAULTS)) {
    const envKey = `VITE_${key}`;
    const value = import.meta.env?.[envKey];
    if (value !== undefined && value !== '') {
      layer[key] = value;
    }
  }
  return layer;
}

/**
 * Layer 2: Liest Runtime-injizierte Werte aus window.__ORGGRAPH_ENV__ [SF]
 * Ermöglicht Overrides ohne Rebuild (z.B. via Script-Tag im HTML).
 * @returns {Object} Runtime-Overrides oder leeres Objekt
 */
function getLayerRuntimeInjected() {
  if (typeof window !== 'undefined' && window.__ORGGRAPH_ENV__) {
    return { ...window.__ORGGRAPH_ENV__ };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Config Builder
// ---------------------------------------------------------------------------

/**
 * Erstellt Konfigurationsobjekt durch Layer-Merge [SF][DRY]
 *
 * Merge-Reihenfolge (niedrigste → höchste Priorität):
 *   DEFAULTS → config.json → env.json → import.meta.env → window.__ORGGRAPH_ENV__
 *
 * @param {Object} configJson - Inhalt von config.json (Layer 6)
 * @param {Object} envJson - Inhalt von env.json (Layer 5)
 * @returns {Object} Finale Konfiguration
 */
export function buildConfig(configJson = {}, envJson = {}) {
  const viteEnv = getLayerViteEnv();
  const runtimeEnv = getLayerRuntimeInjected();

  // Layers von niedrig → hoch, spätere überschreiben frühere
  const layers = [configJson, envJson, viteEnv, runtimeEnv];

  const config = {};
  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    let resolved = defaultValue;

    for (const layer of layers) {
      if (layer[key] !== undefined) {
        const typed = coerce(layer[key], defaultValue);
        if (typed !== undefined) {
          resolved = typed;
        }
      }
    }

    config[key] = resolved;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lädt die Konfiguration aus allen Quellen und aktualisiert den Store [SF]
 *
 * Precedence: CLI args > runtime injected > system env > .env files
 *             > env.json > config.json > code defaults
 */
export async function loadEnvConfig() {
  // Layer 6: config.json
  const configJson = await fetchJsonLayer('./config.json');

  // Layer 5: env.json
  const envJson = await fetchJsonLayer('./env.json');

  // Layers 1-4 + 7 werden in buildConfig zusammengeführt
  const config = buildConfig(configJson, envJson);

  // Update Store
  graphStore.setEnvConfig(config);

  // Initialize Graph Params
  initGraphParamsFromEnv(config);

  return config;
}

/**
 * Gibt einen einzelnen Konfigurationswert zurück [SF]
 * @param {string} key - Konfigurationsschlüssel
 * @param {Object} configJson - Optionale config.json-Daten
 * @param {Object} envJson - Optionale env.json-Daten
 * @returns {*} Konfigurationswert
 */
export function getConfigValue(key, configJson = {}, envJson = {}) {
  const defaultValue = DEFAULTS[key];
  if (defaultValue === undefined) return undefined;

  const fullConfig = buildConfig(configJson, envJson);
  return fullConfig[key];
}

/**
 * Prüft ob Example-Daten verwendet werden sollen
 * @returns {boolean}
 */
export function useExampleData() {
  const raw = import.meta.env?.VITE_USE_EXAMPLE_ENV;
  return raw === 'true' || raw === true;
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
