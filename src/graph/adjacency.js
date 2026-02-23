/**
 * Adjazenzlisten und Graph-Traversierung [DRY][PA]
 * Verwaltet Graph-Strukturen und Traversierungs-Algorithmen.
 */

// Adjazenz-Cache
let cachedAdjacency = null;
let cacheSourceLinks = null;

// Org-Depth Cache [PA][DRY]
const orgDepthCache = new Map();

/**
 * Extrahiert ID aus Objekt oder String [SF]
 * @param {Object|string} v - Wert
 * @returns {string} ID
 */
export function idOf(v) {
  return String(typeof v === 'object' && v ? v.id : v);
}

/**
 * Invalidiert den Adjazenz-Cache [SF]
 */
export function invalidateAdjacencyCache() {
  cachedAdjacency = null;
  cacheSourceLinks = null;
}

/**
 * Invalidiert den Org-Depth-Cache [SF]
 * Muss aufgerufen werden, wenn sich die OE-Hierarchie ändert.
 */
export function invalidateOrgDepthCache() {
  orgDepthCache.clear();
}

/**
 * Berechnet die Tiefe einer OE in der Hierarchie (mit Caching) [PA][DRY]
 * @param {string} oid - OE-ID
 * @param {Map<string, string>} parentOf - Parent-Map (childId -> parentId)
 * @returns {number} Tiefe (0 = Root)
 */
export function getOrgDepth(oid, parentOf) {
  const key = String(oid);
  if (orgDepthCache.has(key)) {
    return orgDepthCache.get(key);
  }
  
  let depth = 0;
  let cur = key;
  const seen = new Set();
  
  while (parentOf && parentOf.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = parentOf.get(cur);
    depth++;
  }
  
  orgDepthCache.set(key, depth);
  return depth;
}

/**
 * Baut den Adjazenz-Cache auf oder gibt gecachte Version zurück [PA][DRY]
 * @param {Array} links - Array von Link-Objekten
 * @param {Map} byId - Map von id -> Node
 * @returns {Object} { out, inn, managerOf, adj }
 */
export function getAdjacencyCache(links, byId) {
  if (cachedAdjacency && cacheSourceLinks === links) {
    return cachedAdjacency;
  }
  
  const out = new Map();
  const inn = new Map();
  const managerOf = new Map();
  const adj = new Map();
  
  for (const l of links) {
    if (!l) continue;
    
    const s = idOf(l.source);
    const t = idOf(l.target);
    
    if (!byId.has(s) || !byId.has(t)) continue;
    
    if (!out.has(s)) out.set(s, new Set());
    if (!inn.has(t)) inn.set(t, new Set());
    out.get(s).add(t);
    inn.get(t).add(s);
    
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s).add(t);
    adj.get(t).add(s);
    
    const sNode = byId.get(s);
    const tNode = byId.get(t);
    if (sNode?.type === 'person' && tNode?.type === 'person') {
      managerOf.set(t, s);
    }
  }
  
  cachedAdjacency = { out, inn, managerOf, adj };
  cacheSourceLinks = links;
  
  return cachedAdjacency;
}

/**
 * Erstellt Adjazenzliste (ungerichtet) [DRY]
 * @param {Array} links - Array von Links
 * @returns {Map} Adjazenzliste
 */
export function buildAdjacency(links) {
  const adj = new Map();
  
  const ensure = (id) => {
    if (!adj.has(id)) adj.set(id, new Set());
  };
  
  links.forEach(l => {
    const s = idOf(l.source);
    const t = idOf(l.target);
    ensure(s);
    ensure(t);
    adj.get(s).add(t);
    adj.get(t).add(s);
  });
  
  return adj;
}

/**
 * Sammelt alle Knoten im Report-Subtree [DRY]
 * @param {string} rootId - Root-ID
 * @param {Array} links - Array von Links
 * @param {Map} byId - Map von id -> Node
 * @returns {Set} Set von IDs
 */
export function collectReportSubtree(rootId, links, byId) {
  const rid = String(rootId);
  const out = new Map();
  
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (byId.get(s)?.type === 'person' && byId.get(t)?.type === 'person') {
      if (!out.has(s)) out.set(s, new Set());
      out.get(s).add(t);
    }
  }
  
  const seen = new Set([rid]);
  const q = [rid];
  
  while (q.length) {
    const v = q.shift();
    for (const w of (out.get(v) || [])) {
      if (!seen.has(w)) {
        seen.add(w);
        q.push(w);
      }
    }
  }
  
  return seen;
}

/**
 * Finds all organizational units a person belongs to
 * @param {string} personId - ID of the person
 * @param {Map} personToOrgs - Pre-computed Map of personId -> Set of orgIds [PA]
 * @param {Map} parentOf - Map of childOrgId -> parentOrgId
 * @param {Function} getDisplayLabel - Function to get display label
 * @returns {string[]} - Array of organization labels ordered by hierarchy
 */
export function findAllPersonOrgs(personId, personToOrgs, byId, parentOf, getDisplayLabel) {
  if (!personId || !personToOrgs || !byId || !parentOf) return [];

  const pid = String(personId);
  const baseOrgs = personToOrgs.get(pid) || new Set();

  if (baseOrgs.size === 0) return [];

  // Alle OEs entlang der Aufwärts-Kette (Basis-OE + alle Eltern) einsammeln
  const orgMap = new Map(); // label -> { id, depth }

  for (const baseId of baseOrgs) {
    let cur = String(baseId);
    const chainSeen = new Set();
    while (cur && !chainSeen.has(cur)) {
      chainSeen.add(cur);
      const node = byId.get(cur);
      if (node && node.type === 'org') {
        const label = node.label || cur;
        if (!orgMap.has(label)) {
          orgMap.set(label, { id: cur, depth: getOrgDepth(cur, parentOf) });
        }
      }
      cur = parentOf.get(cur);
    }
  }

  // Nach Tiefe sortieren (kleinere/basisnähere OEs haben eine höhere Tiefe)
  return Array.from(orgMap.values())
    .sort((a, b) => b.depth - a.depth || String(a.id).localeCompare(String(b.id)))
    .map(item => {
      const node = byId.get(String(item.id));
      return getDisplayLabel ? getDisplayLabel(node, item.depth) : (node.label || node.id);
    });
}

export default {
  idOf,
  invalidateAdjacencyCache,
  invalidateOrgDepthCache,
  getOrgDepth,
  getAdjacencyCache,
  buildAdjacency,
  collectReportSubtree,
  findAllPersonOrgs
};
