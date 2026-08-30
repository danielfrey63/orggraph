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
    catLeftArea.appendChild(createLegendChip(legendChipText(cat, total), legendChipTitle(cat, total)));

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
      dimmed: isHidden,
      onClick: () => {
        const nowHidden = !hiddenCategories.has(cat);
        if (nowHidden) hiddenCategories.add(cat);
        else hiddenCategories.delete(cat);
        setLegendIconButtonState(eyeBtn, {
          dimmed: nowHidden,
          title: nowHidden ? 'Kategorie einblenden' : 'Kategorie ausblenden',
          icon: nowHidden ? 'eyeClosed' : 'eye',
        });

        // Attribut-Kreise neu zeichnen
        updateAttributeCircles();
        notifyAttributeVisibilityChanged();
      },
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

      // Attribut-Farbe als Custom-Property; die Transparenz mischt CSS per
      // color-mix (wie bei den OE-Rows), unabhängig vom Farbformat
      itemRow.style.setProperty('--attribute-color', it.color);

      // Tiefe-Spacer für Einrückung (16px wie bei OEs), dann Spacer statt Chevron
      itemLeftArea.appendChild(createLegendDepthSpacer(1));
      itemLeftArea.appendChild(createLegendTreeSpacer());

      // Farb-Indikator (nur Border, wie Attribut-Ringe im Graphen)
      const colorSpan = document.createElement('span');
      colorSpan.className = 'attribute-color-dot';
      colorSpan.style.borderColor = it.color;
      itemLeftArea.appendChild(colorSpan);

      // Item-Label mit Count
            itemLeftArea.appendChild(createLegendChip(legendChipText(it.name, it.count), legendChipTitle(`${cat} :: ${it.name}`, it.count)));
      
      // Ganze Zeile klickbar für Toggle
      itemRow.addEventListener('click', (e) => {
        const isActive = activeAttributes.has(it.key);
        
                if (isActive) activeAttributes.delete(it.key);
        else activeAttributes.add(it.key);
        setLegendRowActive(itemRow, !isActive);

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
