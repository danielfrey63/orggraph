export function getCheckboxSVG(checked = false) {
  return checked ? ICON.check : ICON.close;
}

export function getChevronSVG() {
  return ICON.chevronDown;
}

export function getCheckAllSVG() {
  return ICON.checkAll;
}

export function getEyeSVG(closed = false) {
  return closed ? ICON.eyeClosed : ICON.eye;
}

export function getSaveSVG() {
  return ICON.save;
}

export function getDownloadSVG() {
  return ICON.cloudDownload;
}

export function updateCheckboxIcon(checkboxElement, checked) {
  checkboxElement.innerHTML = getCheckboxSVG(checked);
  checkboxElement.className = checked ? 
    checkboxElement.className.replace(/\s*checked/, '') + ' checked' : 
    checkboxElement.className.replace(/\s*checked/, '');
}

export function initializeChevronIcons() {
  // Aktualisiere alle Chevron-Buttons im HTML mit dem zentralen SVG
  document.querySelectorAll('.legend-chevron').forEach(chevronBtn => {
    chevronBtn.innerHTML = getChevronSVG();
  });
}

/**
 * Initialisiert die Collapsed-Zustände der Legend-Sektionen aus ENV [SF]
 */
export function initializeLegendCollapsedStates() {
  const sections = [
    { key: 'LEGEND_OES_COLLAPSED', target: 'legend' },
    { key: 'LEGEND_ATTRIBUTES_COLLAPSED', target: 'attributeContainer' },
    { key: 'LEGEND_HIDDEN_COLLAPSED', target: 'hiddenLegend' }
  ];
  
  for (const { key, target } of sections) {
    const shouldCollapse = envConfig?.[key];
    if (typeof shouldCollapse !== 'boolean') continue;
    
    const chevronBtn = document.querySelector(`.legend-chevron[data-target="${target}"]`);
    const content = document.getElementById(target);
    
    if (chevronBtn && content) {
      if (shouldCollapse) {
        chevronBtn.classList.remove('expanded');
        chevronBtn.classList.add('collapsed');
        content.classList.add('collapsed');
      } else {
        chevronBtn.classList.remove('collapsed');
        chevronBtn.classList.add('expanded');
        content.classList.remove('collapsed');
      }
    }
  }
}

/**
 * Erstellt die Attribut-Legende mit einheitlichem legend-row Layout (wie OEs)
 */
