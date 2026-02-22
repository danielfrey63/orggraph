import { Logger } from '../utils/logger.js';
import { graphStore } from '../state/store.js';
import { idOf } from '../graph/adjacency.js';

export function processData(data) {
  Logger.log('[Timing] Start: processData');
  const persons = Array.isArray(data.persons) ? data.persons : [];
  const orgs = Array.isArray(data.orgs) ? data.orgs : [];
  const links = Array.isArray(data.links) ? data.links : [];

  console.log(`[Processor] Raw data counts: Persons=${persons.length}, Orgs=${orgs.length}, Links=${links.length}`);
  Logger.log(`[Init] Processing data: ${persons.length} persons, ${orgs.length} orgs, ${links.length} links`);

  const nodes = [];
  const personIds = new Set();
  
  try {
    persons.forEach((p, index) => { 
        try {
            if (p && p.id) { 
                nodes.push({ ...p, id: String(p.id), type: 'person' }); 
                personIds.add(String(p.id)); 
            }
        } catch (err) {
            console.error(`[Processor] Error in person at index ${index}:`, p, err);
        }
    });
  } catch (err) {
    console.error('[Processor] Crash in persons loop:', err);
  }

  try {
    orgs.forEach((o, index) => { 
        try {
            if (o && o.id) { 
                nodes.push({ ...o, id: String(o.id), type: 'org' }); 
            }
        } catch (err) {
            console.error(`[Processor] Error in org at index ${index}:`, o, err);
        }
    });
  } catch (err) {
    console.error('[Processor] Crash in orgs loop:', err);
  }

  console.log(`[Processor] Processed nodes: ${nodes.length} (Persons+Orgs)`);

  const seen = new Set();
  const idSet = new Set(nodes.map(n => String(n.id)));
  const norm = [];
  for (const l of links) {
    const s = idOf(l && l.source);
    const t = idOf(l && l.target);
    if (!idSet.has(s) || !idSet.has(t)) continue;
    if (s === t) continue;
    const key = `${s}>${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    norm.push({ source: s, target: t });
  }

  const raw = { nodes, links: norm, persons, orgs };
  // Update Store: raw
  graphStore.setRawData(raw);

  const byId = new Map(raw.nodes.map(n => [String(n.id), n]));
  // Update Store: byId
  graphStore.setById(byId);

  const allNodesUnique = Array.from(byId.values());
  // Update Store: allNodesUnique
  graphStore.setAllNodesUnique(allNodesUnique);

  // OE-Hierarchie global initialisieren (Org->Org-Kanten)
  const parentOf = new Map();       
  const orgParent = new Map();
  const orgChildren = new Map();
  let orgRoots = [];
  
  if (raw && Array.isArray(raw.orgs) && Array.isArray(raw.links)) {
    const orgIds = new Set(raw.orgs.map(o => String(o.id)));
    const hasParent = new Set();
    for (const l of raw.links) {
      const s = idOf(l.source), t = idOf(l.target);
      if (!orgIds.has(s) || !orgIds.has(t)) continue;
      // child -> parent
      parentOf.set(t, s);
      orgParent.set(t, s);
      // parent -> children
      if (!orgChildren.has(s)) orgChildren.set(s, new Set());
      orgChildren.get(s).add(t);
      hasParent.add(t);
    }
    const allOrgIds = Array.from(orgIds);
    orgRoots = allOrgIds.filter(id => !hasParent.has(id));
  }
  
  // Update Store: Hierarchy
  graphStore.setHierarchy({ parentOf, orgParent, orgChildren, orgRoots });

  // Reset selection/filters
  graphStore.setAllowedOrgs(new Set());
  graphStore.setHiddenNodes(new Set());
  graphStore.setHiddenByRoot(new Map());

  // Check attributes validity
  const { personAttributes } = graphStore.state;
  if (personAttributes.size > 0) {
    const newPersonIds = new Set(persons.map(p => String(p.id)));
    const stillValid = Array.from(personAttributes.keys()).some(id => newPersonIds.has(id));
    
    if (!stillValid) {
      // Wenn keine der Personen mit Attributen im neuen Datensatz vorhanden ist,
      // setze die Attribute zurück
      graphStore.setPersonAttributes(new Map());
      graphStore.setAttributeTypes(new Map());
      graphStore.setActiveAttributes(new Set());
      graphStore.setEmptyCategories(new Set());
      graphStore.setCategorySourceFiles(new Map());
      graphStore.setModifiedCategories(new Set());
    }
  }
  Logger.log('[Timing] End: processData');
}
