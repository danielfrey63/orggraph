function buildHiddenLegend() {
  const legend = document.getElementById('hiddenLegend');
  if (!legend) return;
  
  // Titel wird separat aktualisiert nach Graph-Berechnung
  updateHiddenLegendTitle();
  // Globalen Eye-Button aktualisieren (wie bei OEs/Attributen)
  updateGlobalHiddenVisibilityButton();
  
  legend.innerHTML = '';
  if (hiddenByRoot.size === 0) {
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'legend-list';
  for (const [root, setIds] of hiddenByRoot.entries()) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'legend-row'; // Kein .active State für ausgeblendete Items
    
    // Linker Bereich: Spacer + Label
    const leftArea = document.createElement('div');
    leftArea.className = 'legend-row-left';
    
    // Rechter Bereich: X-Button
    const rightArea = document.createElement('div');
    rightArea.className = 'legend-row-right';
    
    // Spacer statt Chevron
    const spacer = document.createElement('div');
    spacer.className = 'legend-tree-spacer';
    leftArea.appendChild(spacer);
    
    // Label (pseudonymisiert wenn aktiv)
    const node = byId.get(root);
    const name = getDisplayLabel(node);
    const chip = document.createElement('span');
    chip.className = 'legend-label-chip';
    chip.dataset.rootId = root; // Für spätere Aktualisierung
    chip.textContent = `${name} (${setIds.size})`;
    chip.title = name;
    leftArea.appendChild(chip);
    
    // X-Button zum Entfernen (unhide)
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'legend-icon-btn';
    removeBtn.title = 'Wieder einblenden';
    setIcon(removeBtn, 'close');
    removeBtn.setAttribute('data-ignore-header-click', 'true');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      unhideSubtree(root);
    });
    rightArea.appendChild(removeBtn);
    
    // Eye-Button zum temporären Ein-/Ausblenden (ganz rechts)
    const isVisible = allHiddenTemporarilyVisible || temporarilyVisibleRoots.has(root);
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    // Verwende active-Klasse wie bei OEs/Attributen
    eyeBtn.className = isVisible ? 'legend-icon-btn active' : 'legend-icon-btn';
    eyeBtn.title = isVisible ? 'Temporär ausblenden' : 'Temporär einblenden';
    setIcon(eyeBtn, isVisible ? 'eye' : 'eyeClosed');
    eyeBtn.dataset.rootId = root;
    eyeBtn.setAttribute('data-ignore-header-click', 'true');
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHiddenRootVisibility(root);
    });
    rightArea.appendChild(eyeBtn);
    
    row.appendChild(leftArea);
    row.appendChild(rightArea);
    li.appendChild(row);
    ul.appendChild(li);
  }
  legend.appendChild(ul);
}

let legendCollapsedItems = new Set();

// Initialisiert legendCollapsedItems: Erste Kinder mit Geschwistern werden collapsed [SF][CA]
function initLegendCollapsedItems(scopeSet) {
  legendCollapsedItems.clear();
  if (!scopeSet || scopeSet.size === 0) return;

  // Finde alle Knoten im Scope, die Kinder haben
  for (const oid of scopeSet) {
    const id = String(oid);
    const rawChildren = Array.from(orgChildren.get(id) || []);
    const kids = rawChildren.filter(k => scopeSet.has(String(k)));
    
    // Wenn dieser Knoten mehrere Kinder hat, collapse alle Kinder die selbst Kinder haben
    if (kids.length > 1) {
      for (const kid of kids) {
        const kidId = String(kid);
        const kidChildren = Array.from(orgChildren.get(kidId) || []);
        const kidKids = kidChildren.filter(k => scopeSet.has(String(k)));
        if (kidKids.length > 0) {
          legendCollapsedItems.add(kidId);
        }
      }
    }
  }
}

