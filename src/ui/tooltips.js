/**
 * Tooltip-System [SF][DRY]
 * Verwaltet die Anzeige von Tooltips für Knoten und Cluster.
 */

let tooltipEl = null;

/**
 * Stellt sicher, dass das Tooltip-Element existiert [SF]
 */
export function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  
  tooltipEl = document.createElement('div');
  tooltipEl.style.position = 'fixed';
  tooltipEl.style.pointerEvents = 'none';
  tooltipEl.style.background = 'rgba(17,17,17,0.9)';
  tooltipEl.style.color = '#fff';
  tooltipEl.style.fontSize = '12px';
  tooltipEl.style.padding = '10px 12px';
  tooltipEl.style.borderRadius = '6px';
  tooltipEl.style.zIndex = '1000';
  tooltipEl.style.whiteSpace = 'pre';
  tooltipEl.style.display = 'none';
  tooltipEl.style.maxWidth = '400px';
  tooltipEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  tooltipEl.style.lineHeight = '1.4';
  document.body.appendChild(tooltipEl);
  
  return tooltipEl;
}

/**
 * Zeigt einen Tooltip an [SF]
 * @param {number} x - X-Position
 * @param {number} y - Y-Position
 * @param {Array|string} content - Inhalt (Array von Zeilen oder String)
 */
export function showTooltip(x, y, content) {
  ensureTooltip();
  
  if (Array.isArray(content)) {
    tooltipEl.textContent = content.join('\n');
  } else {
    tooltipEl.textContent = content;
  }
  
  tooltipEl.style.left = `${x + 12}px`;
  tooltipEl.style.top = `${y + 12}px`;
  tooltipEl.style.display = 'block';
}

/**
 * Versteckt den Tooltip [SF]
 */
export function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.style.display = 'none';
  }
}

/**
 * Baut Tooltip-Zeilen für eine Person [SF]
 * @param {Object} node - Knoten-Objekt
 * @param {Object} options - Optionen
 * @returns {Array} Array von Zeilen
 */
export function buildPersonTooltipLines(node, { 
  getDisplayLabel, 
  personAttributes, 
  activeAttributes,
  attributeTypes: _attributeTypes,
  debugMode = false 
}) {
  const lines = [];
  const label = getDisplayLabel(node);
  
  lines.push(`👤 ${label}`);
  
  if (node.email) {
    lines.push(`📧 ${node.email}`);
  }
  
  if (node.id) {
    lines.push(`🆔 ${node.id}`);
  }
  
  // Attribute anzeigen
  const personId = String(node.id);
  const attrs = personAttributes?.get(personId);
  
  if (attrs && attrs.size > 0) {
    const activeAttrs = [];
    for (const [attrName, attrValue] of attrs.entries()) {
      if (activeAttributes?.has(attrName)) {
        const displayName = attrName.includes('::') ? attrName.split('::')[1] : attrName;
        activeAttrs.push(`  • ${displayName}${attrValue !== '1' ? `: ${attrValue}` : ''}`);
      }
    }
    
    if (activeAttrs.length > 0) {
      lines.push('');
      lines.push('📊 Attribute:');
      lines.push(...activeAttrs);
    }
  }
  
  if (debugMode) {
    lines.push('');
    lines.push(`📍 Position: (${Math.round(node.x || 0)}, ${Math.round(node.y || 0)})`);
  }
  
  return lines;
}

/**
 * Baut Tooltip-Zeilen für einen Cluster [SF]
 * @param {Array} clusterLabels - Array von Cluster-Labels
 * @returns {Array} Array von Zeilen
 */
export function buildClusterTooltipLines(clusterLabels) {
  if (!clusterLabels || clusterLabels.length === 0) {
    return [];
  }
  
  const lines = ['🏢 Organisationseinheiten:'];
  clusterLabels.forEach(label => {
    lines.push(`  • ${label}`);
  });
  
  return lines;
}

export default {
  ensureTooltip,
  showTooltip,
  hideTooltip,
  buildPersonTooltipLines,
  buildClusterTooltipLines
};
