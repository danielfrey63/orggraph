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

// Einrückung pro Baum-Tiefe: der 16px-Schritt gehört dem Spacer, nicht den Aufrufern
export function createLegendDepthSpacer(depth) {
  const spacer = document.createElement('div');
  spacer.className = 'legend-depth-spacer';
    spacer.style.width = `${Math.max(0, Number(depth) || 0) * cssNumber('--legend-depth-step')}px`;
  return spacer;
}

// Platzhalter, wo kein Chevron sitzt
export function createLegendTreeSpacer() {
  const spacer = document.createElement('div');
  spacer.className = 'legend-tree-spacer';
  return spacer;
}

// Label-Chip
// Chip-Beschriftung: sichtbarer Text mit optionalem Zähler; der Titel bleibt
// das blanke Label. Von 12 (Hidden-Legende) und 06 (Pseudo-Refresh) geteilt.
export function legendChipText(label, count) {
  return count == null ? label : `${label} (${count})`;
}

// Tooltip-Gegenstück zu legendChipText (Attribut-Legende in 16).
export function legendChipTitle(label, count) {
  return `${label} - ${count} Einträge`;
}

// Text/tooltip pair of a chip — always changes together (construction + refresh).
export function setLegendChipText(chip, text, title) {
  chip.textContent = text;
  if (title) chip.title = title;
}

export function createLegendChip(text, title) {
  const chip = document.createElement('span');
  chip.className = 'legend-label-chip';
  setLegendChipText(chip, text, title);
  return chip;
}

// Aktions-Button rechts in der Row; onClick bekommt stopPropagation
// Minimal icon-button primitive shared by every icon-button flavour
// (legend buttons below). Icons come from the ICON registry only.
export function createIconButton({ icon, title, className = '', onClick } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (className) btn.className = className;
  if (title) btn.title = title;
  if (icon) setIcon(btn, icon);
  if (onClick) btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); });
  return btn;
}

export function createLegendIconButton({ icon, title, className = '', onClick, dimmed } = {}) {
  const btn = createIconButton({
    icon, title, onClick,
    className: className ? `legend-icon-btn ${className}` : 'legend-icon-btn',
  });
    btn.setAttribute('data-ignore-header-click', 'true');
  if (typeof dimmed === 'boolean') setLegendIconButtonState(btn, { dimmed });
  return btn;
}

// Exklusiv-Auswahl in einer Button-Gruppe: genau das übergebene Element trägt
// active, alle anderen verlieren es (el = null leert die Gruppe).
export function setExclusiveActive(group, el, { className = 'active' } = {}) {
  for (const item of group) item.classList.toggle(className, item === el);
}

// Aktiv-Zustand einer bestehenden Legend-Row; Gegenstück zum active-Flag,
// das createLegendRow bei der Konstruktion setzt.
export function setLegendRowActive(row, active) {
  if (row) row.classList.toggle('active', !!active);
}

// Post-construction state of ANY icon button, regardless of its base class:
// modifier class, icon and title swap together so none of them drifts.
export function setIconButtonState(btn, { icon, title, active } = {}) {
  if (!btn) return;
  if (typeof active === 'boolean') btn.classList.toggle('active', active);
  if (title != null) btn.title = title;
  if (icon) setIcon(btn, icon);
}

// Legend flavour: adds the legend-only dimmed/visible modifiers on top.
// Sole owner of post-construction legend-icon-button state (eye toggles in
// 11, 16 and 18; oeFilter button visibility in 19).
export function setLegendIconButtonState(btn, { icon, title, active, dimmed, visible } = {}) {
  if (!btn) return;
  if (typeof dimmed === 'boolean') btn.classList.toggle('dimmed', dimmed);
  if (typeof visible === 'boolean') btn.classList.toggle('visible', visible);
  setIconButtonState(btn, { icon, title, active });
}

// Collapse state of a legend subtree: the first <ul> inside the chevron's <li>
// plus the chevron's own expanded/collapsed class. Single owner of that display
// toggle — every collapse/expand path (click, collapse-children, collapse-all)
// routes through here.
// Chevron modifier state shared by construction (createLegendChevron) and the
// subtree setter below — classes are toggled, the base string never rebuilt.
function applyLegendChevronState(chevron, collapsed) {
  chevron.classList.add('legend-tree-chevron');
  chevron.classList.toggle('collapsed', collapsed);
  chevron.classList.toggle('expanded', !collapsed);
}