// Gemeinsamer Renderer für OE-Legendeneinträge (voller Baum und Scoped-Baum) [DRY][CA]
function renderOrgLegendNode(oid, depth, options) {
  const { childrenProvider, scopeSet, registerNode } = options || {};
  const id = String(oid);

  if (scopeSet && !scopeSet.has(id)) return null;

  const li = document.createElement('li');
  li.dataset.oid = id;
  const node = byId.get(id);
  const lbl = getDisplayLabel(node, depth);
  const idAttr = `org_${id}`;

  const row = document.createElement('div');
  row.className = 'legend-row';

  const leftArea = document.createElement('div');
  leftArea.className = 'legend-row-left';

  const rightArea = document.createElement('div');
  rightArea.className = 'legend-row-right';

  const depthSpacer = document.createElement('div');
  depthSpacer.className = 'legend-depth-spacer';
  depthSpacer.style.width = `${Math.max(0, Number(depth) || 0) * 16}px`;
  leftArea.appendChild(depthSpacer);

  const rawChildren = Array.from((childrenProvider && childrenProvider(id)) || []);
  const kids = scopeSet
    ? rawChildren.filter(k => scopeSet.has(String(k)))
    : rawChildren;

  if (kids.length) {
    const chevron = document.createElement('button');
    chevron.type = 'button';
    const isCollapsed = legendCollapsedItems.has(id);
    chevron.className = isCollapsed ? 'legend-tree-chevron collapsed' : 'legend-tree-chevron expanded';
    chevron.title = 'Ein-/Ausklappen';
    chevron.innerHTML = getChevronSVG();

    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      const sub = li.querySelector('ul');
      const currentlyCollapsed = sub && sub.style.display === 'none';
      if (sub) {
        sub.style.display = currentlyCollapsed ? '' : 'none';
        chevron.className = currentlyCollapsed ? 'legend-tree-chevron expanded' : 'legend-tree-chevron collapsed';
        if (currentlyCollapsed) {
          legendCollapsedItems.delete(id);
        } else {
          legendCollapsedItems.add(id);
        }
      }
    });

    leftArea.appendChild(chevron);
  } else {
    const spacer = document.createElement('div');
    spacer.className = 'legend-tree-spacer';
    leftArea.appendChild(spacer);
  }

  const chip = document.createElement('span');
  chip.className = 'legend-label-chip';
  chip.textContent = lbl;
  chip.title = lbl;
  leftArea.appendChild(chip);

  row.appendChild(leftArea);
  row.appendChild(rightArea);

  const updateRowState = () => {
    const isActive = allowedOrgs.has(id);
    row.title = isActive ? `${lbl} - Klicken zum Ausblenden` : `${lbl} - Klicken zum Anzeigen`;
  };

  updateRowState();

  row.addEventListener('click', (e) => {
    if (e.target.closest('.legend-tree-chevron')) return;
    const isActive = allowedOrgs.has(id);
    if (isActive) {
      allowedOrgs.delete(id);
    } else {
      allowedOrgs.add(id);
    }
    updateRowState();
    syncGraphAndLegendColors();
  });

  row.style.cursor = 'pointer';

  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'checkbox';
  hiddenInput.id = idAttr;
  hiddenInput.style.display = 'none';
  hiddenInput.checked = allowedOrgs.has(id);
  row.appendChild(hiddenInput);

  li.appendChild(row);

  if (kids.length) {
    const sub = document.createElement('ul');
    if (legendCollapsedItems.has(id)) {
      sub.style.display = 'none';
    }
    for (const k of kids) {
      const childLi = renderOrgLegendNode(k, (depth || 0) + 1, options);
      if (childLi) sub.appendChild(childLi);
    }
    li.appendChild(sub);
  }

  const onCtx = (e) => {
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    e.stopPropagation();
    
    let subRoot = null;
    try {
      subRoot = li.querySelector(':scope > ul');
    } catch(_) {
      subRoot = Array.from(li.children).find(ch => ch.tagName === 'UL');
    }
    
    const directChildrenIds = new Set();
    const allDescendantIds = new Set();
    
    if (subRoot) {
      Array.from(subRoot.children).forEach(childLi => {
        const childCb = childLi.querySelector('input[id^="org_"]');
        if (childCb) {
          const childId = childCb.id.replace('org_', '');
          directChildrenIds.add(childId);
        }
        const allCbs = childLi.querySelectorAll('input[id^="org_"]');
        allCbs.forEach(cb => allDescendantIds.add(cb.id.replace('org_', '')));
      });
    }
    
    showLegendMenu(e.clientX, e.clientY, {
      onShowAll: () => {
        allowedOrgs.add(id);
        allDescendantIds.forEach(cid => allowedOrgs.add(cid));
        syncGraphAndLegendColors();
      },
      onHideAll: () => {
        allowedOrgs.delete(id);
        allDescendantIds.forEach(cid => allowedOrgs.delete(cid));
        syncGraphAndLegendColors();
      },
      onShowDirectChildrenOnly: () => {
        allDescendantIds.forEach(cid => {
          allowedOrgs.delete(cid);
          if (subRoot) {
            const cb = subRoot.querySelector(`#org_${cid}`);
            if (cb) cb.checked = false;
          }
        });
        
        allowedOrgs.add(id);
        directChildrenIds.forEach(cid => allowedOrgs.add(cid));
        
        if (subRoot) {
          Array.from(subRoot.children).forEach(childLi => {
            const childUl = childLi.querySelector('ul');
            if (childUl) {
              childUl.style.display = 'none';
              const chevron = childLi.querySelector('.legend-tree-chevron');
              if (chevron) {
                chevron.className = 'legend-tree-chevron collapsed';
              }
            }
          });
        }
        
        syncGraphAndLegendColors();
      }
    });
  };
  
  li.addEventListener('contextmenu', onCtx);
  row.addEventListener('contextmenu', onCtx);

  if (typeof registerNode === 'function') {
    registerNode(id, li);
  }

  return li;
}

