// ===== Gemeinsame Legend-Row-Factories (OE-, Hidden- und Attribut-Legende) [DRY][CA] =====

// Row-Skelett: .legend-row mit .legend-row-left (+ optional .legend-row-right)
export function createLegendRow({ active = false, withRight = true } = {}) {
  const row = document.createElement('div');
  row.className = active ? 'legend-row active' : 'legend-row';
  const left = document.createElement('div');
  left.className = 'legend-row-left';
  row.appendChild(left);
  let right = null;
  if (withRight) {
    right = document.createElement('div');
    right.className = 'legend-row-right';
    row.appendChild(right);
  }
  return { row, left, right };
}

// Einrückung pro Baum-Tiefe
export function createLegendDepthSpacer(widthPx) {
  const spacer = document.createElement('div');
  spacer.className = 'legend-depth-spacer';
  spacer.style.width = `${widthPx}px`;
  return spacer;
}

// Platzhalter, wo kein Chevron sitzt
export function createLegendTreeSpacer() {
  const spacer = document.createElement('div');
  spacer.className = 'legend-tree-spacer';
  return spacer;
}

// Label-Chip
export function createLegendChip(text, title) {
  const chip = document.createElement('span');
  chip.className = 'legend-label-chip';
  chip.textContent = text;
  if (title) chip.title = title;
  return chip;
}

// Aktions-Button rechts in der Row; onClick bekommt stopPropagation
export function createLegendIconButton({ icon, svg, title, className = '', onClick } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className ? `legend-icon-btn ${className}` : 'legend-icon-btn';
  if (title) btn.title = title;
  if (icon) setIcon(btn, icon);
  else if (svg) btn.innerHTML = svg;
  btn.setAttribute('data-ignore-header-click', 'true');
  if (onClick) btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return btn;
}

// Auf-/Zuklapp-Chevron: toggelt das erste <ul> im umgebenden <li>
// und meldet den neuen Zustand über onToggle(nowCollapsed)
export function createLegendChevron({ collapsed = false, onToggle } = {}) {
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = collapsed ? 'legend-tree-chevron collapsed' : 'legend-tree-chevron expanded';
  chevron.title = 'Ein-/Ausklappen';
  chevron.innerHTML = getChevronSVG();
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    const li = chevron.closest('li');
    const sub = li && li.querySelector('ul');
    if (!sub) return;
    const wasCollapsed = sub.style.display === 'none';
    sub.style.display = wasCollapsed ? '' : 'none';
    chevron.className = wasCollapsed ? 'legend-tree-chevron expanded' : 'legend-tree-chevron collapsed';
    if (onToggle) onToggle(!wasCollapsed);
  });
  return chevron;
}

export function buildHiddenLegend() {
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
    // Kein .active State für ausgeblendete Items
    const { row, left, right } = createLegendRow();

    // Spacer statt Chevron
    left.appendChild(createLegendTreeSpacer());

    // Label (pseudonymisiert wenn aktiv)
    const node = byId.get(root);
    const name = getDisplayLabel(node);
    const chip = createLegendChip(`${name} (${setIds.size})`, name);
    chip.dataset.rootId = root; // Für spätere Aktualisierung
    left.appendChild(chip);

    // X-Button zum Entfernen (unhide)
    right.appendChild(createLegendIconButton({
      icon: 'close',
      title: 'Wieder einblenden',
      onClick: () => unhideSubtree(root),
    }));

    // Eye-Button zum temporären Ein-/Ausblenden (ganz rechts)
    const isVisible = allHiddenTemporarilyVisible || temporarilyVisibleRoots.has(root);
    const eyeBtn = createLegendIconButton({
      icon: isVisible ? 'eye' : 'eyeClosed',
      title: isVisible ? 'Temporär ausblenden' : 'Temporär einblenden',
      className: isVisible ? 'active' : '',
      onClick: () => toggleHiddenRootVisibility(root),
    });
    eyeBtn.dataset.rootId = root;
    right.appendChild(eyeBtn);

    li.appendChild(row);
    ul.appendChild(li);
  }
  legend.appendChild(ul);
}

