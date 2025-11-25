/**
 * Kontextmenü-System [SF][DRY]
 * Verwaltet Kontextmenüs für Knoten und Legenden.
 */

let legendMenuEl = null;
let nodeMenuEl = null;

/**
 * Erstellt ein Menü-Item [DRY]
 * @param {string} label - Text
 * @param {Function} handler - Click-Handler
 * @param {boolean} hasSubmenu - Hat Submenu-Pfeil
 * @param {boolean} disabled - Ist deaktiviert
 * @returns {HTMLElement}
 */
export function createMenuItem(label, handler, hasSubmenu = false, disabled = false) {
  const item = document.createElement('div');
  item.className = 'menu-item' + (disabled ? ' disabled' : '');
  
  const labelSpan = document.createElement('span');
  labelSpan.className = 'menu-item-label';
  labelSpan.textContent = label;
  item.appendChild(labelSpan);
  
  if (hasSubmenu) {
    const arrow = document.createElement('span');
    arrow.className = 'menu-item-arrow';
    arrow.textContent = '▶';
    item.appendChild(arrow);
  }
  
  if (!hasSubmenu && !disabled && handler) {
    item.onclick = handler;
  }
  
  return item;
}

/**
 * Erstellt ein Separator-Element [SF]
 * @returns {HTMLElement}
 */
export function createMenuSeparator() {
  const sep = document.createElement('div');
  sep.className = 'menu-separator';
  return sep;
}

/**
 * Stellt sicher, dass das Legenden-Menü existiert [SF]
 * @returns {HTMLElement}
 */
export function ensureLegendMenu() {
  if (legendMenuEl) return legendMenuEl;
  
  legendMenuEl = document.createElement('div');
  legendMenuEl.className = 'legend-context-menu';
  legendMenuEl.style.display = 'none';
  document.body.appendChild(legendMenuEl);
  
  // Klick außerhalb schließt Menü
  document.addEventListener('click', (e) => {
    if (legendMenuEl && !legendMenuEl.contains(e.target)) {
      hideLegendMenu();
    }
  });
  
  return legendMenuEl;
}

/**
 * Zeigt das Legenden-Menü [SF]
 * @param {number} x - X-Position
 * @param {number} y - Y-Position
 * @param {Array} items - Menü-Items
 */
export function showLegendMenu(x, y, items) {
  const menu = ensureLegendMenu();
  menu.innerHTML = '';
  
  items.forEach(item => {
    if (item.separator) {
      menu.appendChild(createMenuSeparator());
    } else {
      menu.appendChild(createMenuItem(item.label, item.handler, item.hasSubmenu, item.disabled));
    }
  });
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = 'block';
}

/**
 * Versteckt das Legenden-Menü [SF]
 */
export function hideLegendMenu() {
  if (legendMenuEl) {
    legendMenuEl.style.display = 'none';
  }
}

/**
 * Stellt sicher, dass das Node-Menü existiert [SF]
 * @returns {HTMLElement}
 */
export function ensureNodeMenu() {
  if (nodeMenuEl) return nodeMenuEl;
  
  nodeMenuEl = document.createElement('div');
  nodeMenuEl.className = 'node-context-menu';
  nodeMenuEl.style.display = 'none';
  document.body.appendChild(nodeMenuEl);
  
  // Klick außerhalb schließt Menü
  document.addEventListener('click', (e) => {
    if (nodeMenuEl && !nodeMenuEl.contains(e.target)) {
      hideNodeMenu();
    }
  });
  
  return nodeMenuEl;
}

/**
 * Zeigt das Node-Menü [SF]
 * @param {number} x - X-Position
 * @param {number} y - Y-Position
 * @param {Array} items - Menü-Items
 */
export function showNodeMenu(x, y, items) {
  const menu = ensureNodeMenu();
  menu.innerHTML = '';
  
  items.forEach(item => {
    if (item.separator) {
      menu.appendChild(createMenuSeparator());
    } else {
      const menuItem = createMenuItem(item.label, item.handler, item.hasSubmenu, item.disabled);
      
      // Submenu-Handling
      if (item.hasSubmenu && item.submenuItems) {
        const submenu = document.createElement('div');
        submenu.className = 'submenu';
        submenu.style.display = 'none';
        
        item.submenuItems.forEach(subItem => {
          submenu.appendChild(createMenuItem(subItem.label, subItem.handler, false, subItem.disabled));
        });
        
        menuItem.appendChild(submenu);
        
        menuItem.addEventListener('mouseenter', () => {
          submenu.style.display = 'block';
        });
        
        menuItem.addEventListener('mouseleave', () => {
          submenu.style.display = 'none';
        });
      }
      
      menu.appendChild(menuItem);
    }
  });
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = 'block';
}

/**
 * Versteckt das Node-Menü [SF]
 */
export function hideNodeMenu() {
  if (nodeMenuEl) {
    nodeMenuEl.style.display = 'none';
  }
}

/**
 * Versteckt alle Menüs [SF]
 */
export function hideAllMenus() {
  hideLegendMenu();
  hideNodeMenu();
}

export default {
  createMenuItem,
  createMenuSeparator,
  ensureLegendMenu,
  showLegendMenu,
  hideLegendMenu,
  ensureNodeMenu,
  showNodeMenu,
  hideNodeMenu,
  hideAllMenus
};