function buildOrgLegend() {
  const legend = document.querySelector('#legend');
  if (!legend) return;
  legend.innerHTML = '';

  let children = orgChildren;
  let roots = Array.isArray(orgRoots) && orgRoots.length > 0 ? orgRoots.slice() : [];
  if (!children || children.size === 0 || roots.length === 0) {
    const localChildren = new Map();
    const hasParent = new Set();
    for (const l of raw.links || []) {
      const s = idOf(l.source), t = idOf(l.target);
      if (byId.get(s)?.type !== 'org' || byId.get(t)?.type !== 'org') continue;
      const sid = String(s);
      const tid = String(t);
      if (!localChildren.has(sid)) localChildren.set(sid, new Set());
      localChildren.get(sid).add(tid);
      hasParent.add(tid);
    }
    const allOrgs = raw && Array.isArray(raw.orgs) ? raw.orgs.map(o => String(o.id)) : [];
    roots = allOrgs.filter(id => !hasParent.has(id));
    children = localChildren;
  }

  orgLegendNodes = new Map();

  const ul = document.createElement('ul');
  ul.className = 'legend-list';

  const options = {
    childrenProvider: (id) => (children.get(String(id)) || []),
    scopeSet: null,
    registerNode: (id, li) => { orgLegendNodes.set(id, li); }
  };

  for (const r of roots) {
    const li = renderOrgLegendNode(r, 0, options);
    if (li) ul.appendChild(li);
  }

  legend.appendChild(ul);
  syncGraphAndLegendColors();
}

// Baut eine OE-Legende nur fuer die angegebenen sichtbaren OEs (visibleSet)
// unter Verwendung der globalen OE-Hierarchie orgParent/orgChildren. [CA][SF]
function buildScopedOrgLegend(visibleSet) {
  const legend = document.querySelector('#legend');
  if (!legend) return;

  const scopeSet = new Set(Array.from(visibleSet || []).map(String));
  legend.innerHTML = '';
  orgLegendNodes = new Map();

  if (!raw || !Array.isArray(raw.orgs) || scopeSet.size === 0) {
    return;
  }

  // Initiale collapsed states setzen für erste Kinder mit Geschwistern [SF]
  initLegendCollapsedItems(scopeSet);

  const roots = [];
  for (const oid of scopeSet) {
    const p = orgParent.get(oid);
    if (!p || !scopeSet.has(String(p))) {
      roots.push(String(oid));
    }
  }

  const ul = document.createElement('ul');
  ul.className = 'legend-list';

  const options = {
    childrenProvider: (id) => (orgChildren.get(String(id)) || []),
    scopeSet,
    registerNode: (id, li) => { orgLegendNodes.set(id, li); }
  };

  for (const r of roots) {
    const li = renderOrgLegendNode(r, 0, options);
    if (li) ul.appendChild(li);
  }

  legend.appendChild(ul);
  syncGraphAndLegendColors();
}

let currentLegendScope = new Set();

