import { graphStore } from '../state/store.js';
import { processData } from './processor.js';
import { setStatus, showTemporaryNotification } from '../utils/dom.js';
import { colorForCategoryAttribute } from '../ui/colors.js';
import { Logger } from '../utils/logger.js';

/**
 * Data Loader Service
 * Handles loading of main graph data and attribute files.
 */

/**
 * Helper: Derive category name from URL/Filename
 */
export function categoryFromUrl(url) {
  try {
    const withoutQuery = String(url).split('?')[0].split('#')[0];
    const parts = withoutQuery.split('/');
    const fname = parts[parts.length-1] || withoutQuery;
    const dot = fname.lastIndexOf('.');
    return (dot > 0 ? fname.slice(0, dot) : fname).trim();
  } catch { return 'Attribute'; }
}

/**
 * Parse attribute list text (CSV/TSV)
 */
export function parseAttributeList(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const result = new Map();
  const foundAttributes = new Set();
  let count = 0;
  
  // Empty files represent a category without attributes
  if (lines.length === 0) {
    return { 
      attributes: result, 
      types: Array.from(foundAttributes),
      count: 0,
      isEmpty: true
    };
  }
  
  for (const line of lines) {
    let parts;
    if (line.includes('\t')) {
      parts = line.split('\t').map(p => p.trim());
    } else {
      parts = line.split(',').map(p => p.trim());
    }
    
    if (parts.length < 2) continue;
    
    const identifier = parts[0]; // ID or E-Mail
    const attribute = parts[1]; // Attribute Name
    const value = parts.length > 2 ? parts[2] : '1'; // Optional Value
    
    if (!result.has(identifier)) {
      result.set(identifier, new Map());
    }
    
    result.get(identifier).set(attribute, value);
    foundAttributes.add(attribute);
    count++;
  }
  
  return { 
    attributes: result, 
    types: Array.from(foundAttributes),
    count,
    isEmpty: false
  };
}

/**
 * Find person IDs by identifier (ID or Email)
 */
export function findPersonIdsByIdentifier(identifier) {
  const { raw } = graphStore.state;
  if (!raw || !raw.persons) return [];

  const normalizedId = String(identifier).toLowerCase();
  const matches = [];
  
  // Search exact ID
  const exactById = raw.persons.find(p => String(p.id).toLowerCase() === normalizedId);
  if (exactById) matches.push(String(exactById.id));
  
  // Search exact Email
  const exactByEmail = raw.persons.find(p => (p.email || '').toLowerCase() === normalizedId);
  if (exactByEmail && !matches.includes(String(exactByEmail.id))) {
    matches.push(String(exactByEmail.id));
  }
  
  return matches;
}

/**
 * Load attributes from URL
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
    
    const { 
      emptyCategories, 
      categorySourceFiles, 
      personAttributes, 
      attributeTypes, 
      activeAttributes
    } = graphStore.state;

    // Handle empty file (category placeholder)
    if (isEmpty) {
      const newEmpty = new Set(emptyCategories);
      newEmpty.add(category);
      graphStore.setEmptyCategories(newEmpty);
      
      const newSourceFiles = new Map(categorySourceFiles);
      const filename = url.split('/').pop().split('?')[0];
      newSourceFiles.set(category, {
        filename: filename || `${category}.txt`,
        url: url,
        originalText: text,
        format: 'comma'
      });
      graphStore.setCategorySourceFiles(newSourceFiles);
      
      return { loaded: true, matchedCount: 0, unmatchedCount: 0, totalAttributes: 0, isEmpty: true, category };
    }
    
    // Process attributes
    const newPersonAttributes = new Map();
    const unmatchedEntries = new Map();
    let matchedCount = 0;
    
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
    
    // Merge into store
    const mergedAttributes = new Map(personAttributes);
    if (mergedAttributes.size === 0 && newPersonAttributes.size > 0) {
        // Optimization for first load
        for (const [pid, map] of newPersonAttributes) mergedAttributes.set(pid, map);
    } else {
        for (const [pid, attrsMap] of newPersonAttributes.entries()) {
            if (!mergedAttributes.has(pid)) {
                mergedAttributes.set(pid, new Map(attrsMap));
            } else {
                const target = mergedAttributes.get(pid);
                for (const [k, v] of attrsMap.entries()) {
                    target.set(k, v);
                }
            }
        }
    }
    graphStore.setPersonAttributes(mergedAttributes);
    
    // Merge Types
    const newAttributeTypes = new Map(attributeTypes);
    const newActiveAttributes = new Set(activeAttributes);
    
    let existingInCategory = 0;
    for (const k of newAttributeTypes.keys()) if (String(k).startsWith(category + '::')) existingInCategory++;
    
    let i = 0;
    for (const type of types) {
      const composite = `${category}::${type}`;
      if (!newAttributeTypes.has(composite)) {
        const color = colorForCategoryAttribute(category, type, existingInCategory + i);
        newAttributeTypes.set(composite, color);
        newActiveAttributes.add(composite);
      }
      i++;
    }
    graphStore.setAttributeTypes(newAttributeTypes);
    graphStore.setActiveAttributes(newActiveAttributes);
    
    // Store Source Info
    const newSourceFiles = new Map(categorySourceFiles);
    const filename = url.split('/').pop().split('?')[0];
    newSourceFiles.set(category, {
      filename: filename || `${category}.txt`,
      url: url,
      originalText: text,
      format: text.includes('\t') ? 'tab' : 'comma'
    });
    graphStore.setCategorySourceFiles(newSourceFiles);
    
    return {
      loaded: true,
      matchedCount,
      unmatchedCount: unmatchedEntries.size,
      totalAttributes: count
    };
  } catch (error) {
    Logger.error('Fehler beim Laden der Attribute:', error);
    showTemporaryNotification(`Fehler beim Laden der Attribute: ${error.message}`, 5000);
    return { loaded: false, error: error.message };
  }
}

/**
 * Load attributes from File object (Drag & Drop / Upload)
 */
