export function cssNumber(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Farb-Hilfen: gleiche Kategorie -> ähnliche Farben, Kategorien klar unterscheidbar
export const categoryHueCache = new Map();
export function quantizedHueFromCategory(category) {
  if (categoryHueCache.has(category)) return categoryHueCache.get(category);
  const rawHue = Math.abs(hashCode(String(category))) % 360;
  const step = 40; // große Abstände zwischen Kategorien
  const hue = (Math.round(rawHue / step) * step) % 360;
  categoryHueCache.set(category, hue);
  return hue;
}
export function colorForCategoryAttribute(category, attrName, ordinal) {
  const baseHue = quantizedHueFromCategory(category);
  const localShift = (ordinal % 6) * 10; // kleine Variation innerhalb der Kategorie
  const hue = (baseHue + localShift) % 360;
  const sat = 65;
  const light = 50 + ((ordinal % 2) ? 5 : 0); // leichte Helligkeitsvariation
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * Berechnet die Füllfarbe für einen Node basierend auf seiner hierarchischen Ebene
 * @param {Object} node - Der Node-Datensatz
 * @returns {string} CSS-Farbwert für die Füllung
 */
export function getNodeFillByLevel(node) {
  if (!node || node.type !== 'person') {
    return getComputedStyle(document.documentElement).getPropertyValue('--node-fill') || '#4F46E5';
  }
  
  const level = node.level || 0;
  const maxLevel = Math.max(...Array.from(hierarchyLevels.values()).filter(l => l >= 0));
  
  // Wenn keine Hierarchie-Informationen verfügbar, Standardfarbe verwenden
  if (maxLevel === 0 || hierarchyLevels.size === 0) {
    return getComputedStyle(document.documentElement).getPropertyValue('--node-fill') || '#4F46E5';
  }
  
  // Normalisierte Ebene (0 = top, 1 = bottom)
  const normalizedLevel = maxLevel > 0 ? level / maxLevel : 0;
  
  // Hole die Gradient-Farben aus CSS-Variablen
  const topLevelColor = getComputedStyle(document.documentElement).getPropertyValue('--node-fill-top-level') || '#e0e7ff';
  const midLevelColor = getComputedStyle(document.documentElement).getPropertyValue('--node-fill-mid-level') || '#818cf8';
  const lowLevelColor = getComputedStyle(document.documentElement).getPropertyValue('--node-fill-low-level') || '#4F46E5';
  
  // Whle Farbe basierend auf normalisierter Ebene
  if (normalizedLevel <= 0.33) {
    return topLevelColor.trim();
  } else if (normalizedLevel <= 0.67) {
    return midLevelColor.trim();
  } else {
    return lowLevelColor.trim();
  }
}

export function clustersAtPoint(p) {
  // Sammle OEs mit ihren IDs und Labels
  const orgItems = [];
  for (const [oid, poly] of clusterPolygons.entries()) {
    if (!allowedOrgs.has(oid)) continue;
    if (poly && poly.length>=3 && d3.polygonContains(poly, p)) {
      const node = byId.get(oid);
      const depth = orgDepth(oid);
      const label = getDisplayLabel(node, depth);
      orgItems.push({ id: oid, label, depth });
    }
  }
  
  // Sortiere nach Tiefe absteigend (höhere Tiefe = kleinere OE kommt zuerst)
  orgItems.sort((a, b) => b.depth - a.depth || a.label.localeCompare(b.label));
  
  // Gib nur die Labels zurück
  return orgItems.map(item => item.label);
}

export function computeClusterPolygon(nodes, pad) {
  const pts = nodes.map(n => [n.x, n.y]);
  const r = cssNumber('--node-radius', 8) + pad;
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const [x,y] = pts[0];
    const poly = [];
    for (let i=0;i<12;i++){ const a=(i/12)*Math.PI*2; poly.push([x+Math.cos(a)*r, y+Math.sin(a)*r]); }
    return poly;
  }
  if (pts.length === 2) {
    const [a,b] = pts;
    const dx=b[0]-a[0], dy=b[1]-a[1];
    const len=Math.hypot(dx,dy)||1;
    const ux=dx/len, uy=dy/len; const nx=-uy, ny=ux;
    return [
      [a[0]+nx*r, a[1]+ny*r],
      [b[0]+nx*r, b[1]+ny*r],
      [b[0]-nx*r, b[1]-ny*r],
      [a[0]-nx*r, a[1]-ny*r]
    ];
  }
  const hull = d3.polygonHull(pts);
  if (!hull || hull.length<3) return [];
  const cx=d3.mean(hull,p=>p[0]);
  const cy=d3.mean(hull,p=>p[1]);
  return hull.map(([x,y])=>{
    const vx=x-cx, vy=y-cy; const L=Math.hypot(vx,vy)||1; const s=(L+pad)/L; return [cx+vx*s, cy+vy*s];
  });
}

// Collect active ancestor chain (including self) for a given org id
export function getActiveAncestorChain(oid) {
  const active = new Set();
  let cur = String(oid);
  while (cur) {
    if (allowedOrgs.has(cur)) active.add(cur);
    const p = parentOf.get(cur);
    if (!p) break;
    cur = p;
  }
  return active;
}

// Tooltip helpers for overlapping clusters
let tooltipEl = null;
/* v8 ignore start */
export function ensureTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'cluster-tooltip';
  document.body.appendChild(tooltipEl);
}
/* v8 ignore stop */
/* v8 ignore start */
export function showTooltip(x, y, lines) {
  tooltipEl.textContent = lines.join('\n');
  tooltipEl.style.left = `${x+12}px`;
  tooltipEl.style.top = `${y+12}px`;
  tooltipEl.style.display = 'block';
}
/* v8 ignore stop */
/* v8 ignore start */
export function hideTooltip() { if (tooltipEl) tooltipEl.style.display = 'none'; }
/* v8 ignore stop */

