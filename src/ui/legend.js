import { graphStore } from '../state/store.js';
import { colorForOrg } from './colors.js';
import { getChevronSVG } from './icons.js';
import { pseudonymizationService } from '../services/pseudonymization.js';
import { getOrgDepth } from '../graph/adjacency.js';
import { showLegendMenu } from './menus.js';
import { exportCategoryAttributes, exportCategoryAsTSV } from './export.js';

/**
 * Legend UI Component
 */
export class LegendUI {
  constructor() {
    this.legendEl = document.getElementById('legend');
    this.hiddenLegendEl = document.getElementById('hiddenLegend');
    this.attributeLegendEl = document.getElementById('attributeLegend');
    
    this.legendCollapsedItems = new Set();
    this.orgLegendNodes = new Map();
    
    // Bind methods
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
    
    // Subscribe to store
    this.unsubscribe = graphStore.subscribe(this.handleStoreUpdate);
  }
  
  init() {
    // Initial build
    this.buildOrgLegend();
    this.buildAttributeLegend();
    this.buildHiddenLegend();
  }
  
  destroy() {
    if (this.unsubscribe) this.unsubscribe();
  }
  
  handleStoreUpdate({ event, state }) {
    switch (event) {
      case 'allowedOrgs:update':
      case 'orgRoots:update':
      case 'hierarchy:update': {
        // Debug: Log incoming hierarchy/allowedOrgs state before (re)building the OE legend [DEBUG]
        const { raw, orgRoots, orgChildren, orgParent, allowedOrgs } = state;
        console.log('[Legend][StoreUpdate]', event, {
          rawOrgs: raw?.orgs?.length,
          orgRoots: Array.isArray(orgRoots) ? orgRoots.slice(0, 10) : orgRoots,
          orgRootsSize: Array.isArray(orgRoots) ? orgRoots.length : (orgRoots && orgRoots.size),
          orgChildrenSize: orgChildren ? orgChildren.size : null,
          orgParentSize: orgParent ? orgParent.size : null,
          allowedOrgsSize: allowedOrgs ? allowedOrgs.size : null
        });

        if (event === 'allowedOrgs:update') {
            this.updateLegendChips();
            this.updateLegendRowColors();
        } else {
            this.buildOrgLegend();
        }
        break;
      }
      case 'personAttributes:update':
      case 'activeAttributes:update':
      case 'attributeTypes:update':
      case 'modifiedCategories:update':
      case 'categorySourceFiles:update':
      case 'collapsedCategories:update':
        this.buildAttributeLegend();
        break;
      case 'hiddenByRoot:update':
      case 'hiddenNodes:update':
      case 'temporarilyVisibleRoots:update':
      case 'allHiddenTemporarilyVisible:update':
      case 'currentHiddenCount:update':
        this.buildHiddenLegend();
        break;
      case 'pseudonymization:update':
        this.buildOrgLegend();
        this.buildAttributeLegend();
        this.buildHiddenLegend();
        break;
    }
  }

  // --- Org Legend ---

  buildOrgLegend() {
    if (!this.legendEl) return;
    this.legendEl.innerHTML = '';
    
    const { raw, orgRoots, orgChildren, orgParent } = graphStore.state;
    // Determine roots
    let roots = Array.isArray(orgRoots) && orgRoots.length > 0 ? orgRoots.slice() : [];
    
    // If no roots found but we have orgs, try to find them manually (fallback)
    if (roots.length === 0 && raw && raw.orgs && raw.orgs.length > 0) {
        const orgIds = new Set(raw.orgs.map(o => String(o.id)));
        roots = Array.from(orgIds).filter(id => {
            const p = orgParent?.get(id);
            return !p || !orgIds.has(String(p));
        });
    }

    this.orgLegendNodes.clear();
    const ul = document.createElement('ul');
    ul.className = 'legend-list';
    
    const options = {
        childrenProvider: (id) => {
            const children = orgChildren?.get(String(id));
            return children ? Array.from(children) : [];
        },
        registerNode: (id, li) => { this.orgLegendNodes.set(id, li); }
    };

    for (const r of roots) {
      const li = this.renderOrgLegendNode(r, 0, options);
      if (li) ul.appendChild(li);
    }
    
    this.legendEl.appendChild(ul);
    this.syncGraphAndLegendColors();
  }