export async function loadAttributesFromFile(file) {
  try {
    const text = await file.text();
    const { attributes, types, isEmpty } = parseAttributeList(text);
    
    const { 
        emptyCategories, 
        categorySourceFiles, 
        personAttributes, 
        attributeTypes, 
        activeAttributes 
    } = graphStore.state;

    // Empty file = category only
    if (isEmpty) {
      const category = file.name.replace(/\.[^/.]+$/, ''); 
      const newEmpty = new Set(emptyCategories);
      newEmpty.add(category);
      graphStore.setEmptyCategories(newEmpty);
      
      const newSourceFiles = new Map(categorySourceFiles);
      newSourceFiles.set(category, {
        filename: file.name,
        url: null,
        originalText: text,
        format: 'comma'
      });
      graphStore.setCategorySourceFiles(newSourceFiles);
      
      showTemporaryNotification(`Kategorie "${category}" geladen (leer - nur Platzhalter)`, 3000);
      return true;
    }
    
    const category = file.name.replace(/\.[^/.]+$/, '');
    
    // Process attributes
    const newPersonAttributes = new Map();
    const unmatchedEntries = new Map();
    let matchedCount = 0;
    
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

    // Merge into store
    const mergedAttributes = new Map(personAttributes);
     for (const [pid, attrsMap] of newPersonAttributes.entries()) {
        if (!mergedAttributes.has(pid)) {
            mergedAttributes.set(pid, new Map(attrsMap));
        } else {
            const target = mergedAttributes.get(pid);
            for (const [k, v] of attrsMap.entries()) {
                target.set(k, v);
            }
        }
    }
    graphStore.setPersonAttributes(mergedAttributes);
    
    const newAttributeTypes = new Map(attributeTypes);
    const newActiveAttributes = new Set(activeAttributes);
    
    let existingInCategory = 0;
    for (const k of newAttributeTypes.keys()) if (String(k).startsWith(category + '::')) existingInCategory++;
    
    let i = 0;
    for (const type of types) {
      const composite = `${category}::${type}`;
      if (!newAttributeTypes.has(composite)) {
        const color = colorForCategoryAttribute(category, type, existingInCategory + i);
        newAttributeTypes.set(composite, color);
        newActiveAttributes.add(composite);
      }
      i++;
    }
    graphStore.setAttributeTypes(newAttributeTypes);
    graphStore.setActiveAttributes(newActiveAttributes);
    
    const newSourceFiles = new Map(categorySourceFiles);
    newSourceFiles.set(category, {
        filename: file.name,
        url: null,
        originalText: text,
        format: text.includes('\t') ? 'tab' : 'comma'
    });
    graphStore.setCategorySourceFiles(newSourceFiles);
    
    showTemporaryNotification(`Attribute geladen (${category}): ${matchedCount} zugeordnet, ${unmatchedEntries.size} nicht gefunden`, 3000);
    return true;

  } catch (error) {
    Logger.error('Fehler beim Laden der Datei:', error);
    showTemporaryNotification(`Fehler beim Laden: ${error.message}`, 5000);
    return false;
  }
}

/**
 * Main Data Load Function
 */
export async function loadData() {
  setStatus("Lade Daten...");
  let data = null;
  const { envConfig } = graphStore.state;
  const dataUrl = envConfig?.DATA_URL || null;

  if (!dataUrl) {
    setStatus('Keine automatische Datenquelle konfiguriert – manuelles Laden über den Status möglich.');
    return false;
  }

  try {
    const res = await fetch(dataUrl, { cache: "no-store" });
    if (res.ok) {
      data = await res.json();
      console.log(`[Loader] Loaded data from ${dataUrl}:`, data ? Object.keys(data) : 'null');
      Logger.log(`[Load] Data fetched from ${dataUrl}`, data ? Object.keys(data) : 'null');
    } else {
      console.warn('Automatisches Laden der Daten fehlgeschlagen:', res.status, res.statusText);
    }
  } catch (_e) {
    console.error('Fehler beim automatischen Laden der Daten:', _e);
  }

  if (!data) {
    setStatus('Automatisches Laden der Daten fehlgeschlagen – bitte Daten manuell laden.');
    return false;
  }

  try {
    processData(data);
  } catch (_e) {
    console.error('Fehler beim Anwenden der geladenen Daten:', _e);
    setStatus('Fehler beim Verarbeiten der geladenen Daten – bitte Daten manuell laden.');
    return false;
  }

  // Load configured attributes
  const attrCfg = envConfig?.DATA_ATTRIBUTES_URL;
  if (attrCfg) {
    const urls = Array.isArray(attrCfg) ? attrCfg : [attrCfg];
    
    const collapsed = new Set(urls.map(u => categoryFromUrl(u)));
    graphStore.setCollapsedCategories(collapsed);

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

  return true;
}