/**
 * Zeigt Zoom-Level im Debug-Modus in der Statusleiste an [SF]
 */
export function updateDebugZoomDisplay() {
  const statusEl = document.querySelector(STATUS_ID);
  if (!statusEl) return;
  
  if (!debugMode) {
    // Debug deaktiviert: Status zurücksetzen
    statusEl.textContent = 'Bereit';
    return;
  }
  
  if (!currentZoomTransform) return;
  const k = currentZoomTransform.k.toFixed(2);
  const x = Math.round(currentZoomTransform.x);
  const y = Math.round(currentZoomTransform.y);
  statusEl.textContent = `Zoom: ${k} | Offset: (${x}, ${y})`;
}

/**
 * Erstellt Tooltip-Zeilen für eine Person mit Attributen und OE-Zugehörigkeiten
 * @param {string} personId - ID der Person
 * @param {string} nodeLabel - Label des Knotens
 * @param {Array} visibleOrgs - Array von sichtbaren OE-Labels am Cursor
 * @returns {Array} Array von Tooltip-Zeilen
 */
export function buildPersonTooltipLines(personId, nodeLabel, visibleOrgs = []) {
  const lines = [];
  
  // Section header for node
  lines.push(`👤 ${nodeLabel}`);
  
  // Zeige Attribute für diese Person an
  if (personId && personAttributes.has(personId)) {
    const attrs = personAttributes.get(personId);
    lines.push('📊 Attribute:');
    let hasAttributes = false;
    for (const [attrName, attrValue] of attrs.entries()) {
      if (activeAttributes.has(attrName)) {
        const displayValue = attrValue !== '1' ? `: ${attrValue}` : '';
        lines.push(`  • ${attrName}${displayValue}`);
        hasAttributes = true;
      }
    }
    if (!hasAttributes) {
      lines.push('  • Keine aktiven Attribute');
    }
  }
  
  // Get all OEs this person belongs to (not just visible ones)
  const allPersonOrgs = findAllPersonOrgs(personId);
  
  // Add visible org memberships (at mouse point) with a header
  if (visibleOrgs.length > 0) {
    lines.push('🔍 OEs am Cursor:');
    visibleOrgs.forEach(org => lines.push(`  • ${org}`));
  }
  
  // Add all org memberships with header
  if (allPersonOrgs.length > 0) {
    lines.push('🏢 Alle OE-Zugehörigkeiten:');
    allPersonOrgs.forEach(org => lines.push(`  • ${org}`));
  }
  
  return lines;
}

