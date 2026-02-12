/**
 * Legend Row Component [DRY][CA]
 * Einheitliche Komponente für Legendeneinträge (OEs und Attribute)
 */

import { getChevronSVG } from './icons.js';

/**
 * Erstellt eine standardisierte Legend-Row
 * @param {Object} config - Konfiguration
 * @param {string} config.label - Anzeigetext
 * @param {string} [config.color] - Farbe für Chip/Hintergrund
 * @param {number} [config.depth=0] - Tiefe für Einrückung
 * @param {boolean} [config.isActive=false] - Ob der Eintrag aktiv ist
 * @param {boolean} [config.hasChevron=false] - Ob ein Chevron angezeigt wird
 * @param {boolean} [config.chevronExpanded=false] - Ob Chevron expandiert ist
 * @param {Function} [config.onToggle] - Callback für Toggle (Chevron-Klick)
 * @param {Function} [config.onClick] - Callback für Zeilen-Klick
 * @param {Array} [config.actions=[]] - Action-Buttons [{type, title, icon, onClick, className}]
 * @param {string} [config.chipClass='legend-label-chip'] - Klasse für Label-Chip
 * @param {Object} [config.dataset={}] - Data-Attribute für die Row
 * @param {boolean} [config.showColorIndicator=false] - Ob ein separater Farb-Indikator angezeigt wird
 * @returns {HTMLDivElement} Legend-Row Element
 */
export function createLegendRow(config) {
  const {
    label,
    color,
    depth = 0,
    isActive = false,
    hasChevron = false,
    chevronExpanded = false,
    onToggle,
    onClick,
    actions = [],
    chipClass = 'legend-label-chip',
    dataset = {},
    showColorIndicator = false
  } = config;

  const row = document.createElement('div');
  row.className = `legend-row${isActive ? ' active' : ''}`;
  
  // Data-Attribute setzen
  Object.entries(dataset).forEach(([key, value]) => {
    row.dataset[key] = value;
  });

  // Linker Bereich: Depth-Spacer + Chevron/Spacer + Label
  const leftArea = document.createElement('div');
  leftArea.className = 'legend-row-left';

  // Depth-Spacer für Einrückung
  const depthSpacer = document.createElement('div');
  depthSpacer.className = 'legend-depth-spacer';
  depthSpacer.style.width = `${Math.max(0, depth) * 16}px`;
  leftArea.appendChild(depthSpacer);

  // Chevron oder Spacer
  if (hasChevron) {
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = chevronExpanded ? 'legend-tree-chevron expanded' : 'legend-tree-chevron collapsed';
    chevron.title = 'Ein-/Ausklappen';
    chevron.innerHTML = getChevronSVG();
    
    if (onToggle) {
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        onToggle(chevron);
      });
    }
    
    leftArea.appendChild(chevron);
  } else {
    const spacer = document.createElement('div');
    spacer.className = 'legend-tree-spacer';
    leftArea.appendChild(spacer);
  }

  // Label-Chip
  const chip = document.createElement('span');
  chip.className = chipClass;
  chip.textContent = label;
  chip.title = label;
  
  // Farbe als CSS-Variable setzen (für Hintergrund)
  if (color) {
    chip.style.setProperty('--item-color', color);
  }
  
  // Farb-Indikator vor dem Label (für Attribute)
  if (showColorIndicator && color) {
    const colorIndicator = createColorIndicator(color);
    leftArea.appendChild(colorIndicator);
  }
  
  leftArea.appendChild(chip);

  // Rechter Bereich: Action-Buttons
  const rightArea = document.createElement('div');
  rightArea.className = 'legend-row-right';

  // Action-Buttons hinzufügen
  actions.forEach(action => {
    const btn = createActionbutton(action);
    rightArea.appendChild(btn);
  });

  // Bereiche zur Row hinzufügen
  row.appendChild(leftArea);
  row.appendChild(rightArea);

  // Click-Handler für die gesamte Row
  if (onClick) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      // Nicht feuern wenn auf Button geklickt wurde
      if (e.target.closest('button')) return;
      onClick(e);
    });
  }

  return row;
}