let legendCollapsedItems = new Set();

// Initialisiert legendCollapsedItems: Erste Kinder mit Geschwistern werden collapsed [SF][CA]
export function initLegendCollapsedItems(scopeSet) {
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
export function renderOrgLegendNode(oid, depth, options) {
  const { childrenProvider, scopeSet, registerNode } = options || {};
  const id = String(oid);

  if (scopeSet && !scopeSet.has(id)) return null;

  const li = document.createElement('li');
  li.dataset.oid = id;
  const node = byId.get(id);
  const lbl = getDisplayLabel(node, depth);
  const idAttr = `org_${id}`;

  const { row, left } = createLegendRow();

  left.appendChild(createLegendDepthSpacer(Math.max(0, Number(depth) || 0) * 16));

  const rawChildren = Array.from((childrenProvider && childrenProvider(id)) || []);
  const kids = scopeSet
    ? rawChildren.filter(k => scopeSet.has(String(k)))
    : rawChildren;

  if (kids.length) {
    left.appendChild(createLegendChevron({
      collapsed: legendCollapsedItems.has(id),
      onToggle: (nowCollapsed) => {
        if (nowCollapsed) legendCollapsedItems.add(id);
        else legendCollapsedItems.delete(id);
      },
    }));
  } else {
    left.appendChild(createLegendTreeSpacer());
  }

  left.appendChild(createLegendChip(lbl, lbl));

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
    
    // Unified context menu (E24): legend rows and graph nodes share the same
    // action list; row semantics map onto the fixed entries.
    showNodeMenu(e.clientX, e.clientY, {
      onUnhide: () => {
        allowedOrgs.add(id);
        allDescendantIds.forEach(cid => allowedOrgs.add(cid));
        syncGraphAndLegendColors();
      },
      onHideSubtree: () => {
        allowedOrgs.delete(id);
        allDescendantIds.forEach(cid => allowedOrgs.delete(cid));
        syncGraphAndLegendColors();
      },
      isRoot: Array.isArray(selectedRootIds) && selectedRootIds.includes(String(id)),
      onSetAsRoot: () => {
        // v2 resolves a cluster hit to the nearest anchor node (E64); the
        // legacy path roots the id directly.
        selectedRootIds = [];
        currentSelectedId = String(id);
        applyFromUI('legendSetRoot');
      },
      onRemoveRoot: () => { removeRoot(String(id)); applyFromUI('legendRemoveRoot'); },
      onOnlyDirectChildren: () => {
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

export function buildOrgLegend() {
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
      if (drawKindOf(byId.get(s)) !== 'cluster' || drawKindOf(byId.get(t)) !== 'cluster') continue;
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
export function buildScopedOrgLegend(visibleSet) {
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

export function applyLegendScope(scope) {
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

export function updateLegendChips(rootEl) {
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

export function updateLegendRowColors(rootEl) {
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
export function collectSubtree(rootId, children, scopeSet) {
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

export function ensureLegendMenu() {
  if (legendMenuEl) return legendMenuEl;
  const el = document.createElement('div');
  el.className = 'node-context-menu';
  const mkItem = (label) => createSubmenuItem(label, hideLegendMenu);

  // Erweiterte Menü-Optionen
  el.appendChild(mkItem('Alle einblenden'));
  el.appendChild(mkItem('Alle ausblenden'));

  // Trennlinie
  const divider = document.createElement('div');
  divider.className = 'menu-divider';
  el.appendChild(divider);
  
  // Neue Option: Nur direkte Kinder anzeigen
  el.appendChild(mkItem('Nur direkte Kinder anzeigen'));
  
  document.body.appendChild(el);
  legendMenuEl = el;
  // Dismiss on click elsewhere
  document.addEventListener('click', (e) => { if (legendMenuEl && legendMenuEl.style.display === 'block') hideLegendMenu(); });
  return el;
}
export function showLegendMenu(x, y, actions) {
  const el = ensureLegendMenu();
  // Wire actions
  const items = el.querySelectorAll('.menu-item');
  items[0].onclick = () => { hideLegendMenu(); actions.onShowAll(); };
  items[1].onclick = () => { hideLegendMenu(); actions.onHideAll(); };
  items[2].onclick = () => { hideLegendMenu(); actions.onShowDirectChildrenOnly(); };
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}
export function hideLegendMenu() { if (legendMenuEl) legendMenuEl.style.display = 'none'; }

/**
 * Fügt einen Knoten zu einem Attribut hinzu
 */
export function addNodeToAttribute(nodeId, categoryKey, attributeName, attributeValue = '1') {
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

  // Categories created in the UI get a source entry right away so the
  // save button appears for them as well
  if (!categorySourceFiles.has(categoryKey)) {
    categorySourceFiles.set(categoryKey, {
      filename: `${categoryKey}.tsv`,
      url: null,
      originalText: '',
      format: 'tab',
    });
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
export function addAttributeSubmenu(parentItem, mainMenu, nodeId) {
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
 * Optionen: arrow (Submenu-Pfeil rechts), disabled (ausgegraut, nicht klickbar)
 */
export function createSubmenuItem(label, handler, { arrow = false, disabled = false } = {}) {
  const item = document.createElement('div');
  item.className = 'menu-item' + (disabled ? ' disabled' : '');
  const labelSpan = document.createElement('span');
  labelSpan.className = 'menu-item-label';
  labelSpan.textContent = label;
  item.appendChild(labelSpan);
  if (arrow) {
    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'menu-item-arrow';
    arrowSpan.textContent = '▶';
    item.appendChild(arrowSpan);
  }
  if (handler) item.onclick = handler;
  return item;
}

/**
 * Erstellt ein hierarchisches Kategorie-Item mit eigenem Submenu
 */
export function createCategorySubmenuItem(categoryName, attributes, nodeId, hideAllMenus) {
  const item = createSubmenuItem(categoryName, null, { arrow: true });
  
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

/** Triggers a browser download for the given text content. */
export function triggerDownload(filename, content, mime = 'text/tab-separated-values;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Collects a category's assignments as sorted `identifier<sep>attrName` lines.
 * A value other than the default '1' is kept as third column, so files with
 * attribute values survive a load/save roundtrip.
 */
export function buildCategoryLines(categoryName, separator = '\t') {
  const lines = [];
  for (const [personId, attrs] of personAttributes.entries()) {
    for (const [attrKey, attrValue] of attrs.entries()) {
      const [cat, attrName] = String(attrKey).includes('::') ? String(attrKey).split('::') : ['Attribute', String(attrKey)];
      if (cat !== categoryName) continue;
      const person = byId.get(personId);
      const identifier = person?.email || personId;
      const valueSuffix = (attrValue != null && String(attrValue) !== '1') ? `${separator}${attrValue}` : '';
      lines.push(`${identifier}${separator}${attrName}${valueSuffix}`);
    }
  }
  lines.sort();
  return lines;
}

// Remembered file handles per category for direct overwrites (FS Access API)
let categoryFileHandles = new Map();

/**
 * Writes a category file to disk: via the File System Access API when the
 * browser supports it (the picked handle is remembered per category, so
 * subsequent saves overwrite the same file without a dialog), otherwise as
 * a plain download. Returns 'picker' | 'download' | 'aborted'.
 */
export async function writeCategoryFile(categoryName, filename, content) {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      let handle = categoryFileHandles.get(categoryName);
      if (handle && handle.queryPermission) {
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && handle.requestPermission) {
          perm = await handle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') handle = null;
      }
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Attribut-Datei',
            accept: { 'text/plain': ['.tsv', '.txt', '.csv'] },
          }],
        });
        categoryFileHandles.set(categoryName, handle);
      }
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return 'picker';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'aborted';
      console.error('Direktes Speichern fehlgeschlagen, Fallback auf Download:', e);
      categoryFileHandles.delete(categoryName);
    }
  }
  triggerDownload(filename, content);
  return 'download';
}

/**
 * Saves a category permanently: first into IndexedDB (under the same key as
 * the imported file, so every reload re-parses the updated content), then to
 * disk. The modified flag is only cleared after the IndexedDB write succeeded.
 */
export async function saveCategory(categoryName) {
  // Categories created in the UI may lack a source entry; create one here
  let sourceInfo = categorySourceFiles.get(categoryName);
  if (!sourceInfo) {
    sourceInfo = { filename: `${categoryName}.tsv`, url: null, originalText: '', format: 'tab' };
    categorySourceFiles.set(categoryName, sourceInfo);
  }
  const separator = sourceInfo.format === 'tab' ? '\t' : ',';
  const content = buildCategoryLines(categoryName, separator).join('\n');

  try {
    await putStored(ATTR_PREFIX + sourceInfo.filename, content);
    await putStored(ATTR_PREFIX + sourceInfo.filename + '::name', sourceInfo.filename);
    sourceInfo.originalText = content;
  } catch (e) {
    console.error('Speichern in IndexedDB fehlgeschlagen:', e);
    showTemporaryNotification(`Speichern von "${categoryName}" fehlgeschlagen`, 4000);
    return false;
  }

  modifiedCategories.delete(categoryName);
  buildAttributeLegend();

  const disk = await writeCategoryFile(categoryName, sourceInfo.filename, content);
  if (disk === 'picker') {
    showTemporaryNotification(`"${sourceInfo.filename}" gespeichert (lokal + Datei)`, 2500);
  } else if (disk === 'download') {
    showTemporaryNotification(`"${sourceInfo.filename}" gespeichert (lokal) und heruntergeladen`, 2500);
  } else {
    showTemporaryNotification(`"${sourceInfo.filename}" lokal gespeichert – Dateiexport abgebrochen`, 2500);
  }
  return true;
}

/**
 * Exportiert ein einzelnes Attribut als TSV-Datei
 * @param {string} attributeKey - Der vollständige Attribut-Key (z.B. "Kategorie::Attributname")
 */
export function exportSingleAttribute(attributeKey) {
  const [category, attrName] = String(attributeKey).includes('::') 
    ? String(attributeKey).split('::') 
    : ['Attribute', String(attributeKey)];
  
  const lines = [];
  
  // Sammle alle Personen mit diesem spezifischen Attribut
  for (const [personId, attrs] of personAttributes.entries()) {
    if (attrs.has(attributeKey)) {
      const person = byId.get(personId);
      const identifier = person?.email || personId;
      const attrValue = attrs.get(attributeKey);
      const valueSuffix = (attrValue != null && String(attrValue) !== '1') ? `\t${attrValue}` : '';
      lines.push(`${identifier}\t${attrName}${valueSuffix}`);
    }
  }
  
  if (lines.length === 0) {
    showTemporaryNotification(`Keine Einträge für "${attrName}" gefunden`, 2000);
    return;
  }

  // Sortiere alphabetisch
  lines.sort();

  // Dateiname: Kategorie_Attributname.tsv
  const safeCategory = category.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  const safeAttrName = attrName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  const filename = `${safeCategory}_${safeAttrName}.tsv`;
  triggerDownload(filename, lines.join('\n'));

  showTemporaryNotification(`"${filename}" heruntergeladen (${lines.length} Einträge)`, 2000);
}

/**
 * Exportiert alle Attribute einer Kategorie als TSV-Datei
 * @param {string} categoryName - Name der Kategorie
 */
export function exportCategoryAsTSV(categoryName) {
  const lines = buildCategoryLines(categoryName);

  if (lines.length === 0) {
    showTemporaryNotification(`Keine Einträge für Kategorie "${categoryName}" gefunden`, 2000);
    return;
  }

  // Dateiname: Kategorie.tsv
  const safeCategory = categoryName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  const filename = `${safeCategory}.tsv`;
  triggerDownload(filename, lines.join('\n'));

  showTemporaryNotification(`"${filename}" heruntergeladen (${lines.length} Einträge)`, 2000);
}

/**
 * Prompt für neues Attribut in bestehender Kategorie
 */
export function promptNewAttribute(nodeId, category) {
  const name = prompt(`Neues Attribut für Kategorie "${category}":`, '');
  if (!name || !name.trim()) return;
  
  // Wert ist immer "1" - wird für Zählzwecke verwendet
  addNodeToAttribute(nodeId, category, name.trim(), '1');
}

/**
 * Prompt für neue Kategorie
 */
export function promptNewCategory(nodeId) {
  const category = prompt('Name der neuen Kategorie:', '');
  if (!category || !category.trim()) return;
  
  const attrName = prompt(`Attributname für "${category.trim()}":`, '');
  if (!attrName || !attrName.trim()) return;
  
  // Wert ist immer "1" - wird für Zählzwecke verwendet
  addNodeToAttribute(nodeId, category.trim(), attrName.trim(), '1');
}

export function ensureNodeMenu() {
  if (nodeMenuEl) return nodeMenuEl;
  const el = document.createElement('div');
  el.className = 'node-context-menu';
  el.appendChild(createSubmenuItem('Ausblenden', null));
  document.body.appendChild(el);
  nodeMenuEl = el;
  document.addEventListener('click', () => { if (nodeMenuEl && nodeMenuEl.style.display === 'block') nodeMenuEl.style.display = 'none'; });
  return el;
}

export function showNodeMenu(x, y, actionsOrOnHide) {
  const el = ensureNodeMenu();
  // Menü dynamisch aufbauen, aber Abwärtskompatibilität für alte Signatur behalten
  // Alte Signatur: actionsOrOnHide ist eine Funktion (Ausblenden)
  // Neue Signatur: Objekt { onHideSubtree, onRemoveRoot, isRoot, nodeId }
  while (el.firstChild) el.removeChild(el.firstChild);
  
  const addItem = (label, handler, hasSubmenu = false, disabled = false) => {
    const wrapped = (!hasSubmenu && !disabled && handler)
      ? () => { el.style.display = 'none'; handler(); }
      : null;
    const it = createSubmenuItem(label, wrapped, { arrow: hasSubmenu, disabled });
    el.appendChild(it);
    return it;
  };
  
  if (typeof actionsOrOnHide === 'function') {
    addItem('Ausblenden', actionsOrOnHide);
  } else {
    // Unified type-independent menu (E24, FR-8.7): one action list for graph
    // nodes and legend rows; inapplicable entries are DISABLED, never hidden.
    // The attribute editing submenu is gone (§9.3: data maintenance happens
    // at the source or in the crawl, never in the viewer).
    const actions = actionsOrOnHide || {};
    const isRootFlag = !!actions.isRoot;
    addItem('Ausblenden', actions.onHideSubtree, false, !actions.onHideSubtree);
    addItem('Einblenden', actions.onUnhide, false, !actions.onUnhide);
    addItem('Nur direkte Kinder anzeigen', actions.onOnlyDirectChildren, false, !actions.onOnlyDirectChildren);
    addItem('Als Root definieren', actions.onSetAsRoot, false, !actions.onSetAsRoot || isRootFlag);
    // Only active while the node IS a root and more than one root is set —
    // the last root is not removable (an empty projection is impossible).
    const canRemoveRoot = isRootFlag && !!actions.onRemoveRoot
      && Array.isArray(selectedRootIds) && selectedRootIds.length > 1;
    addItem('Als Root entfernen', actions.onRemoveRoot, false, !canRemoveRoot);
  }
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.display = 'block';
}