/**
 * Tooltips für Cluster-Hover
 */
export function handleClusterHover(event, svgSel) {
  if (!currentZoomTransform) { 
    hideTooltip(); 
    return; 
  }
  
  const [mx, my] = d3.pointer(event, svgSel.node());
  const p = currentZoomTransform.invert([mx, my]);
  
  const r = cssNumber('--node-radius', 8) + 6;
  let nodeLabel = null;
  let personId = null;
  
  for (const nd of simAllById.values()) {
    if (nd.x == null || nd.y == null) continue;
    const dx = p[0] - nd.x, dy = p[1] - nd.y;
    if ((dx*dx + dy*dy) <= r*r) { 
      nodeLabel = getDisplayLabel(nd);
      personId = String(nd.id);
      break; 
    }
  }
  
  // Verwende die sortierte clustersAtPoint Funktion
  const hits = clustersAtPoint(p);
  
  let lines = [];
  
  // Person information or cluster information
  if (nodeLabel) {
    lines = buildPersonTooltipLines(personId, nodeLabel, hits);
  } else if (hits.length) {
    // Display cluster information with header
    lines.push('🏢 OE-Bereiche:');
    hits.forEach(hit => lines.push(`  • ${hit}`));
  }
  
  if (lines.length) {
    showTooltip(event.clientX, event.clientY, lines);
  } else {
    hideTooltip();
  }
}

// Color mapping for OEs (harmonious palette)
/**
 * Finds all organizational units a person belongs to
 * @param {string} personId - ID of the person
 * @returns {string[]} - Array of organization labels ordered by hierarchy (smallest/lowest unit first)
 */
export function findAllPersonOrgs(personId) {
  if (!personId || !raw || !Array.isArray(raw.links) || !Array.isArray(raw.orgs)) return [];

  const pid = String(personId);
  const orgIds = new Set(raw.orgs.map(o => String(o.id)));

  // Basis-OEs der Person: direkte Person->Org Kanten
  const baseOrgs = new Set();
  for (const link of raw.links) {
    if (!link) continue;
    const s = idOf(link.source);
    const t = idOf(link.target);
    if (s === pid && orgIds.has(t)) {
      baseOrgs.add(t);
    }
  }

  // Alle OEs entlang der Aufwärts-Kette (Basis-OE + alle Eltern) einsammeln
  const orgMap = new Map(); // label -> { id, depth }

  // Tiefe innerhalb der OE-Hierarchie cachen (Abstand zur Wurzel)
  const depthCache = new Map();
  const computeDepth = (oid) => {
    const key = String(oid);
    if (depthCache.has(key)) return depthCache.get(key);
    let d = 0;
    let cur = key;
    const seen = new Set();
    while (orgParent.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = orgParent.get(cur);
      d++;
    }
    depthCache.set(key, d);
    return d;
  };

  for (const baseId of baseOrgs) {
    let cur = String(baseId);
    const chainSeen = new Set();
    while (cur && !chainSeen.has(cur)) {
      chainSeen.add(cur);
      const node = byId.get(cur);
      if (node && node.type === 'org') {
        const label = node.label || cur;
        if (!orgMap.has(label)) {
          orgMap.set(label, { id: cur, depth: computeDepth(cur) });
        }
      }
      cur = orgParent.get(cur);
    }
  }

  // Nach Tiefe sortieren (kleinere/basisnähere OEs haben eine höhere Tiefe)
  return Array.from(orgMap.values())
    .sort((a, b) => b.depth - a.depth || String(a.id).localeCompare(String(b.id)))
    .map(item => {
      const node = byId.get(String(item.id));
      return getDisplayLabel(node, item.depth);
    });
}