/**
 * Erstellt einen Action-Button für Legend-Rows
 * @param {Object} action - Action-Konfiguration
 * @param {string} action.type - Typ (icon, custom)
 * @param {string} action.title - Tooltip
 * @param {string} [action.icon] - HTML für Icon (bei type='icon')
 * @param {Function} [action.onClick] - Click-Handler
 * @param {string} [action.className] - Zusätzliche Klassen
 * @param {boolean} [action.active] - Ob Button aktiv ist
 * @returns {HTMLButtonElement}
 */
function createActionbutton(action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  
  const className = action.className || 'legend-icon-btn';
  btn.className = action.active ? `${className} active` : className;
  
  btn.title = action.title || '';
  btn.setAttribute('data-ignore-header-click', 'true');
  
  if (action.icon) {
    btn.innerHTML = action.icon;
  }
  
  if (action.onClick) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      action.onClick(e, btn);
    });
  }
  
  return btn;
}

/**
 * Erstellt einen Depth-Spacer
 * @param {number} depth - Tiefe (0-basiert)
 * @param {number} [widthPerLevel=16] - Breite pro Level in px
 * @returns {HTMLDivElement}
 */
export function createDepthSpacer(depth, widthPerLevel = 16) {
  const spacer = document.createElement('div');
  spacer.className = 'legend-depth-spacer';
  spacer.style.width = `${Math.max(0, depth) * widthPerLevel}px`;
  return spacer;
}

/**
 * Erstellt ein Label-Chip
 * @param {string} text - Anzeigetext
 * @param {string} [title] - Tooltip (falls abweichend)
 * @param {string} [className='legend-label-chip'] - CSS-Klasse
 * @returns {HTMLSpanElement}
 */
export function createLabelChip(text, title, className = 'legend-label-chip') {
  const chip = document.createElement('span');
  chip.className = className;
  chip.textContent = text;
  chip.title = title || text;
  return chip;
}

/**
 * Erstellt einen Chevron-Button
 * @param {boolean} expanded - Ob initial expandiert
 * @param {Function} onToggle - Toggle-Callback
 * @returns {HTMLButtonElement}
 */
export function createChevronButton(expanded, onToggle) {
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = expanded ? 'legend-tree-chevron expanded' : 'legend-tree-chevron collapsed';
  chevron.title = 'Ein-/Ausklappen';
  chevron.innerHTML = getChevronSVG();
  
  if (onToggle) {
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggle(chevron);
    });
  }
  
  return chevron;
}

/**
 * Erstellt einen Farb-Indikator für Attribute (Kreis mit farbigem Rand)
 * @param {string} color - Farbe für den Rand
 * @param {Object} [options] - Optionen
 * @param {number} [options.size=12] - Durchmesser in px
 * @param {number} [options.borderWidthRatio=0.25] - Verhältnis Border/Radius
 * @returns {HTMLSpanElement}
 */
export function createColorIndicator(color, options = {}) {
  const { size = 12, borderWidthRatio = 0.25 } = options;
  const borderWidth = size * borderWidthRatio;
  
  const indicator = document.createElement('span');
  indicator.className = 'attribute-color-dot';
  indicator.style.display = 'inline-block';
  indicator.style.width = `${size}px`;
  indicator.style.height = `${size}px`;
  indicator.style.borderRadius = '50%';
  indicator.style.backgroundColor = 'transparent';
  indicator.style.border = `${borderWidth}px solid ${color}`;
  indicator.style.marginRight = '8px';
  indicator.style.flexShrink = '0';
  
  return indicator;
}

/**
 * Toggle den Zustand eines Chevrons
 * @param {HTMLButtonElement} chevron - Chevron-Button
 * @returns {boolean} Neuer expandierter Zustand
 */
export function toggleChevron(chevron) {
  const isCurrentlyExpanded = chevron.classList.contains('expanded');
  
  if (isCurrentlyExpanded) {
    chevron.classList.remove('expanded');
    chevron.classList.add('collapsed');
  } else {
    chevron.classList.remove('collapsed');
    chevron.classList.add('expanded');
  }
  
  return !isCurrentlyExpanded;
}

export default {
  createLegendRow,
  createDepthSpacer,
  createLabelChip,
  createChevronButton,
  createColorIndicator,
  toggleChevron
};
