/**
 * Label-Utilities für Graph-Visualisierung [DRY][CA]
 * Konsolidiert alle Label-Aktualisierungs-Funktionen.
 */

import * as d3 from 'd3';
import { SVG_ID, INPUT_COMBO_ID } from '../constants.js';

/**
 * Aktualisiert alle Node-Labels im Graph
 * @param {Object} options - Optionen
 * @param {Function} options.getDisplayLabel - Funktion für Label-Anzeige
 * @param {Function} options.getDebugNodeLabel - Funktion für Debug-Label (optional)
 * @param {boolean} options.debugMode - Debug-Modus aktiv
 */
export function refreshNodeLabels({ getDisplayLabel, getDebugNodeLabel, debugMode }) {
  const svg = d3.select(SVG_ID);
  
  svg.selectAll('.node text.label').text(d => {
    if (debugMode && getDebugNodeLabel) {
      return getDebugNodeLabel(d);
    }
    return getDisplayLabel(d);
  });
}

/**
 * Aktualisiert die OE-Legend-Labels
 * @param {Object} options - Optionen
 * @param {Map} options.byId - Map von id -> Node
 * @param {Map} options.orgDepth - Funktion für OE-Tiefe
 * @param {Function} options.getDisplayLabel - Funktion für Label-Anzeige
 */
export function refreshOrgLegendLabels({ byId, orgDepth, getDisplayLabel }) {
  const legendChips = document.querySelectorAll('#legend .legend-label-chip');
  
  legendChips.forEach(chip => {
    const li = chip.closest('li');
    if (li?.dataset?.oid) {
      const node = byId.get(li.dataset.oid);
      if (node) {
        const depth = typeof orgDepth === 'function' ? orgDepth(li.dataset.oid) : 0;
        const label = getDisplayLabel(node, depth);
        chip.textContent = label;
        chip.title = label;
      }
    }
  });
}

/**
 * Aktualisiert die Hidden-Legend-Labels
 * @param {Object} options - Optionen
 * @param {Map} options.byId - Map von id -> Node
 * @param {Map} options.hiddenByRoot - Map von rootId -> Set(nodeIds)
 * @param {Function} options.getDisplayLabel - Funktion für Label-Anzeige
 */
export function refreshHiddenLegendLabels({ byId, hiddenByRoot, getDisplayLabel }) {
  const hiddenChips = document.querySelectorAll('#hiddenLegend .legend-label-chip');
  
  hiddenChips.forEach(chip => {
    const rootId = chip.dataset.rootId;
    if (rootId) {
      const node = byId.get(rootId);
      const setIds = hiddenByRoot.get(rootId);
      const count = setIds ? setIds.size : 0;
      const label = getDisplayLabel(node);
      chip.textContent = `${label} (${count})`;
      chip.title = label;
    }
  });
}

/**
 * Aktualisiert das Such-Input-Feld
 * @param {Object} options - Optionen
 * @param {Map} options.byId - Map von id -> Node
 * @param {string|number} options.currentSelectedId - Aktuell ausgewählte ID
 * @param {Function} options.getDisplayLabel - Funktion für Label-Anzeige
 */
export function refreshSearchInput({ byId, currentSelectedId, getDisplayLabel }) {
  const input = document.querySelector(INPUT_COMBO_ID);
  
  if (input && currentSelectedId) {
    const node = byId.get(String(currentSelectedId));
    if (node) {
      input.value = getDisplayLabel(node);
    }
  }
}

/**
 * Aktualisiert alle Labels im Graph (Hauptfunktion) [DRY]
 * @param {Object} options - Optionen
 * @param {boolean} options.includeLegend - Auch Legende aktualisieren
 * @param {Map} options.byId - Map von id -> Node
 * @param {Map} options.hiddenByRoot - Map von rootId -> Set(nodeIds)
 * @param {string|number} options.currentSelectedId - Aktuell ausgewählte ID
 * @param {Function} options.orgDepth - Funktion für OE-Tiefe
 * @param {Function} options.getDisplayLabel - Funktion für Label-Anzeige
 * @param {Function} options.getDebugNodeLabel - Funktion für Debug-Label (optional)
 * @param {boolean} options.debugMode - Debug-Modus aktiv
 */
export function refreshAllLabels({
  includeLegend = true,
  byId,
  hiddenByRoot,
  currentSelectedId,
  orgDepth,
  getDisplayLabel,
  getDebugNodeLabel,
  debugMode
}) {
  refreshNodeLabels({ getDisplayLabel, getDebugNodeLabel, debugMode });
  
  if (includeLegend) {
    refreshOrgLegendLabels({ byId, orgDepth, getDisplayLabel });
    refreshHiddenLegendLabels({ byId, hiddenByRoot, getDisplayLabel });
    refreshSearchInput({ byId, currentSelectedId, getDisplayLabel });
  }
}

export default {
  refreshAllLabels,
  refreshNodeLabels,
  refreshOrgLegendLabels,
  refreshHiddenLegendLabels,
  refreshSearchInput
};