export function hashCode(str){ let h=0; for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; } return h>>>0; }
export const orgColorCache = new Map();

export function colorForOrg(oid){
  if (orgColorCache.has(oid)) {
    return orgColorCache.get(oid);
  }
  
  const h = (hashCode(oid) % 12) * 30; // 12-step hue
  const fill = `hsla(${h}, 60%, 60%, 0.25)`;
  const stroke = `hsla(${h}, 60%, 40%, 0.85)`;
  const colors = { fill, stroke };
  
  orgColorCache.set(oid, colors);
  return colors;
}

export function orgDepth(oid){
  let d = 0;
  let cur = String(oid);
  const seen = new Set();
  while (parentOf && parentOf.has(cur)) {
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = parentOf.get(cur);
    d++;
  }
  return d;
}

/**
 * Konvertiert eine Farbe in ein transparentes RGBA-Format (wie bei OEs)
 * @param {string} color - Farbe im Format hsl(...) oder rgb(...) oder #hex
 * @param {number} alpha - Alpha-Wert (0-1), default 0.25 wie bei OEs
 * @returns {string} RGBA-Farbe mit Transparenz
 */
export function colorToTransparent(color, alpha = 0.25) {
  // Parse HSL
  const hslMatch = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(color);
  if (hslMatch) {
    const h = parseInt(hslMatch[1]);
    const s = parseInt(hslMatch[2]);
    const l = parseInt(hslMatch[3]);
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
  }
  
  // Fallback: gib die ursprüngliche Farbe zurück
  return color;
}



/**
 * Aktualisiert die Attribute-Statistik in der Fußzeile
 */
export function updateAttributeStats() {
  const attributeCountEl = document.getElementById('stats-attributes-count');
  if (attributeCountEl) {
    const loadedCount = attributeTypes.size;
    const activeCount = activeAttributes.size;
    attributeCountEl.textContent = `${activeCount}/${loadedCount}`;
  }
}

/**
 * Aktualisiert nur die Attribut-Kreise ohne ein komplettes Relayout
 */