function applyLegendScope(scope) {
  const scopeSet = new Set(Array.from(scope || []).map(String));
  currentLegendScope = scopeSet;

  const visible = new Set();
  if (scopeSet.size > 0) {
    for (const oid of scopeSet) {
      let cur = String(oid);
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        visible.add(cur);
        cur = orgParent.get(cur);
      }
    }
  }

  buildScopedOrgLegend(visible);
}

function updateLegendChips(rootEl) {
  const root = rootEl || document;
  
  // Mit Checkboxen synchronisieren, außer wenn OEs absichtlich ausgeblendet wurden
  if (oesVisible) {
    // OEs sind sichtbar, normale Synchronisierung
    const newAllowed = new Set();
    root.querySelectorAll('.legend-list input[id^="org_"]').forEach(cb => { 
      if (cb.checked) newAllowed.add(cb.id.replace('org_','')); 
    });
    allowedOrgs = newAllowed;
  }
  // Wenn OEs ausgeblendet sind (oesVisible=false), dann bleibt allowedOrgs leer
  // For each legend entry (li), ensure chips have transparent background
  root.querySelectorAll('.legend-list > li, .legend-list li').forEach(li => {
    const chip = li.querySelector(':scope > .legend-row .legend-label-chip');
    if (!chip) return;
    // Immer transparent, damit CSS-Hover funktioniert
    chip.style.background = 'transparent';
  });
} 

function updateLegendRowColors(rootEl) {
  const root = rootEl || document;
  root.querySelectorAll('.legend-list > li, .legend-list li').forEach(li => {
    const row = li.querySelector(':scope > .legend-row');
    const cb = li.querySelector(':scope > .legend-row input[id^="org_"]');
    if (!row || !cb) return;
    const oid = cb.id.replace('org_','');
    const { stroke, fill } = colorForOrg(oid);
    
    // Synchronisiere Hidden Input mit allowedOrgs
    cb.checked = allowedOrgs.has(oid);
    
    // Setze Farben immer als CSS-Custom-Properties (für Hover-Effekt bei inaktiven Rows)
    row.style.setProperty('--org-fill', fill);
    row.style.setProperty('--org-stroke', stroke);
    
    if (cb.checked && allowedOrgs.has(oid)) {
      // Active state
      row.classList.add('active');
    } else {
      // Inactive state
      row.classList.remove('active');
    }
  });
}

/**
 * Sammelt alle Knoten im Unterbaum
 */
function collectSubtree(rootId, children, scopeSet) {
  const out = new Set([rootId]);
  const q = [rootId];
  
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    // Iteriere über alle Kinder des aktuellen Knotens
    for (const ch of (children.get(cur) || [])) {
      // Überspringe Knoten, die nicht im Scope sind, falls ein Scope definiert ist
      if (scopeSet && !scopeSet.has(ch)) continue;
      // Füge neue Knoten zum Ergebnis und zur Warteschlange hinzu
      if (!out.has(ch)) { 
        out.add(ch); 
        q.push(ch); 
      }
    }
  }
  
  return out;
}

function ensureLegendMenu() {
  if (legendMenuEl) return legendMenuEl;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.background = '#111';
  el.style.color = '#fff';
  el.style.fontSize = '12px';
  el.style.padding = '6px 0';
  el.style.borderRadius = '6px';
  el.style.minWidth = '160px';
  el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
  el.style.zIndex = 2000;
  el.style.display = 'none';
  const mkItem = (label, handler) => {
    const it = document.createElement('div');
    it.textContent = label;
    it.style.padding = '6px 12px';
    it.style.cursor = 'pointer';
    it.addEventListener('click', () => { hideLegendMenu(); handler(); });
    it.addEventListener('mouseenter', () => it.style.background = '#1f2937');
    it.addEventListener('mouseleave', () => it.style.background = 'transparent');
    return it;
  };
  
  // Erweiterte Menü-Optionen
  el.appendChild(mkItem('Alle einblenden', () => {}));
  el.appendChild(mkItem('Alle ausblenden', () => {}));
  
  // Trennlinie
  const divider = document.createElement('div');
  divider.style.borderTop = '1px solid rgba(255,255,255,0.2)';
  divider.style.margin = '4px 0';
  el.appendChild(divider);
  
  // Neue Option: Nur direkte Kinder anzeigen
  el.appendChild(mkItem('Nur direkte Kinder anzeigen', () => {}));
  
  document.body.appendChild(el);
  legendMenuEl = el;
  // Dismiss on click elsewhere
  document.addEventListener('click', (e) => { if (legendMenuEl && legendMenuEl.style.display === 'block') hideLegendMenu(); });
  return el;
}
function showLegendMenu(x, y, actions) {
  const el = ensureLegendMenu();
  // Wire actions
  const items = el.querySelectorAll('div:not([style*="border-top"])');
  items[0].onclick = () => { hideLegendMenu(); actions.onShowAll(); };
  items[1].onclick = () => { hideLegendMenu(); actions.onHideAll(); };
  items[2].onclick = () => { hideLegendMenu(); actions.onShowDirectChildrenOnly(); };
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}
function hideLegendMenu() { if (legendMenuEl) legendMenuEl.style.display = 'none'; }

