/**
 * Daten-Lade-System [SF][REH]
 * Verwaltet das Laden von Graph-Daten und Konfiguration.
 */

import { Logger } from '../utils/logger.js';
// import { setStatus, showTemporaryNotification } from '../utils/dom.js';

// Konfiguration
let envConfig = null;

/**
 * Lädt die Umgebungskonfiguration [SF][REH]
 * @returns {Promise<Object|null>} Konfigurationsobjekt oder null
 */
export async function loadEnvConfig() {
  try {
    const useExample = import.meta.env.VITE_USE_EXAMPLE_ENV === 'true';
    const envFile = useExample ? './env.example.json' : './env.json';
    const res = await fetch(envFile, { cache: 'no-store' });
    if (res.ok) {
      envConfig = await res.json();
      Logger.log(`[Config] Umgebungskonfiguration geladen von ${envFile}`);
      return envConfig;
    }
  } catch (e) {
    Logger.log('[Config] Keine env.json gefunden oder Fehler:', e.message);
  }
  return null;
}

/**
 * Gibt die aktuelle Konfiguration zurück [SF]
 * @returns {Object|null}
 */
export function getEnvConfig() {
  return envConfig;
}

/**
 * Setzt die Konfiguration [SF]
 * @param {Object} config - Konfigurationsobjekt
 */
export function setEnvConfig(config) {
  envConfig = config;
}

/**
 * Lädt Graph-Daten von einer URL [SF][REH]
 * @param {string} url - Daten-URL
 * @returns {Promise<Object|null>} Daten-Objekt oder null
 */
export async function loadGraphData(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    Logger.log('[Data] Graph-Daten geladen von:', url);
    return data;
  } catch (e) {
    Logger.warn('[Data] Fehler beim Laden:', e.message);
    return null;
  }
}

/**
 * Verarbeitet geladene Rohdaten [SF]
 * @param {Object} data - Rohdaten
 * @returns {Object} Verarbeitete Daten
 */
export function processRawData(data) {
  const persons = Array.isArray(data.persons) ? data.persons : [];
  const orgs = Array.isArray(data.orgs) ? data.orgs : [];
  const links = Array.isArray(data.links) ? data.links : [];
  
  Logger.log(`[Data] Verarbeite: ${persons.length} Personen, ${orgs.length} OEs, ${links.length} Links`);
  
  // Nodes erstellen
  const personNodes = persons.map(p => ({ ...p, type: 'person' }));
  const orgNodes = orgs.map(o => ({ ...o, type: 'org' }));
  const nodes = [...personNodes, ...orgNodes];
  
  // ID-Map erstellen
  const byId = new Map();
  nodes.forEach(n => byId.set(String(n.id), n));
  
  // OE-Hierarchie aufbauen
  const orgParent = new Map();
  const orgChildren = new Map();
  
  orgs.forEach(o => {
    if (o.parent !== null && o.parent !== undefined) {
      const pid = String(o.parent);
      const cid = String(o.id);
      orgParent.set(cid, pid);
      if (!orgChildren.has(pid)) orgChildren.set(pid, new Set());
      orgChildren.get(pid).add(cid);
    }
  });
  
  // Wurzel-OEs finden
  const orgRoots = orgs
    .filter(o => o.parent === null || o.parent === undefined || !byId.has(String(o.parent)))
    .map(o => String(o.id));
  
  return {
    raw: { nodes, links, persons, orgs },
    byId,
    orgParent,
    orgChildren,
    orgRoots,
    allNodesUnique: nodes
  };
}

/**
 * Extrahiert ID aus Objekt oder String [SF]
 * @param {Object|string} v - Wert
 * @returns {string} ID
 */
export function idOf(v) {
  return String(typeof v === 'object' && v ? v.id : v);
}

/**
 * Berechnet die Tiefe einer OE in der Hierarchie [SF]
 * @param {string} orgId - OE-ID
 * @param {Map} orgParent - Parent-Map
 * @returns {number} Tiefe
 */
export function getOrgDepth(orgId, orgParent) {
  let depth = 0;
  let current = String(orgId);
  const seen = new Set();
  
  while (orgParent.has(current)) {
    if (seen.has(current)) break;
    seen.add(current);
    current = orgParent.get(current);
    depth++;
  }
  
  return depth;
}

export default {
  loadEnvConfig,
  getEnvConfig,
  setEnvConfig,
  loadGraphData,
  processRawData,
  idOf,
  getOrgDepth
};