export function buildAttributeLegend() {
  const legend = document.getElementById('attributeLegend');
  if (!legend) return;

  legend.innerHTML = '';
  if (attributeTypes.size === 0 && emptyCategories.size === 0) {
    updateAttributeStats();
    return;
  }

  // Zähle Vorkommen je Attributtyp
  const typeCount = new Map();
  for (const attrs of personAttributes.values()) {
    for (const type of attrs.keys()) {
      typeCount.set(type, (typeCount.get(type) || 0) + 1);
    }
  }

  // Kategorien sammeln
  const categories = new Map(); // cat -> [{key,name,color,count}]
  for (const key of attributeTypes.keys()) {
    const [cat, name] = String(key).includes('::') ? String(key).split('::') : ['Attribute', String(key)];
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat).push({
      key,
      name,
      color: attributeTypes.get(key),
      count: typeCount.get(key) || 0
    });
  }
  
  // Leere Kategorien hinzufügen (ohne Attribute)
  for (const cat of emptyCategories) {
    if (!categories.has(cat)) {
      categories.set(cat, []);
    }
  }

  // Liste erstellen mit legend-list (wie OEs)
  const ul = document.createElement('ul');
  ul.className = 'legend-list';

  const sortedCats = Array.from(categories.keys()).sort();
  for (const cat of sortedCats) {
    const items = categories.get(cat).sort((a,b)=> a.name.localeCompare(b.name));
    
    // Kategorie-Listenelement
    const catLi = document.createElement('li');
    
    // Haupt-Row für Kategorie
    const catRow = document.createElement('div');
    catRow.className = 'legend-row';
    
    // Linker Bereich: Chevron + Label
    const catLeftArea = document.createElement('div');
    catLeftArea.className = 'legend-row-left';
    
    // Rechter Bereich: Action-Buttons
    const catRightArea = document.createElement('div');
    catRightArea.className = 'legend-row-right';
    
    // Chevron für Kategorie
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = collapsedCategories.has(cat) ? 'legend-tree-chevron collapsed' : 'legend-tree-chevron expanded';
    chevron.title = 'Ein-/Ausklappen';
    chevron.innerHTML = getChevronSVG();
    
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      const sub = catLi.querySelector('ul');
      const isCollapsed = sub && sub.style.display === 'none';
      
      if (sub) {
        sub.style.display = isCollapsed ? '' : 'none';
        chevron.className = isCollapsed ? 'legend-tree-chevron expanded' : 'legend-tree-chevron collapsed';
        
        if (isCollapsed) {
          collapsedCategories.delete(cat);
        } else {
          collapsedCategories.add(cat);
        }
      }
    });
    
    catLeftArea.appendChild(chevron);
    
    // Kategorie-Label mit Anzahl
    const catLabel = document.createElement('span');
    catLabel.className = 'legend-label-chip';
    const total = items.reduce((s,it)=> s + (it.count||0), 0);
    catLabel.textContent = `${cat} (${total})`;
    catLabel.title = `${cat} - ${total} Einträge`;
    catLeftArea.appendChild(catLabel);
    
    // Download-Button für Kategorie (TSV-Export) - vor Eye-Button
    const catDownloadBtn = document.createElement('button');
    catDownloadBtn.type = 'button';
    catDownloadBtn.className = 'legend-icon-btn';
    catDownloadBtn.title = `"${cat}" als TSV herunterladen`;
    catDownloadBtn.innerHTML = getDownloadSVG();
    catDownloadBtn.setAttribute('data-ignore-header-click', 'true');
    
    catDownloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportCategoryAsTSV(cat);
    });
    
    catRightArea.appendChild(catDownloadBtn);
    
    // Eye-Toggle Button (rechts) - blendet Kategorie temporär aus
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    const isHidden = hiddenCategories.has(cat);
    eyeBtn.className = isHidden ? 'legend-icon-btn hidden' : 'legend-icon-btn';
    eyeBtn.title = isHidden ? 'Kategorie einblenden' : 'Kategorie ausblenden';
    setIcon(eyeBtn, isHidden ? 'eyeClosed' : 'eye');
    eyeBtn.setAttribute('data-ignore-header-click', 'true');

    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCurrentlyHidden = hiddenCategories.has(cat);

      if (isCurrentlyHidden) {
        // Einblenden
        hiddenCategories.delete(cat);
        eyeBtn.className = 'legend-icon-btn';
        eyeBtn.title = 'Kategorie ausblenden';
        setIcon(eyeBtn, 'eye');
      } else {
        // Ausblenden
        hiddenCategories.add(cat);
        eyeBtn.className = 'legend-icon-btn hidden';
        eyeBtn.title = 'Kategorie einblenden';
        setIcon(eyeBtn, 'eyeClosed');
      }

      // Attribut-Kreise neu zeichnen
      updateAttributeCircles();
    });
    
    catRightArea.appendChild(eyeBtn);
    
    // Save-Button (nur sichtbar wenn Kategorie geändert wurde)
    const isModified = modifiedCategories.has(cat);
    const hasSource = categorySourceFiles.has(cat);
    
    // Debug: Log wenn eine Kategorie geändert wurde aber keinen Source hat
    if (isModified && !hasSource && debugMode) {
      console.log(`Kategorie "${cat}" ist geändert, hat aber keine Quelldatei. Verfügbare Quellen:`, Array.from(categorySourceFiles.keys()));
    }
    
    if (isModified && hasSource) {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'legend-icon-btn save-btn';
      saveBtn.title = `Änderungen in "${cat}" speichern`;
      saveBtn.innerHTML = getSaveSVG();
      saveBtn.setAttribute('data-ignore-header-click', 'true');
      
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportCategoryAttributes(cat);
      });
      
      catRightArea.appendChild(saveBtn);
    }
    
    // Bereiche zu Kategorie-Row hinzufügen
    catRow.appendChild(catLeftArea);
    catRow.appendChild(catRightArea);
    catLi.appendChild(catRow);
    
    // Unter-Liste für Attribute-Items
    const itemsUl = document.createElement('ul');
    itemsUl.style.display = collapsedCategories.has(cat) ? 'none' : '';
    
    for (const it of items) {
      const itemLi = document.createElement('li');
      
      // Item-Row (ganze Zeile klickbar)
      const itemRow = document.createElement('div');
      const isItemActive = activeAttributes.has(it.key);
      itemRow.className = isItemActive ? 'legend-row active' : 'legend-row';
      itemRow.setAttribute('data-attribute-color', it.color);
      
      // Setze die Attribut-Farbe als CSS-Variable für den Hintergrund (transparent wie bei OEs)
      const transparentBg = colorToTransparent(it.color, 0.25);
      const transparentHoverBg = colorToTransparent(it.color, 0.35);
      itemRow.style.setProperty('--attribute-bg', transparentBg);
      itemRow.style.setProperty('--attribute-bg-hover', transparentHoverBg);
      
      // Linker Bereich: Spacer + Farbe + Label
      const itemLeftArea = document.createElement('div');
      itemLeftArea.className = 'legend-row-left';
      
      // Tiefe-Spacer für Einrückung (16px wie bei OEs)
      const depthSpacer = document.createElement('div');
      depthSpacer.className = 'legend-depth-spacer';
      depthSpacer.style.width = '16px';
      itemLeftArea.appendChild(depthSpacer);
      
      // Spacer statt Chevron
      const spacer = document.createElement('div');
      spacer.className = 'legend-tree-spacer';
      itemLeftArea.appendChild(spacer);
      
      // Farb-Indikator (nur Border, wie Attribut-Ringe im Graphen)
      const colorSpan = document.createElement('span');
      colorSpan.className = 'attribute-color-dot';
      const circleDiameter = 12;
      colorSpan.style.display = 'inline-block';
      colorSpan.style.width = `${circleDiameter}px`;
      colorSpan.style.height = `${circleDiameter}px`;
      colorSpan.style.borderRadius = '50%';
      colorSpan.style.backgroundColor = 'transparent';
      // Border = 50% des Radius = 1/4 des Durchmessers
      const borderWidth = circleDiameter / 4;
      colorSpan.style.border = `${borderWidth}px solid ${it.color}`;
      colorSpan.style.marginRight = '8px';
      colorSpan.style.flexShrink = '0';
      itemLeftArea.appendChild(colorSpan);
      
      // Item-Label mit Count
      const itemLabel = document.createElement('span');
      itemLabel.className = 'legend-label-chip';
      itemLabel.textContent = `${it.name} (${it.count})`;
      itemLabel.title = `${cat} :: ${it.name} - ${it.count} Einträge`;
      itemLeftArea.appendChild(itemLabel);
      
      // Ganze Zeile klickbar für Toggle
      itemRow.addEventListener('click', (e) => {
        const isActive = activeAttributes.has(it.key);
        
        if (isActive) {
          activeAttributes.delete(it.key);
          itemRow.classList.remove('active');
        } else {
          activeAttributes.add(it.key);
          itemRow.classList.add('active');
        }
        
        updateAttributeStats();
        updateAttributeCircles();
      });
      
      // Bereiche zu Item-Row hinzufügen
      itemRow.appendChild(itemLeftArea);
      itemLi.appendChild(itemRow);
      itemsUl.appendChild(itemLi);
    }
    
    catLi.appendChild(itemsUl);
    ul.appendChild(catLi);
  }

  legend.appendChild(ul);
  updateAttributeStats();
}

/**
 * Zeigt einen Dialog mit Fuzzy-Match-Vorschlägen
 */