/**
 * Fügt einen Knoten zu einem Attribut hinzu
 */
function addNodeToAttribute(nodeId, categoryKey, attributeName, attributeValue = '1') {
  const personId = String(nodeId);
  
  // Erstelle Attribut-Key im Format "Kategorie::Attribut"
  const attrKey = `${categoryKey}::${attributeName}`;
  
  // Füge Attribut zur Person hinzu
  if (!personAttributes.has(personId)) {
    personAttributes.set(personId, new Map());
  }
  personAttributes.get(personId).set(attrKey, attributeValue);
  
  // Füge Attributtyp hinzu, falls noch nicht vorhanden
  if (!attributeTypes.has(attrKey)) {
    const existingInCategory = Array.from(attributeTypes.keys())
      .filter(k => String(k).startsWith(categoryKey + '::')).length;
    const color = colorForCategoryAttribute(categoryKey, attributeName, existingInCategory);
    attributeTypes.set(attrKey, color);
    
    // Falls dies das erste Attribut in einer leeren Kategorie ist, entferne sie aus emptyCategories
    if (emptyCategories.has(categoryKey)) {
      emptyCategories.delete(categoryKey);
    }
  }
  
  // Aktiviere das Attribut automatisch
  activeAttributes.add(attrKey);
  
  // Markiere Kategorie als geändert
  modifiedCategories.add(categoryKey);
  if (debugMode) {
    console.log(`Kategorie "${categoryKey}" als geändert markiert. Hat Quelle:`, categorySourceFiles.has(categoryKey));
  }
  
  // UI aktualisieren
  buildAttributeLegend();
  updateAttributeStats();
  updateAttributeCircles();
  
  const nodeName = byId.get(personId)?.label || personId;
  showTemporaryNotification(`"${attributeName}" zu ${nodeName} hinzugefügt`);
}

/**
 * Erstellt ein hierarchisches Attribut-Menü als Submenu
 */
