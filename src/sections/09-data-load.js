export function idOf(v) {
  return String(typeof v === 'object' && v ? v.id : v);
}

let allowedOrgs = new Set();

export function processData(data) {
  Logger.log('[Timing] Start: processData');
  const persons = Array.isArray(data.persons) ? data.persons : [];
  const orgs = Array.isArray(data.orgs) ? data.orgs : [];
  const links = Array.isArray(data.links) ? data.links : [];

  Logger.log(`[Init] Processing data: ${persons.length} persons, ${orgs.length} orgs, ${links.length} links`);

  const nodes = [];
  const personIds = new Set();
  persons.forEach(p => { if (p && p.id) { nodes.push({ ...p, id: String(p.id), type: 'person' }); personIds.add(String(p.id)); } });
  orgs.forEach(o => { if (o && o.id) { nodes.push({ ...o, id: String(o.id), type: 'org' }); } });

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

  raw = { nodes, links: norm, persons, orgs };
  byId = new Map(raw.nodes.map(n => [String(n.id), n]));
  allNodesUnique = Array.from(byId.values());

  // OE-Hierarchie global initialisieren (Org->Org-Kanten) [CA]
  parentOf = new Map();       // Bestehende Nutzung für Org-Tiefe und Tooltips
  orgParent = new Map();
  orgChildren = new Map();
  orgRoots = [];
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
  // Anfangszustand: keine OE ist ausgewählt; Auswahl entsteht nur durch Benutzerinteraktion
  allowedOrgs = new Set();
  hiddenNodes = new Set();
  hiddenByRoot = new Map();

  // Beim Laden eines neuen Datensatzes prüfe, ob Personen mit den aktuellen Attributen übereinstimmen
  if (personAttributes.size > 0) {
    const newPersonIds = new Set(persons.map(p => String(p.id)));
    const stillValid = Array.from(personAttributes.keys()).some(id => newPersonIds.has(id));
    
    if (!stillValid) {
      // Wenn keine der Personen mit Attributen im neuen Datensatz vorhanden ist,
      // setze die Attribute zurück
      personAttributes = new Map();
      attributeTypes = new Map();
      activeAttributes = new Set();
      emptyCategories = new Set();
      categorySourceFiles = new Map();
      modifiedCategories = new Set();
      buildAttributeLegend();
      document.getElementById('stats-attributes-count').textContent = '0';
    }
  }
  Logger.log('[Timing] End: processData');
}

/* v8 ignore start */
export function renderFullView(sourceName) {
  populateCombo("");
  // Globalen OE-Baum einmalig aufbauen; Sichtbarkeit wird separat über applyLegendScope gesteuert
  buildOrgLegend();
  // Initialer Zustand: kein Scope -> alle OEs ausgeblendet
  applyLegendScope(new Set());
  buildHiddenLegend();
  setStatus(sourceName);
  updateFooterStats(null);
}
/* v8 ignore stop */

export function applyLoadedDataObject(data, sourceName) {
  processData(data);
  renderFullView(sourceName);
}

export async function loadEnvConfig() {
  // Verwende Logger hier noch nicht, da debugMode möglicherweise noch false ist, aber wir wollen es erzwingen, wenn die Config es sagt.
  // Wir loggen "Start" nachträglich, falls debugMode aktiviert wird.
  
  try {
    // 1) IndexedDB (standalone persistence)
    const storedEnv = await getStoredJson(KEY_ENV);
    if (storedEnv) {
      envConfig = storedEnv;
      if (typeof envConfig.TOOLBAR_DEBUG_ACTIVE === 'boolean') {
        debugMode = envConfig.TOOLBAR_DEBUG_ACTIVE;
      }
      Logger.log('[Init] env loaded from IndexedDB:', envConfig);
      return true;
    }
    // 2) fetch fallback (dev server)
    const res = await fetch("./env.json", { cache: "no-store" });
    if (res.ok) {
      envConfig = await res.json();

      // Update debug mode from config [SF]
      if (typeof envConfig.TOOLBAR_DEBUG_ACTIVE === 'boolean') {
        debugMode = envConfig.TOOLBAR_DEBUG_ACTIVE;
      }
      Logger.log('[Init] env.json loaded:', envConfig);
      return true;
    } else {
      // Keine gültige env.json gefunden (HTTP-Fehler)
      console.warn('env.json konnte nicht geladen werden:', res.status, res.statusText);
      setStatus('Keine gültige env.json gefunden – manuelles Laden über den Status möglich.');
      showTemporaryNotification('env.json konnte nicht geladen werden – bitte Datei prüfen oder manuell Daten laden.', 5000);
    }
  } catch (e) {
    // Fehler beim Laden oder Parsen von env.json
    console.error('Fehler beim Laden von env.json:', e);
    setStatus('Fehler beim Laden von env.json – manuelles Laden über den Status möglich.');
    showTemporaryNotification('env.json ist ungültig oder konnte nicht gelesen werden (z.B. JSON-Syntaxfehler). Bitte Datei prüfen.', 5000);
  }
  envConfig = null;
  Logger.log('[Timing] End: init.loadEnv');
  return false;
}

