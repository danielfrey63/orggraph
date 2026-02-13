import { graphStore } from '../state/store.js';
import { createMenuItem, ensureNodeMenu, createMenuSeparator } from './menus.js';

/**
 * Erstellt ein hierarchisches Attribut-Menü als Submenu
 */
function addAttributeSubmenu(parentItem, mainMenu, nodeId) {
  let submenu = null;
  
  const showSubmenu = () => {
    if (submenu) return;
    
    submenu = document.createElement('div');
    submenu.className = 'submenu';
    submenu.style.display = 'block'; // Direkt sichtbar
    
    const { attributeTypes, personAttributes } = graphStore.state;
    
    // Kategorien sammeln
    const categories = new Set();
    for (const key of attributeTypes.keys()) {
      const parts = key.split('::');
      if (parts.length > 1) categories.add(parts[0]);
    }
    
    if (categories.size === 0) {
      const empty = createMenuItem('Keine Attribute definiert', null, false, true);
      submenu.appendChild(empty);
    } else {
      // Sortierte Kategorien
      const sortedCats = Array.from(categories).sort();
      
      sortedCats.forEach(cat => {
        // Prüfen ob Knoten diese Kategorie hat
        const nodeAttrs = personAttributes.get(String(nodeId));
        let hasAttrInCat = false;
        let activeAttrName = null;
        
        if (nodeAttrs) {
          for (const k of nodeAttrs.keys()) {
            if (k.startsWith(cat + '::')) {
              hasAttrInCat = true;
              activeAttrName = k.split('::')[1];
              break;
            }
          }
        }
        
        const catItem = createMenuItem(
          hasAttrInCat ? `✓ ${cat} (${activeAttrName})` : cat,
          () => {
             // Hier könnte man ein weiteres Submenu öffnen oder direkt toggeln
             // Für jetzt: Einfach Prompt zum Hinzufügen/Ändern
             promptNewAttribute(nodeId, cat);
             mainMenu.style.display = 'none';
          },
          false
        );
        submenu.appendChild(catItem);
      });
      
      submenu.appendChild(createMenuSeparator());
      
      // "Neue Kategorie"
      const newCatItem = createMenuItem('+ Neue Kategorie', () => {
        promptNewCategory(nodeId);
        mainMenu.style.display = 'none';
      });
      submenu.appendChild(newCatItem);
    }
    
    parentItem.appendChild(submenu);
  };
  
  const hideSubmenu = () => {
    if (submenu) {
      submenu.remove();
      submenu = null;
    }
  };
  
  parentItem.addEventListener('mouseenter', showSubmenu);
  parentItem.addEventListener('mouseleave', hideSubmenu);
}

/**
 * Prompt für neues Attribut in bestehender Kategorie
 */
function promptNewAttribute(nodeId, category) {
  const name = prompt(`Neues Attribut für Kategorie "${category}":`, '');
  if (!name || !name.trim()) return;
  
  // Wert ist immer "1" - wird für Zählzwecke verwendet
  addNodeToAttribute(nodeId, category, name.trim(), '1');
}

/**
 * Prompt für neue Kategorie
 */
function promptNewCategory(nodeId) {
  const category = prompt('Name der neuen Kategorie:', '');
  if (!category || !category.trim()) return;
  
  const attrName = prompt(`Attributname für "${category.trim()}":`, '');
  if (!attrName || !attrName.trim()) return;
  
  // Wert ist immer "1" - wird für Zählzwecke verwendet
  addNodeToAttribute(nodeId, category.trim(), attrName.trim(), '1');
}

/**
 * Fügt einem Knoten ein Attribut hinzu (Update Store)
 */
function addNodeToAttribute(nodeId, category, attrName, value) {
  const { personAttributes, attributeTypes, activeAttributes, modifiedCategories, categorySourceFiles } = graphStore.state;
  const composite = `${category}::${attrName}`;
  const pid = String(nodeId);
  
  // 1. Attribut-Typ registrieren falls neu
  if (!attributeTypes.has(composite)) {
    // Farbe generieren (Logik aus loader/colors kopieren oder importieren)
    // Einfachheitshalber importieren wir nicht alles neu, sondern nutzen Store-Update
    const newTypes = new Map(attributeTypes);
    // Dummy-Farbe oder berechnet - wir lassen den Store das handeln oder setzen es hier
    newTypes.set(composite, '#999999'); // Placeholder color
    graphStore.setAttributeTypes(newTypes);
    
    const newActive = new Set(activeAttributes);
    newActive.add(composite);
    graphStore.setActiveAttributes(newActive);
  }
  
  // 2. Person-Attribut setzen
  const newPersonAttributes = new Map(personAttributes);
  if (!newPersonAttributes.has(pid)) {
    newPersonAttributes.set(pid, new Map());
  }
  newPersonAttributes.get(pid).set(composite, value);
  graphStore.setPersonAttributes(newPersonAttributes);
  
  // 3. Als modifiziert markieren
  const newModified = new Set(modifiedCategories);
  newModified.add(category);
  graphStore.setModifiedCategories(newModified);
  
  // 4. Source Info erstellen falls neu
  if (!categorySourceFiles.has(category)) {
    const newSources = new Map(categorySourceFiles);
    newSources.set(category, {
      filename: `${category}.txt`,
      url: null,
      originalText: '',
      format: 'comma'
    });
    graphStore.setCategorySourceFiles(newSources);
  }
}

/**
 * Zeigt das Node-Menü an
 */
export function showNodeContextMenu(x, y, actionsOrOnHide) {
  const el = ensureNodeMenu();
  // Cleanup old content
  while (el.firstChild) el.removeChild(el.firstChild);
  
  const addItem = (label, handler, hasSubmenu = false, disabled = false) => {
    const it = createMenuItem(label, handler ? () => { el.style.display = 'none'; handler(); } : null, hasSubmenu, disabled);
    el.appendChild(it);
    return it;
  };
  
  if (typeof actionsOrOnHide === 'function') {
    addItem('Ausblenden', actionsOrOnHide);
  } else {
    const actions = actionsOrOnHide || {};
    if (actions.onHideSubtree) addItem('Ausblenden', actions.onHideSubtree);
    
    const isRootFlag = !!actions.isRoot;
    const { selectedRootIds } = graphStore.state;
    
    if (actions.onSetAsRoot) addItem('Als Root definieren', actions.onSetAsRoot, false, isRootFlag);
    
    if (isRootFlag && actions.onRemoveRoot && Array.isArray(selectedRootIds) && selectedRootIds.length > 1) {
      addItem('Als Root entfernen', actions.onRemoveRoot);
    }
    
    // Attribute-Menü hinzufügen
    if (actions.nodeId) {
      const attrMenuItem = addItem('Attribute', null, true);
      addAttributeSubmenu(attrMenuItem, el, actions.nodeId);
    }
  }
  
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}