function addAttributeSubmenu(parentItem, mainMenu, nodeId) {
  let submenu = null;
  let submenuVisible = false;
  
  const showSubmenu = () => {
    if (submenuVisible) return;
    
    // Erstelle Submenu
    submenu = document.createElement('div');
    submenu.className = 'node-context-menu';
    submenu.setAttribute('data-level', '2');
    submenu.style.display = 'block';
    
    // Position rechts neben dem Parent-Item
    const rect = parentItem.getBoundingClientRect();
    submenu.style.left = `${rect.right}px`;
    submenu.style.top = `${rect.top}px`;
    
    // Kategorien sammeln
    const categories = new Map();
    for (const key of attributeTypes.keys()) {
      const [cat, name] = String(key).includes('::') ? String(key).split('::') : ['Attribute', String(key)];
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat).push({ key, name });
    }
    
    // Leere Kategorien hinzufügen
    for (const cat of emptyCategories) {
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
    }
    
    // Falls keine Attribute und keine leeren Kategorien vorhanden, nur "neue Kategorie" anzeigen
    if (categories.size === 0) {
      const item = createSubmenuItem('+ neue Kategorie ...', () => {
        hideAllMenus();
        promptNewCategory(nodeId);
      });
      submenu.appendChild(item);
    } else {
      // Kategorien sortieren und rendern - HIERARCHISCH
      const sortedCats = Array.from(categories.keys()).sort();
      
      for (const cat of sortedCats) {
        const attrs = categories.get(cat).sort((a, b) => a.name.localeCompare(b.name));
        
        // Kategorie als klickbares Item mit Pfeil (öffnet Sub-Submenu)
        const catItem = createCategorySubmenuItem(cat, attrs, nodeId, hideAllMenus);
        submenu.appendChild(catItem);
      }
      
      // Trennlinie vor "neue Kategorie"
      const divider = document.createElement('div');
      divider.className = 'menu-divider';
      submenu.appendChild(divider);
      
      // "neue Kategorie..." am Ende
      const newCatItem = createSubmenuItem('+ neue Kategorie ...', () => {
        hideAllMenus();
        promptNewCategory(nodeId);
      });
      submenu.appendChild(newCatItem);
    }
    
    document.body.appendChild(submenu);
    submenuVisible = true;
  };
  
  const hideSubmenu = () => {
    if (submenu && submenu.parentNode) {
      submenu.parentNode.removeChild(submenu);
    }
    submenu = null;
    submenuVisible = false;
  };
  
  const hideAllMenus = () => {
    // Verstecke alle Kategorie-Submenus
    document.querySelectorAll('.node-context-menu[data-level="3"]').forEach(sub => {
      if (sub !== submenu) {
        sub.remove();
      }
    });
    hideSubmenu();
    mainMenu.style.display = 'none';
  };
  
  // Event-Handler für Parent-Item
  parentItem.addEventListener('mouseenter', showSubmenu);
  parentItem.addEventListener('mouseleave', (e) => {
    // Prüfe, ob Maus zum Submenu gewechselt hat
    setTimeout(() => {
      const hasActiveCategoryMenu = document.querySelector('.node-context-menu[data-level="3"]');
      const isCategoryMenuHovered = hasActiveCategoryMenu && hasActiveCategoryMenu.matches(':hover');
      
      if (submenu && !submenu.matches(':hover') && !parentItem.matches(':hover') && !isCategoryMenuHovered) {
        hideSubmenu();
      }
    }, 100);
  });
  
  // Klick auf Parent öffnet/schließt Submenu
  parentItem.addEventListener('click', (e) => {
    e.stopPropagation();
    if (submenuVisible) {
      hideSubmenu();
    } else {
      showSubmenu();
    }
  });
  
  // Event-Handler für Submenu (falls erstellt)
  const setupSubmenuHandlers = () => {
    if (!submenu) return;
    
    submenu.addEventListener('mouseleave', (e) => {
      setTimeout(() => {
        // Prüfe ob ein Kategorie-Submenu (Ebene 3) aktiv ist
        const hasActiveCategoryMenu = document.querySelector('.node-context-menu[data-level="3"]');
        const isCategoryMenuHovered = hasActiveCategoryMenu && hasActiveCategoryMenu.matches(':hover');
        
        if (!submenu.matches(':hover') && !parentItem.matches(':hover') && !isCategoryMenuHovered) {
          hideSubmenu();
        }
      }, 100);
    });
  };
  
  // Setup-Handler nach Delay, damit Submenu erstellt wurde
  parentItem.addEventListener('mouseenter', () => {
    setTimeout(setupSubmenuHandlers, 10);
  });
}

/**
 * Erstellt ein Submenu-Item mit Hover-Effekt
 */
function createSubmenuItem(label, handler) {
  const item = document.createElement('div');
  item.className = 'menu-item';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'menu-item-label';
  labelSpan.textContent = label;
  item.appendChild(labelSpan);
  item.onclick = handler;
  return item;
}

/**
 * Erstellt ein hierarchisches Kategorie-Item mit eigenem Submenu
 */
