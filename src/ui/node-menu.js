import { graphStore } from '../state/store.js';
import { colorForCategoryAttribute } from './colors.js';
import { createMenuItem, ensureNodeMenu, createMenuSeparator } from './menus.js';

function addCategorySubmenu(parentItem, mainMenu, nodeId, category, attrsInCat, nodeAttrs) {
  let sub = null;
  const show = () => {
    if (sub) return;
    sub = document.createElement('div');
    sub.className = 'submenu';
    sub.style.display = 'block';
    attrsInCat.forEach(attrName => {
      const composite = `${category}::${attrName}`;
      const hasAttr = nodeAttrs && nodeAttrs.has(composite);
      const item = createMenuItem(
        hasAttr ? `✓ ${attrName}` : attrName,
        () => {
          if (hasAttr) {
            removeNodeFromAttribute(nodeId, category, composite);
          } else {
            addNodeToAttribute(nodeId, category, attrName, '1');
          }
          mainMenu.style.display = 'none';
        }
      );
      sub.appendChild(item);
    });
    sub.appendChild(createMenuSeparator());
    const newItem = createMenuItem('+ Neues Attribut', () => {
      promptNewAttribute(nodeId, category);
      mainMenu.style.display = 'none';
    });
    sub.appendChild(newItem);
    parentItem.appendChild(sub);
  };
  const hide = () => { if (sub) { sub.remove(); sub = null; } };
  parentItem.addEventListener('mouseenter', show);
  parentItem.addEventListener('mouseleave', hide);
}

function addAttributeSubmenu(parentItem, mainMenu, nodeId) {
  let submenu = null;
  const showSubmenu = () => {
    if (submenu) return;
    submenu = document.createElement('div');
    submenu.className = 'submenu';
    submenu.style.display = 'block';
    const { attributeTypes, personAttributes } = graphStore.state;
    const nodeAttrs = personAttributes.get(String(nodeId));
    const catMap = new Map();
    for (const key of attributeTypes.keys()) {
      const parts = key.split('::');
      if (parts.length > 1) {
        if (!catMap.has(parts[0])) catMap.set(parts[0], []);
        catMap.get(parts[0]).push(parts[1]);
      }
    }
    if (catMap.size > 0) {
      const sortedCats = Array.from(catMap.keys()).sort();
      sortedCats.forEach(cat => {
        const attrsInCat = catMap.get(cat).sort();
        let activeAttrName = null;
        if (nodeAttrs) {
          for (const k of nodeAttrs.keys()) {
            if (k.startsWith(cat + '::')) {
              activeAttrName = k.split('::')[1];
              break;
            }
          }
        }
        const label = activeAttrName ? `✓ ${cat} (${activeAttrName})` : cat;
        const catItem = createMenuItem(label, null, true);
        addCategorySubmenu(catItem, mainMenu, nodeId, cat, attrsInCat, nodeAttrs);
        submenu.appendChild(catItem);
      });
      submenu.appendChild(createMenuSeparator());
    }
    const newCatItem = createMenuItem('+ Neue Kategorie', () => {
      promptNewCategory(nodeId);
      mainMenu.style.display = 'none';
    });
    submenu.appendChild(newCatItem);
    parentItem.appendChild(submenu);
  };
  const hideSubmenu = () => { if (submenu) { submenu.remove(); submenu = null; } };
  parentItem.addEventListener('mouseenter', showSubmenu);
  parentItem.addEventListener('mouseleave', hideSubmenu);
}

function promptNewAttribute(nodeId, category) {
  const name = prompt(`Neues Attribut für Kategorie "${category}":`, '');
  if (!name || !name.trim()) return;
  addNodeToAttribute(nodeId, category, name.trim(), '1');
}

function promptNewCategory(nodeId) {
  const category = prompt('Name der neuen Kategorie:', '');
  if (!category || !category.trim()) return;
  const attrName = prompt(`Attributname für "${category.trim()}":`, '');
  if (!attrName || !attrName.trim()) return;
  addNodeToAttribute(nodeId, category.trim(), attrName.trim(), '1');
}

function addNodeToAttribute(nodeId, category, attrName, value) {
  const { personAttributes, attributeTypes, activeAttributes, modifiedCategories, categorySourceFiles } = graphStore.state;
  const composite = `${category}::${attrName}`;
  const pid = String(nodeId);
  if (!attributeTypes.has(composite)) {
    const newTypes = new Map(attributeTypes);
    let ordinal = 0;
    for (const k of newTypes.keys()) {
      if (k.startsWith(category + '::')) ordinal++;
    }
    newTypes.set(composite, colorForCategoryAttribute(category, attrName, ordinal));
    graphStore.setAttributeTypes(newTypes);
    const newActive = new Set(activeAttributes);
    newActive.add(composite);
    graphStore.setActiveAttributes(newActive);
  }
  const newPersonAttributes = new Map(personAttributes);
  if (!newPersonAttributes.has(pid)) {
    newPersonAttributes.set(pid, new Map());
  }
  newPersonAttributes.get(pid).set(composite, value);
  graphStore.setPersonAttributes(newPersonAttributes);
  const newModified = new Set(modifiedCategories);
  newModified.add(category);
  graphStore.setModifiedCategories(newModified);
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

function removeNodeFromAttribute(nodeId, category, composite) {
  const { personAttributes, modifiedCategories } = graphStore.state;
  const pid = String(nodeId);
  const newPersonAttributes = new Map(personAttributes);
  const nodeMap = newPersonAttributes.get(pid);
  if (nodeMap) {
    const newNodeMap = new Map(nodeMap);
    newNodeMap.delete(composite);
    if (newNodeMap.size === 0) {
      newPersonAttributes.delete(pid);
    } else {
      newPersonAttributes.set(pid, newNodeMap);
    }
    graphStore.setPersonAttributes(newPersonAttributes);
  }
  const newModified = new Set(modifiedCategories);
  newModified.add(category);
  graphStore.setModifiedCategories(newModified);
}

export function showNodeContextMenu(x, y, actionsOrOnHide) {
  const el = ensureNodeMenu();
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
    if (actions.nodeId) {
      const attrMenuItem = addItem('Attribute', null, true);
      addAttributeSubmenu(attrMenuItem, el, actions.nodeId);
    }
  }
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}