/**
 * Hilfsfunktion: Kategorie aus Dateinamen ableiten
 */
export function categoryFromUrl(url){
  try{
    const withoutQuery = String(url).split('?')[0].split('#')[0];
    const parts = withoutQuery.split('/');
    const fname = parts[parts.length-1] || withoutQuery;
    const dot = fname.lastIndexOf('.');
    return (dot>0?fname.slice(0,dot):fname).trim();
  }catch{ return 'Attribute'; }
}

/**
 * Lädt Attribute aus einer URL gemäß ENV-Konfiguration
 */
export async function loadAttributesFromUrl(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const text = await res.text();
    const { attributes, types, count, isEmpty } = parseAttributeList(text);
    const category = categoryFromUrl(url);
    
    // Leere Datei = nur Kategorie ohne Attribute
    if (isEmpty) {
      // Registriere die leere Kategorie
      emptyCategories.add(category);
      
      // Speichere Quell-Informationen auch für leere Kategorien
      const filename = url.split('/').pop().split('?')[0];
      categorySourceFiles.set(category, {
        filename: filename || `${category}.txt`,
        url: url,
        originalText: text,
        format: 'comma' // Default für leere Dateien
      });
      
      // Update UI
      buildAttributeLegend();
      updateAttributeStats();
      
      return {
        loaded: true,
        matchedCount: 0,
        unmatchedCount: 0,
        totalAttributes: 0,
        isEmpty: true,
        category
      };
    }
    
    // Verknüpfe die geladenen Attribute mit den Personen-IDs
    const newPersonAttributes = new Map();
    const fuzzyMatches = new Map();
    const unmatchedEntries = new Map();
    let matchedCount = 0;
    
    // Verarbeite alle Attribute ohne Fuzzy-Suche (nur exakte Matches)
    for (const [identifier, attrs] of attributes.entries()) {
      const personIds = findPersonIdsByIdentifier(identifier);
      if (personIds.length > 0) {
        for (const id of personIds) {
          if (!newPersonAttributes.has(id)) {
            newPersonAttributes.set(id, new Map());
          }
          for (const [attrName, attrValue] of attrs.entries()) {
            const composite = `${category}::${attrName}`;
            newPersonAttributes.get(id).set(composite, attrValue);
          }
        }
        matchedCount++;
      } else {
        unmatchedEntries.set(identifier, attrs);
      }
    }
    
    // Setze/Merge die Attribute und Typen
    if (personAttributes.size === 0) {
      personAttributes = newPersonAttributes;
    } else {
      for (const [pid, attrsMap] of newPersonAttributes.entries()) {
        if (!personAttributes.has(pid)) {
          personAttributes.set(pid, new Map(attrsMap));
        } else {
          const target = personAttributes.get(pid);
          for (const [k, v] of attrsMap.entries()) {
            target.set(k, v);
          }
        }
      }
    }
    // 'types' ist ein Array von Attributnamen -> als category::name registrieren
    let existingInCategory = 0;
    for (const k of attributeTypes.keys()) if (String(k).startsWith(category + '::')) existingInCategory++;
    let i = 0;
    for (const type of types) {
      const composite = `${category}::${type}`;
      if (!attributeTypes.has(composite)) {
        const color = colorForCategoryAttribute(category, type, existingInCategory + i);
        attributeTypes.set(composite, color);
        // Neue Attribute standardmäßig aktivieren
        activeAttributes.add(composite);
      }
      i++;
    }
    
    // Beim ersten Laden: alle Attribute aktivieren
    if (activeAttributes.size === 0 && attributeTypes.size > 0) {
      activeAttributes = new Set(attributeTypes.keys());
    }
    
    // Speichere Quell-Informationen für späteres Speichern
    const filename = url.split('/').pop().split('?')[0];
    categorySourceFiles.set(category, {
      filename: filename || `${category}.txt`,
      url: url,
      originalText: text,
      format: text.includes('\t') ? 'tab' : 'comma'
    });
    
    // Update UI
    buildAttributeLegend();
    updateAttributeStats();
    // Falls bereits ein Graph gerendert ist, Attribute sofort sichtbar machen
    updateAttributeCircles();
    
    return {
      loaded: true,
      matchedCount,
      unmatchedCount: unmatchedEntries.size,
      totalAttributes: count
    };
  } catch (error) {
    console.error('Fehler beim Laden der Attribute:', error);
    showTemporaryNotification(`Fehler beim Laden der Attribute: ${error.message}`, 5000);
    return { loaded: false, error: error.message };
  }
}