export function updateAttributeCircles() {
  // Wenn wir aus dem renderGraph-Kontext heraus aufgerufen werden, ist der Graph bereits gerendert
  // Wenn nicht, prüfen wir, ob überhaupt ein Subgraph existiert
  
  // Styling-Parameter
  const nodeRadius = cssNumber('--node-radius', 3);
  const circleGap = cssNumber('--attribute-circle-gap', 1);
  const circleWidth = cssNumber('--attribute-circle-stroke-width', 2);
  const nodeStrokeWidth = cssNumber('--node-with-attributes-stroke-width', 2);
  
  // Farbe und Stil für Knoten mit Attributen
  const nodeWithAttributesFill = 'var(--node-with-attributes-fill)';
  const nodeWithAttributesStroke = 'var(--node-with-attributes-stroke, #4682b4)';
  const nodeWithAttributesStrokeWidth = cssNumber('--node-with-attributes-stroke-width', 3);
  
  // Transparenz für Knoten ohne Attribute
  const nodesWithoutAttributesOpacity = cssNumber('--nodes-without-attributes-opacity', 0.2);
  
  // Alle Knoten im SVG auswählen
  const nodes = d3.selectAll(SVG_ID + ' .node');
  
  const applyRootStyling = () => {
    nodes.each(function(d) {
      if (!d) return;
      const personId = String(d.id);
      const sid = String(personId);
      const hasExplicitRoots = Array.isArray(selectedRootIds) && selectedRootIds.length > 0;
      const isVisualRoot = hasExplicitRoots
        ? selectedRootIds.includes(sid)
        : (currentSelectedId != null && String(currentSelectedId) === sid);
      if (!isVisualRoot) return;
      const nodeGroup = d3.select(this);
      nodeGroup.select('circle.node-circle')
        .style('stroke', 'var(--root-node-stroke)')
        .style('stroke-width', cssNumber('--root-node-stroke-width', 3))
        .style('opacity', 1);
    });
  };
  
  // Alle bestehenden Attribut-Kreise entfernen
  nodes.selectAll('circle.attribute-circle').remove();
  
  // Wenn Attribute ausgeblendet sind, nur die Kreise entfernen und den Rest überspringen
  if (!attributesVisible) {
    // Alle Knoten auf Standard zurücksetzen, aber hierarchie-basierte Fill behalten
    nodes.selectAll('circle.node-circle')
      .style('fill', d => getNodeFillByLevel(d))
      .style('stroke', null)
      .style('stroke-width', null)
      .style('opacity', 1);
    
    // has-attributes Klasse entfernen [SF]
    nodes.classed('has-attributes', false);
    
    // Labels auf Standard-Position zurücksetzen
    nodes.selectAll('text.label')
      .attr('x', 10);
    
    applyRootStyling();
    return;
  }
  
  // Prüfe, ob es überhaupt aktive Attribute gibt
  const hasAnyActiveAttributes = activeAttributes.size > 0;
  
  // Set zum Speichern aller IDs von Knoten mit aktiven Attributen
  const nodesWithActiveAttributesIds = new Set();
  
  // Alle Knoten auf Standard zurücksetzen, aber hierarchie-basierte Fill behalten
  nodes.selectAll('circle.node-circle')
    .style('fill', d => getNodeFillByLevel(d))
    .style('stroke', null)
    .style('stroke-width', null)
    .style('opacity', 1);
  
  // has-attributes Klasse zurücksetzen (wird in der Schleife neu gesetzt) [SF]
  nodes.classed('has-attributes', false);
  
  // Labels auf Standard-Position zurücksetzen (werden später für Knoten mit Attributen angepasst)
  nodes.selectAll('text.label')
    .attr('x', 10);
  
  // Neue Attribut-Kreise hinzufügen und Knoten mit Attributen identifizieren
  nodes.each(function(d) {
    if (!d) return; // Sicherheitsprüfung
    
    const nodeGroup = d3.select(this);
    const personId = String(d.id);
    const nodeAttrs = personAttributes.get(personId);
    
    // Standardwert für Label-Position (ohne Attribute)
    let outerMostRadius = nodeRadius;
    
    // Knoten mit Attributen prüfen
    if (nodeAttrs && nodeAttrs.size > 0) {
      // Filtere auf aktive Attribute und nicht-ausgeblendete Kategorien
      const activeNodeAttrs = Array.from(nodeAttrs.entries())
        .filter(([attrName]) => {
          if (!activeAttributes.has(attrName)) return false;
          // Kategorie aus Attributnamen extrahieren
          const [category] = String(attrName).includes('::') ? String(attrName).split('::') : ['Attribute'];
          // Nur anzeigen, wenn Kategorie nicht ausgeblendet ist
          return !hiddenCategories.has(category);
        })
        .sort((a, b) => {
          const [ca, na] = String(a[0]).split('::');
          const [cb, nb] = String(b[0]).split('::');
          return (ca === cb) ? na.localeCompare(nb) : ca.localeCompare(cb);
        }); // Gruppiere nach Kategorie, dann nach Name
      
      // Wenn es aktive Attribute gibt, ändere den Hauptknoten und speichere die ID
      if (activeNodeAttrs.length > 0) {
        nodesWithActiveAttributesIds.add(personId);
        
        // Klasse für CSS-basierte Label-Sichtbarkeit setzen [SF]
        nodeGroup.classed('has-attributes', true);
        
        // Haupt-Knoten mit spezieller Darstellung für Knoten mit Attributen
        nodeGroup.select('circle.node-circle')
          .style('fill', nodeWithAttributesFill)
          .style('stroke', nodeWithAttributesStroke)
          .style('stroke-width', nodeWithAttributesStrokeWidth);
        
        // Berechne äußersten Radius für Label-Positionierung
        const attrCount = activeNodeAttrs.length;
        if (attrCount > 0) {
          // Äußerster Radius: nodeRadius + nodeStroke/2 + attrCount * (gap + width)
          outerMostRadius = nodeRadius + (nodeStrokeWidth / 2) + (attrCount * (circleGap + circleWidth));
        }
      }
      
      // Füge Attribute-Kreise von innen nach außen hinzu
      activeNodeAttrs.forEach(([attrName], idx) => {
        const attrColor = attributeTypes.get(attrName);
        if (!attrColor) return;
        
        // Kreisradius berechnen (gleichmäßige Abstände):
        // r0 = nodeRadius + nodeStroke/2 + gap + width/2
        // r(i) = r0 + i * (gap + width)
        const base = nodeRadius + (nodeStrokeWidth / 2) + circleGap + (circleWidth / 2);
        const attrRadius = base + idx * (circleGap + circleWidth);
        
        // Attributkreis vor dem Hauptkreis einfügen, damit er dahinter liegt
        nodeGroup.insert("circle", "circle.node-circle")
          .attr("r", attrRadius)
          .attr("class", "attribute-circle")
          .attr("data-attribute", attrName)
          .style("stroke", attrColor)
          .style("stroke-width", circleWidth);
      });
    }
    
    // Label-Position basierend auf dem äußersten Radius anpassen
    // Füge einen kleinen Abstand hinzu (z.B. 3 Pixel)
    const labelOffset = 3;
    const labelPos = (outerMostRadius === nodeRadius) ? 10 : (outerMostRadius + labelOffset);
    nodeGroup.select('text.label')
      .attr('x', labelPos);
  });
  
  // Wenn es aktive Attribute gibt, wende Transparenz auf alle Knoten ohne Attribute an
  if (hasAnyActiveAttributes && activeAttributes.size > 0 && nodesWithActiveAttributesIds.size > 0) {
    nodes.each(function(d) {
      if (!d) return;
      const personId = String(d.id);
      const nodeGroup = d3.select(this);
      
      // Wenn dieser Knoten nicht in der Liste der Knoten mit aktiven Attributen ist
      if (!nodesWithActiveAttributesIds.has(personId)) {
        nodeGroup.select('circle.node-circle')
          .style('opacity', nodesWithoutAttributesOpacity);
      }
    });
  }
  
  applyRootStyling();
}

