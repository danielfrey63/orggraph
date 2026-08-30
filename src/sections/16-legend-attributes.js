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
      setLegendSectionCollapsed(chevronBtn, content, shouldCollapse);
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
    
    // Haupt-Row für Kategorie (links Chevron + Label, rechts Action-Buttons)
    const { row: catRow, left: catLeftArea, right: catRightArea } = createLegendRow();

    // Chevron für Kategorie
    catLeftArea.appendChild(createLegendChevron({
      collapsed: collapsedCategories.has(cat),
      onToggle: (nowCollapsed) => {
        if (nowCollapsed) collapsedCategories.add(cat);
        else collapsedCategories.delete(cat);
      },
    }));

    // Kategorie-Label mit Anzahl
    const total = items.reduce((s,it)=> s + (it.count||0), 0);
    catLeftArea.appendChild(createLegendChip(`${cat} (${total})`, `${cat} - ${total} Einträge`));

    // Toggle all attributes of this category on/off (mirrors the section-wide checkAll)
    if (items.length > 0) {
      catRightArea.appendChild(createLegendIconButton({
        icon: 'checkAll',
        title: `Alle Attribute in "${cat}" an/abwählen`,
        onClick: () => {
          const anyActive = items.some(it => activeAttributes.has(it.key));
          for (const it of items) {
            if (anyActive) activeAttributes.delete(it.key);
            else activeAttributes.add(it.key);
          }
          buildAttributeLegend();
          updateAttributeCircles();
          notifyAttributeVisibilityChanged();
        },
      }));
    }

    // Eye-Toggle Button (rechts) - blendet Kategorie temporär aus
    const isHidden = hiddenCategories.has(cat);
    const eyeBtn = createLegendIconButton({
      icon: isHidden ? 'eyeClosed' : 'eye',
      title: isHidden ? 'Kategorie einblenden' : 'Kategorie ausblenden',
      className: isHidden ? 'hidden' : '',
    });

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
      notifyAttributeVisibilityChanged();
    });

    catRightArea.appendChild(eyeBtn);

    catLi.appendChild(catRow);
    
    // Unter-Liste für Attribute-Items
    const itemsUl = document.createElement('ul');
    itemsUl.style.display = collapsedCategories.has(cat) ? 'none' : '';
    
    for (const it of items) {
      const itemLi = document.createElement('li');
      
      // Item-Row (ganze Zeile klickbar, ohne rechten Action-Bereich)
      const { row: itemRow, left: itemLeftArea } = createLegendRow({
        active: activeAttributes.has(it.key),
        withRight: false,
      });
      itemRow.setAttribute('data-attribute-color', it.color);

      // Setze die Attribut-Farbe als CSS-Variable für den Hintergrund (transparent wie bei OEs)
      const transparentBg = colorToTransparent(it.color, 0.25);
      const transparentHoverBg = colorToTransparent(it.color, 0.35);
      itemRow.style.setProperty('--attribute-bg', transparentBg);
      itemRow.style.setProperty('--attribute-bg-hover', transparentHoverBg);

      // Tiefe-Spacer für Einrückung (16px wie bei OEs), dann Spacer statt Chevron
      itemLeftArea.appendChild(createLegendDepthSpacer(16));
      itemLeftArea.appendChild(createLegendTreeSpacer());

      // Farb-Indikator (nur Border, wie Attribut-Ringe im Graphen)
      const colorSpan = document.createElement('span');
      colorSpan.className = 'attribute-color-dot';
      colorSpan.style.borderColor = it.color;
      itemLeftArea.appendChild(colorSpan);

      // Item-Label mit Count
      itemLeftArea.appendChild(createLegendChip(`${it.name} (${it.count})`, `${cat} :: ${it.name} - ${it.count} Einträge`));
      
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
        notifyAttributeVisibilityChanged();
      });
      
      itemLi.appendChild(itemRow);
      itemsUl.appendChild(itemLi);
    }
    
    catLi.appendChild(itemsUl);
    ul.appendChild(catLi);
  }

  legend.appendChild(ul);
  updateAttributeStats();
}