export async function loadData() {
  setStatus("Lade Daten...");
  let data = null;
  let sourceName = '(keine Daten)';

  // 1) IndexedDB (standalone persistence) [SF]
  const storedText = await getStoredText(KEY_DATA);
  if (storedText != null) {
    try {
      data = JSON.parse(storedText);
      sourceName = '(lokal gespeichert)';
    } catch (e) {
      console.error('Gespeicherte Daten konnten nicht geparst werden:', e);
    }
  }

  // 2) fetch fallback (dev server, via env DATA_URL)
  if (!data) {
    const dataUrl = envConfig?.DATA_URL || null;
    if (dataUrl) {
      try {
        const res = await fetch(dataUrl, { cache: "no-store" });
        if (res.ok) {
          data = await res.json();
          sourceName = dataUrl;
        } else {
          console.warn('Automatisches Laden der Daten fehlgeschlagen:', res.status, res.statusText);
        }
      } catch (e) {
        console.error('Fehler beim automatischen Laden der Daten:', e);
      }
    }
  }

  if (!data) {
    setStatus('Keine Daten vorhanden – bitte eine JSON-Datei laden (Drag & Drop).');
    return false;
  }

  try {
    processData(data);
  } catch (e) {
    console.error('Fehler beim Anwenden der geladenen Daten:', e);
    setStatus('Fehler beim Verarbeiten der geladenen Daten – bitte Daten manuell laden.');
    return false;
  }

  await loadAttributesPreferStored();

  return true;
}

// Attribute laden: bevorzugt aus IndexedDB, sonst aus ENV-URLs (Dev-Fallback) [SF][DRY]
export async function loadAttributesPreferStored() {
  const stored = await getStoredAttributes();
  if (stored.length) {
    collapsedCategories = new Set(stored.map(s => s.filename.replace(/\.[^/.]+$/, '')));
    for (const s of stored) {
      try {
        await loadAttributesFromFile(new File([s.text], s.filename));
      } catch (error) {
        console.error('Laden gespeicherter Attribute fehlgeschlagen:', error);
      }
    }
    return;
  }

  // Fallback: Attribute aus ENV-URLs (string oder string[]) – nur im Dev-Server
  const attrCfg = envConfig?.DATA_ATTRIBUTES_URL;
  if (attrCfg) {
    const urls = Array.isArray(attrCfg) ? attrCfg : [attrCfg];
    collapsedCategories = new Set(urls.map(u => categoryFromUrl(u)));
    for (const u of urls) {
      try {
        const result = await loadAttributesFromUrl(u);
        if (result.loaded) {
          const catName = categoryFromUrl(u);
          if (result.isEmpty) {
            showTemporaryNotification(`Kategorie "${catName}" geladen (leer - nur Platzhalter)`, 2500);
          } else if (result.unmatchedCount > 0) {
            showTemporaryNotification(`Attribute geladen (${catName}): ${result.matchedCount} zugeordnet, ${result.unmatchedCount} nicht gefunden`, 2500);
          }
        }
      } catch (error) {
        console.error('Automatisches Laden der Attribute fehlgeschlagen:', error);
      }
    }
  }
}