export function setLegendSubtreeCollapsed(chevron, collapsed) {
  const li = chevron.closest('li');
  const sub = li && li.querySelector('ul');
  if (sub) sub.style.display = collapsed ? 'none' : '';
  applyLegendChevronState(chevron, collapsed);
}

// Collapse state of a sidebar legend *section*: the content element's
// `collapsed` class plus the section chevron's expanded/collapsed pair.
// Single owner of that toggle — localStorage/ENV init, chevron click, header
// click and expand-all (16, 18, 19) all route through here.
export function setLegendSectionCollapsed(chevronBtn, contentEl, collapsed) {
  if (contentEl) contentEl.classList.toggle('collapsed', collapsed);
  if (chevronBtn) {
    chevronBtn.classList.toggle('collapsed', collapsed);
    chevronBtn.classList.toggle('expanded', !collapsed);
  }
}

// Auf-/Zuklapp-Chevron: toggelt das erste <ul> im umgebenden <li>
// und meldet den neuen Zustand über onToggle(nowCollapsed)
export function createLegendChevron({ collapsed = false, onToggle } = {}) {
  const chevron = document.createElement('button');
  chevron.type = 'button';
  applyLegendChevronState(chevron, collapsed);
  chevron.title = 'Ein-/Ausklappen';
  setIcon(chevron, 'chevronDown');
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    const li = chevron.closest('li');
    const sub = li && li.querySelector('ul');
    if (!sub) return;
    const nowCollapsed = sub.style.display !== 'none';
    setLegendSubtreeCollapsed(chevron, nowCollapsed);
    if (onToggle) onToggle(nowCollapsed);
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
        const chip = createLegendChip(legendChipText(name, setIds.size), name);
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

  const { row, left } = createLegendRow();

  left.appendChild(createLegendDepthSpacer(depth));

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
        if (childLi.dataset.oid) {
          directChildrenIds.add(childLi.dataset.oid);
          allDescendantIds.add(childLi.dataset.oid);
        }
        childLi.querySelectorAll('li[data-oid]').forEach(el => allDescendantIds.add(el.dataset.oid));
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
                allDescendantIds.forEach(cid => allowedOrgs.delete(cid));
        
        allowedOrgs.add(id);
        directChildrenIds.forEach(cid => allowedOrgs.add(cid));
        
        if (subRoot) {
          Array.from(subRoot.children).forEach(childLi => {
            // A child with a subtree always carries its chevron (see above).
            const chevron = childLi.querySelector(':scope > .legend-row .legend-tree-chevron');
            if (chevron) setLegendSubtreeCollapsed(chevron, true);
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
  
    // Restrict the selection to the rendered legend; skipped while OEs are
  // deliberately hidden (allowedOrgs stays empty then).
  if (oesVisible) {
    const newAllowed = new Set();
    root.querySelectorAll('.legend-list li[data-oid]').forEach(li => {
      if (allowedOrgs.has(li.dataset.oid)) newAllowed.add(li.dataset.oid);
    });
    allowedOrgs = newAllowed;
  }
  // Wenn OEs ausgeblendet sind (oesVisible=false), dann bleibt allowedOrgs leer
}

export function updateLegendRowColors(rootEl) {
  const root = rootEl || document;
    root.querySelectorAll('.legend-list > li, .legend-list li').forEach(li => {
    const row = li.querySelector(':scope > .legend-row');
    const oid = li.dataset.oid;
    if (!row || !oid) return;
    const { stroke, fill } = colorForOrg(oid);

    // Setze Farben immer als CSS-Custom-Properties (für Hover-Effekt bei inaktiven Rows)
    row.style.setProperty('--org-fill', fill);
    row.style.setProperty('--org-stroke', stroke);

    setLegendRowActive(row, allowedOrgs.has(oid));
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
    setIcon(arrowSpan, 'chevronRight');
    item.appendChild(arrowSpan);
  }
  if (handler) item.onclick = handler;
  return item;
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