function createCategorySubmenuItem(categoryName, attributes, nodeId, hideAllMenus) {
  const item = document.createElement('div');
  item.className = 'menu-item';
  
  const labelSpan = document.createElement('span');
  labelSpan.className = 'menu-item-label';
  labelSpan.textContent = categoryName;
  item.appendChild(labelSpan);
  
  const arrow = document.createElement('span');
  arrow.className = 'menu-item-arrow';
  arrow.textContent = '▶';
  item.appendChild(arrow);
  
  let categorySubmenu = null;
  let categorySubmenuVisible = false;
  
  const showCategorySubmenu = () => {
    if (categorySubmenuVisible) return;
    
    // Verstecke alle anderen Kategorie-Submenus
    document.querySelectorAll('.node-context-menu[data-level="3"]').forEach(sub => {
      if (sub !== categorySubmenu) {
        sub.remove();
      }
    });
    
    // Erstelle Kategorie-Submenu
    categorySubmenu = document.createElement('div');
    categorySubmenu.className = 'node-context-menu';
    categorySubmenu.setAttribute('data-level', '3');
    categorySubmenu.style.display = 'block';
    
    // Position rechts neben dem Kategorie-Item
    const rect = item.getBoundingClientRect();
    categorySubmenu.style.left = `${rect.right}px`;
    categorySubmenu.style.top = `${rect.top}px`;
    
    // Attribute der Kategorie hinzufügen
    if (attributes.length > 0) {
      for (const attr of attributes) {
        const attrItem = createSubmenuItem(attr.name, () => {
          hideAllMenus();
          addNodeToAttribute(nodeId, categoryName, attr.name);
        });
        categorySubmenu.appendChild(attrItem);
      }
      
      // Trennlinie
      const divider = document.createElement('div');
      divider.className = 'menu-divider';
      categorySubmenu.appendChild(divider);
    }
    
    // "neues Attribut..." für diese Kategorie
    const newAttrItem = createSubmenuItem('+ neues Attribut ...', () => {
      hideAllMenus();
      promptNewAttribute(nodeId, categoryName);
    });
    categorySubmenu.appendChild(newAttrItem);
    
    document.body.appendChild(categorySubmenu);
    categorySubmenuVisible = true;
    
    // Event-Handler für Kategorie-Submenu
    categorySubmenu.addEventListener('mouseleave', (e) => {
      setTimeout(() => {
        // Schließe nur das Kategorie-Submenu, nicht das Parent-Submenu
        if (!categorySubmenu.matches(':hover') && !item.matches(':hover')) {
          hideCategorySubmenu();
        }
      }, 100);
    });
  };
  
  const hideCategorySubmenu = () => {
    if (categorySubmenu && categorySubmenu.parentNode) {
      categorySubmenu.parentNode.removeChild(categorySubmenu);
    }
    categorySubmenu = null;
    categorySubmenuVisible = false;
  };
  
  // Event-Handler für Kategorie-Item
  item.addEventListener('mouseenter', () => {
    showCategorySubmenu();
  });
  
  item.addEventListener('mouseleave', (e) => {
    setTimeout(() => {
      if (categorySubmenu && !categorySubmenu.matches(':hover') && !item.matches(':hover')) {
        hideCategorySubmenu();
      }
    }, 100);
  });
  
  return item;
}

/**
 * Exportiert die Attribute einer Kategorie als CSV/TSV Datei
 */
function exportCategoryAttributes(categoryName) {
  const sourceInfo = categorySourceFiles.get(categoryName);
  if (!sourceInfo) {
    showTemporaryNotification(`Keine Quell-Informationen für Kategorie "${categoryName}" gefunden`, 3000);
    return;
  }
  
  const separator = sourceInfo.format === 'tab' ? '\t' : ',';
  const lines = [];
  
  // Sammle alle Personen mit Attributen in dieser Kategorie
  for (const [personId, attrs] of personAttributes.entries()) {
    for (const [attrKey, attrValue] of attrs.entries()) {
      const [cat, attrName] = String(attrKey).includes('::') ? String(attrKey).split('::') : ['Attribute', String(attrKey)];
      
      if (cat === categoryName) {
        // Versuche E-Mail oder ID zu finden
        const person = byId.get(personId);
        const identifier = person?.email || personId;
        
        // Nur 2 Spalten: ID/Email und Attributname (ohne Wert)
        lines.push(`${identifier}${separator}${attrName}`);
      }
    }
  }
  
  // Sortiere alphabetisch
  lines.sort();
  
  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = sourceInfo.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // Markiere Kategorie als nicht mehr geändert
  modifiedCategories.delete(categoryName);
  buildAttributeLegend();
  
  showTemporaryNotification(`"${sourceInfo.filename}" heruntergeladen`, 2000);
}

/**
 * Exportiert ein einzelnes Attribut als TSV-Datei
 * @param {string} attributeKey - Der vollständige Attribut-Key (z.B. "Kategorie::Attributname")
 */