  renderOrgLegendNode(oid, depth, options) {
    const { childrenProvider, registerNode } = options || {};
    const id = String(oid);
    const { byId, allowedOrgs, parentOf } = graphStore.state;

    const li = document.createElement('li');
    li.dataset.oid = id;
    const node = byId.get(id);
    
    const orgLevel = depth; // approximate
    const lbl = pseudonymizationService.getDisplayLabel(node, orgLevel, parentOf);
    
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
    
    if (rawChildren.length) {
      const chevron = document.createElement('button');
      chevron.type = 'button';
      const isCollapsed = this.legendCollapsedItems.has(id);
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
            this.legendCollapsedItems.delete(id);
          } else {
            this.legendCollapsedItems.add(id);
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
      const currentAllowed = new Set(graphStore.state.allowedOrgs);
      if (currentAllowed.has(id)) {
        currentAllowed.delete(id);
      } else {
        currentAllowed.add(id);
      }
      graphStore.setAllowedOrgs(currentAllowed);
    });
    row.style.cursor = 'pointer';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'checkbox';
    hiddenInput.id = idAttr;
    hiddenInput.style.display = 'none';
    hiddenInput.checked = allowedOrgs.has(id);
    row.appendChild(hiddenInput);

    li.appendChild(row);

    if (rawChildren.length) {
      const sub = document.createElement('ul');
      if (this.legendCollapsedItems.has(id)) {
        sub.style.display = 'none';
      }
      for (const k of rawChildren) {
        const childLi = this.renderOrgLegendNode(k, (depth || 0) + 1, options);
        if (childLi) sub.appendChild(childLi);
      }
      li.appendChild(sub);
    }