export function updateFooterStats(subgraph) {
  // Update total loaded stats
  const nodesTotal = raw.nodes.length;
  const linksTotal = raw.links.length;
  const orgsTotal = raw.orgs.length;
  
  document.getElementById('stats-nodes-total').textContent = nodesTotal;
  document.getElementById('stats-links-total').textContent = linksTotal;
  document.getElementById('stats-orgs-total').textContent = orgsTotal;
  
  // Stelle sicher, dass die Attributstatistik aktualisiert wird, wenn noch nicht geschehen
  if (document.getElementById('stats-attributes-count').textContent === '0') {
    updateAttributeStats();
  }
  
  // Update visible stats (from subgraph if provided)
  if (subgraph) {
    document.getElementById('stats-nodes-visible').textContent = subgraph.nodes.length;
    document.getElementById('stats-links-visible').textContent = subgraph.links.length;
  } else {
    document.getElementById('stats-nodes-visible').textContent = 0;
    document.getElementById('stats-links-visible').textContent = 0;
  }
  
  // Update OE stats: show only active OEs, unless cluster count differs
  const clusterCount = clusterPolygons.size;
  const activeOrgsCount = allowedOrgs.size;
  const orgsDisplayEl = document.getElementById('stats-orgs-display');
  const orgsCountEl = document.getElementById('stats-orgs-count');
  
  if (clusterCount > 0 && clusterCount !== activeOrgsCount) {
    // Show both values when they differ
    orgsDisplayEl.innerHTML = `Aktive OEs: <strong>${activeOrgsCount}</strong> (Cluster: <strong>${clusterCount}</strong>)`;
  } else {
    // Show only active OEs
    orgsCountEl.textContent = activeOrgsCount;
  }
}

/**
 * Extrahiert ID aus Objekt oder String
 */