function exportSingleAttribute(attributeKey) {
  const [category, attrName] = String(attributeKey).includes('::') 
    ? String(attributeKey).split('::') 
    : ['Attribute', String(attributeKey)];
  
  const lines = [];
  
  // Sammle alle Personen mit diesem spezifischen Attribut
  for (const [personId, attrs] of personAttributes.entries()) {
    if (attrs.has(attributeKey)) {
      const person = byId.get(personId);
      const identifier = person?.email || personId;
      lines.push(`${identifier}\t${attrName}`);
    }
  }
  
  if (lines.length === 0) {
    showTemporaryNotification(`Keine Einträge für "${attrName}" gefunden`, 2000);
    return;
  }
  
  // Sortiere alphabetisch
  lines.sort();
  
  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  // Dateiname: Kategorie_Attributname.tsv
  const safeCategory = category.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  const safeAttrName = attrName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  const filename = `${safeCategory}_${safeAttrName}.tsv`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showTemporaryNotification(`"${filename}" heruntergeladen (${lines.length} Einträge)`, 2000);
}

/**
 * Exportiert alle Attribute einer Kategorie als TSV-Datei
 * @param {string} categoryName - Name der Kategorie
 */
function exportCategoryAsTSV(categoryName) {
  const lines = [];
  
  // Sammle alle Personen mit Attributen in dieser Kategorie
  for (const [personId, attrs] of personAttributes.entries()) {
    for (const [attrKey, attrValue] of attrs.entries()) {
      const [cat, attrName] = String(attrKey).includes('::') 
        ? String(attrKey).split('::') 
        : ['Attribute', String(attrKey)];
      
      if (cat === categoryName) {
        const person = byId.get(personId);
        const identifier = person?.email || personId;
        lines.push(`${identifier}\t${attrName}`);
      }
    }
  }
  
  if (lines.length === 0) {
    showTemporaryNotification(`Keine Einträge für Kategorie "${categoryName}" gefunden`, 2000);
    return;
  }
  
  // Sortiere alphabetisch
  lines.sort();
  
  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  // Dateiname: Kategorie.tsv
  const safeCategory = categoryName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  const filename = `${safeCategory}.tsv`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showTemporaryNotification(`"${filename}" heruntergeladen (${lines.length} Einträge)`, 2000);
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

function ensureNodeMenu() {
  if (nodeMenuEl) return nodeMenuEl;
  const el = document.createElement('div');
  el.className = 'node-context-menu';
  const it = document.createElement('div');
  it.className = 'menu-item';
  it.textContent = 'Ausblenden';
  el.appendChild(it);
  document.body.appendChild(el);
  nodeMenuEl = el;
  document.addEventListener('click', () => { if (nodeMenuEl && nodeMenuEl.style.display === 'block') nodeMenuEl.style.display = 'none'; });
  return el;
}

function showNodeMenu(x, y, actionsOrOnHide) {
  const el = ensureNodeMenu();
  // Menü dynamisch aufbauen, aber Abwärtskompatibilität für alte Signatur behalten
  // Alte Signatur: actionsOrOnHide ist eine Funktion (Ausblenden)
  // Neue Signatur: Objekt { onHideSubtree, onRemoveRoot, isRoot, nodeId }
  while (el.firstChild) el.removeChild(el.firstChild);
  
  const addItem = (label, handler, hasSubmenu = false, disabled = false) => {
    const it = document.createElement('div');
    it.className = 'menu-item' + (disabled ? ' disabled' : '');
    
    const labelSpan = document.createElement('span');
    labelSpan.className = 'menu-item-label';
    labelSpan.textContent = label;
    it.appendChild(labelSpan);
    
    if (hasSubmenu) {
      const arrow = document.createElement('span');
      arrow.className = 'menu-item-arrow';
      arrow.textContent = '▶';
      it.appendChild(arrow);
    }
    
    if (!hasSubmenu && !disabled && handler) {
      it.onclick = () => { el.style.display = 'none'; handler(); };
    }
    el.appendChild(it);
    return it;
  };
  
  if (typeof actionsOrOnHide === 'function') {
    addItem('Ausblenden', actionsOrOnHide);
  } else {
    const actions = actionsOrOnHide || {};
    if (actions.onHideSubtree) addItem('Ausblenden', actions.onHideSubtree);
    
    // Neuer Root-Eintrag [SF]
    const isRootFlag = !!actions.isRoot;
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