    const onCtx = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showOrgContextMenu(e, id);
    };
    
    li.addEventListener('contextmenu', onCtx);
    row.addEventListener('contextmenu', onCtx);

    if (registerNode) registerNode(id, li);

    return li;
  }

  showOrgContextMenu(e, id) {
    const { allowedOrgs, orgChildren } = graphStore.state;
    // Gather descendants
    const getAllDescendants = (rootId) => {
        const res = new Set();
        const stack = [rootId];
        while(stack.length) {
            const curr = stack.pop();
            const children = orgChildren?.get(String(curr));
            if(children) {
                children.forEach(c => {
                    const cid = String(c);
                    res.add(cid);
                    stack.push(cid);
                });
            }
        }
        return res;
    };
    const descendants = getAllDescendants(id);
    const directChildren = orgChildren?.get(String(id)) || new Set();

    showLegendMenu(e.clientX, e.clientY, [
        {
            label: 'Alle einblenden',
            handler: () => {
                const newAllowed = new Set(allowedOrgs);
                newAllowed.add(id);
                descendants.forEach(d => newAllowed.add(d));
                graphStore.setAllowedOrgs(newAllowed);
            }
        },
        {
            label: 'Alle ausblenden',
            handler: () => {
                const newAllowed = new Set(allowedOrgs);
                newAllowed.delete(id);
                descendants.forEach(d => newAllowed.delete(d));
                graphStore.setAllowedOrgs(newAllowed);
            }
        },
        {
            label: 'Nur direkte Kinder anzeigen',
            handler: () => {
                const newAllowed = new Set(allowedOrgs);
                // Hide all descendants first
                descendants.forEach(d => newAllowed.delete(d));
                // Show root and direct children
                newAllowed.add(id);
                directChildren.forEach(d => newAllowed.add(String(d)));
                
                graphStore.setAllowedOrgs(newAllowed);
            }
        }
    ]);
  }

  syncGraphAndLegendColors() {
    this.updateLegendRowColors();
  }

  updateLegendRowColors() {
    const { allowedOrgs, parentOf } = graphStore.state;
    if (!this.legendEl) return;
    
    this.legendEl.querySelectorAll('.legend-list > li, .legend-list li').forEach(li => {
      const row = li.querySelector(':scope > .legend-row');
      if (!row) return;
      
      const oid = li.dataset.oid;
      if (!oid) return;
      
      const { stroke, fill } = colorForOrg(oid, (id) => getOrgDepth(id, parentOf));
      
      row.style.setProperty('--org-fill', fill);
      row.style.setProperty('--org-stroke', stroke);
      
      const isActive = allowedOrgs.has(oid);
      if (isActive) {
        row.classList.add('active');
      } else {
        row.classList.remove('active');
      }
      
      // Update hidden checkbox
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = isActive;
    });
  }
  
  updateLegendChips() {
      this.updateLegendRowColors();
  }

  // --- Attribute Legend ---

  buildAttributeLegend() {
    if (!this.attributeLegendEl) return;
    this.attributeLegendEl.innerHTML = '';
    
    const { attributeTypes, activeAttributes, collapsedCategories, categorySourceFiles, modifiedCategories } = graphStore.state;
    
    if (attributeTypes.size === 0 && graphStore.state.emptyCategories.size === 0) return;
    
    // Group by category
    const categories = new Map();
    for (const key of attributeTypes.keys()) {
      const parts = key.split('::');
      const cat = parts.length > 1 ? parts[0] : 'Attribute';
      const name = parts.length > 1 ? parts[1] : key;
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat).push({ key, name, color: attributeTypes.get(key) });
    }
    
    // Include empty categories
    for (const cat of graphStore.state.emptyCategories) {
        if (!categories.has(cat)) categories.set(cat, []);
    }
    
    const sortedCats = Array.from(categories.keys()).sort();
    
    for (const cat of sortedCats) {
      const attrs = categories.get(cat);
      // Container for category
      const catDiv = document.createElement('div');
      catDiv.className = 'attribute-category';
      
      // Header
      const header = document.createElement('div');
      header.className = 'attribute-category-header';
      
      // Collapse Chevron
      const chevron = document.createElement('button');
      chevron.className = collapsedCategories.has(cat) ? 'legend-chevron collapsed' : 'legend-chevron expanded';
      chevron.innerHTML = getChevronSVG();
      chevron.onclick = (e) => {
        e.stopPropagation();
        const newCollapsed = new Set(collapsedCategories);
        if (newCollapsed.has(cat)) newCollapsed.delete(cat);
        else newCollapsed.add(cat);
        graphStore.setCollapsedCategories(newCollapsed);
      };
      
      // Label
      const label = document.createElement('span');
      label.className = 'category-label';
      label.textContent = cat;
      if (modifiedCategories.has(cat)) {
        label.classList.add('modified');
        label.title = 'Ungespeicherte Änderungen';
      }
      
      // Header Actions
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'category-actions';
      
      // Download Button
      const sourceInfo = categorySourceFiles.get(cat);
      if (sourceInfo) {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'icon-btn';
        downloadBtn.innerHTML = '<i class="codicon codicon-cloud-download"></i>';
        downloadBtn.title = `Exportieren (${sourceInfo.filename})`;
        downloadBtn.onclick = (e) => {
          e.stopPropagation();
          exportCategoryAttributes(cat);
        };
        actionsDiv.appendChild(downloadBtn);
      } else {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'icon-btn';
        downloadBtn.innerHTML = '<i class="codicon codicon-cloud-download"></i>';
        downloadBtn.title = 'Als TSV exportieren';
        downloadBtn.onclick = (e) => {
          e.stopPropagation();
          exportCategoryAsTSV(cat);
        };
        actionsDiv.appendChild(downloadBtn);
      }
      
      // Toggle All in Category (only if has attributes)
      if (attrs.length > 0) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'icon-btn';
        const allActive = attrs.every(a => activeAttributes.has(a.key));
        toggleBtn.innerHTML = `<i class="codicon ${allActive ? 'codicon-eye' : 'codicon-eye-closed'}"></i>`;
        toggleBtn.title = allActive ? 'Alle ausblenden' : 'Alle einblenden';
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            const newActive = new Set(activeAttributes);
            attrs.forEach(a => {
                if (allActive) newActive.delete(a.key);
                else newActive.add(a.key);
            });
            graphStore.setActiveAttributes(newActive);
        };
        actionsDiv.appendChild(toggleBtn);
      }
      
      header.appendChild(chevron);
      header.appendChild(label);
      header.appendChild(actionsDiv);
      catDiv.appendChild(header);
      
      // Items List
      const itemsList = document.createElement('div');
      itemsList.className = 'attribute-list';
      if (collapsedCategories.has(cat)) {
        itemsList.style.display = 'none';
      }
      
      attrs.sort((a,b) => a.name.localeCompare(b.name)).forEach(attr => {
        const itemRow = document.createElement('div');
        itemRow.className = 'attribute-item';
        
        const isActive = activeAttributes.has(attr.key);
        
        const colorBox = document.createElement('div');
        colorBox.className = 'attribute-color';
        colorBox.style.backgroundColor = attr.color;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'attribute-name';
        nameSpan.textContent = attr.name;
        
        const check = document.createElement('div');
        check.className = 'attribute-check';
        check.innerHTML = isActive ? '<i class="codicon codicon-check"></i>' : '';
        
        itemRow.onclick = () => {
            graphStore.toggleAttribute(attr.key);
        };
        
        if (!isActive) itemRow.style.opacity = '0.5';
        
        itemRow.appendChild(colorBox);
        itemRow.appendChild(nameSpan);
        itemRow.appendChild(check);
        itemsList.appendChild(itemRow);
      });
      
      catDiv.appendChild(itemsList);
      this.attributeLegendEl.appendChild(catDiv);
    }
  }

  // --- Hidden Legend ---

  buildHiddenLegend() {
    if (!this.hiddenLegendEl) return;
    this.hiddenLegendEl.innerHTML = '';
    
    const { hiddenByRoot, currentHiddenCount, allHiddenTemporarilyVisible, temporarilyVisibleRoots, byId, parentOf } = graphStore.state;
    
    const titleEl = document.getElementById('hiddenLegendTitle');
    let totalHidden = 0;
    for (const s of hiddenByRoot.values()) totalHidden += s.size;
    if (titleEl) {
        titleEl.textContent = totalHidden > 0 ? `Ausgeblendet (${currentHiddenCount}/${totalHidden})` : 'Ausgeblendet';
    }
    
    const globalBtn = document.getElementById('toggleAllHiddenVisibility');
    if (globalBtn) {
        globalBtn.style.display = hiddenByRoot.size > 0 ? '' : 'none';
        globalBtn.className = allHiddenTemporarilyVisible ? 'legend-icon-btn active' : 'legend-icon-btn';
        const icon = globalBtn.querySelector('.codicon');
        if (icon) {
            icon.className = `codicon ${allHiddenTemporarilyVisible ? 'codicon-eye' : 'codicon-eye-closed'}`;
        }
        globalBtn.onclick = () => {
            graphStore.setAllHiddenTemporarilyVisible(!allHiddenTemporarilyVisible);
            if (!allHiddenTemporarilyVisible) graphStore.setTemporarilyVisibleRoots(new Set());
        };
    }

    if (hiddenByRoot.size === 0) return;
    
    const ul = document.createElement('ul');
    ul.className = 'legend-list';
    
    for (const [rootId, hiddenSet] of hiddenByRoot.entries()) {
        const li = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'legend-row';
        
        const node = byId.get(rootId);
        const name = pseudonymizationService.getDisplayLabel(node, undefined, parentOf);
        
        const left = document.createElement('div');
        left.className = 'legend-row-left';
        left.innerHTML = `<div class="legend-tree-spacer"></div><span class="legend-label-chip" title="${name}">${name} (${hiddenSet.size})</span>`;
        
        const right = document.createElement('div');
        right.className = 'legend-row-right';
        
        // Unhide Button
        const unhideBtn = document.createElement('button');
        unhideBtn.className = 'legend-icon-btn';
        unhideBtn.innerHTML = '<i class="codicon codicon-close"></i>';
        unhideBtn.title = 'Wieder einblenden';
        unhideBtn.onclick = (e) => {
            e.stopPropagation();
            const ev = new CustomEvent('graph:unhide-subtree', { detail: { rootId } });
            window.dispatchEvent(ev);
        };
        
        // Temp Visibility Button
        const isVisible = allHiddenTemporarilyVisible || temporarilyVisibleRoots.has(rootId);
        const eyeBtn = document.createElement('button');
        eyeBtn.className = isVisible ? 'legend-icon-btn active' : 'legend-icon-btn';
        eyeBtn.innerHTML = `<i class="codicon ${isVisible ? 'codicon-eye' : 'codicon-eye-closed'}"></i>`;
        eyeBtn.onclick = (e) => {
            e.stopPropagation();
            const ev = new CustomEvent('graph:toggle-temp-visibility', { detail: { rootId } });
            window.dispatchEvent(ev);
        };
        
        right.appendChild(unhideBtn);
        right.appendChild(eyeBtn);
        
        row.appendChild(left);
        row.appendChild(right);
        li.appendChild(row);
        ul.appendChild(li);
    }
    this.hiddenLegendEl.appendChild(ul);
  }
}
