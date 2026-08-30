let exportModal = null;
let exportOverlay = null;
let exportCloseBtn = null;
let exportFormatBtns = null;
let svgOptionsDiv = null;
let pngOptionsDiv = null;
let downloadSvgBtn = null;
let downloadPngBtn = null;
let resolutionPresets = null;
let customWidthInput = null;
let customHeightInput = null;

/**
 * Initialisiere den Export-Dialog und die zugehörigen Event-Listener
 */
export function initializeExport() {
  // Dialog-Elemente abrufen
  exportModal = document.getElementById('exportModal');
  exportOverlay = exportModal.querySelector('.modal-overlay');
  exportCloseBtn = exportModal.querySelector('.modal-close-btn');
  exportFormatBtns = exportModal.querySelectorAll('.format-btn');
  svgOptionsDiv = document.getElementById('svgOptions');
  pngOptionsDiv = document.getElementById('pngOptions');
  downloadSvgBtn = document.getElementById('downloadSvg');
  downloadPngBtn = document.getElementById('downloadPng');
  resolutionPresets = document.querySelectorAll('.resolution-preset');
  customWidthInput = document.getElementById('customWidth');
  customHeightInput = document.getElementById('customHeight');
  
  // Export-Button Event-Listener
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', showExportDialog);
  }
  
  // Event-Listener für den Schließen-Button
  if (exportCloseBtn) {
    exportCloseBtn.addEventListener('click', hideExportDialog);
  }
  
  // Event-Listener für Overlay-Klick zum Schließen
  if (exportOverlay) {
    exportOverlay.addEventListener('click', hideExportDialog);
  }
  
  // Keyboard-Event-Listener für Enter-Taste
  document.addEventListener('keydown', (e) => {
    // Nur wenn Modal geöffnet ist
    if (exportModal && exportModal.classList.contains('open')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        
        // Bestimme welches Format aktiv ist
        const activeFormatBtn = exportModal.querySelector('.format-btn.active');
        const format = activeFormatBtn ? activeFormatBtn.dataset.format : 'png';
        
        // Trigger entsprechenden Download
        if (format === 'svg') {
          exportAsSvg();
        } else {
          exportAsPng();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideExportDialog();
      }
    }
  });
  
  // Format-Umschaltung zwischen SVG und PNG mit Buttons
  exportFormatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.format;
      
      // Aktiven Zustand für alle Buttons entfernen
      exportFormatBtns.forEach(b => b.classList.remove('active'));
      // Aktiven Zustand für geklickten Button setzen
      btn.classList.add('active');
      
      // Optionen anzeigen/verstecken
      svgOptionsDiv.hidden = format !== 'svg';
      pngOptionsDiv.hidden = format !== 'png';
    });
  });
  
  // Event-Listener für Auflösungs-Presets
  resolutionPresets.forEach(preset => {
    preset.addEventListener('click', () => {
      // Aktiven Zustand entfernen
      resolutionPresets.forEach(p => p.classList.remove('active'));
      // Aktiven Zustand setzen
      preset.classList.add('active');
      
      // Werte auf Eingabefelder übertragen
      customWidthInput.value = preset.dataset.width;
      customHeightInput.value = preset.dataset.height;
    });
  });
  
  // Event-Listener für Custom-Resolution-Eingabefelder
  if (customWidthInput) {
    // Entferne active von Presets bei Eingabe
    customWidthInput.addEventListener('input', () => {
      resolutionPresets.forEach(p => p.classList.remove('active'));
    });
    // Auto-Select beim Focus
    customWidthInput.addEventListener('focus', function() {
      this.select();
    });
    // Auto-Select beim Klick (für den Fall, dass bereits fokussiert)
    customWidthInput.addEventListener('click', function() {
      this.select();
    });
  }
  if (customHeightInput) {
    // Entferne active von Presets bei Eingabe
    customHeightInput.addEventListener('input', () => {
      resolutionPresets.forEach(p => p.classList.remove('active'));
    });
    // Auto-Select beim Focus
    customHeightInput.addEventListener('focus', function() {
      this.select();
    });
    // Auto-Select beim Klick (für den Fall, dass bereits fokussiert)
    customHeightInput.addEventListener('click', function() {
      this.select();
    });
  }
  
  // SVG-Download
  downloadSvgBtn.addEventListener('click', exportAsSvg);
  
  // PNG-Download
  downloadPngBtn.addEventListener('click', exportAsPng);
}

/**
 * Zeigt den Export-Dialog an
 */
export function showExportDialog() {
  if (exportModal) {
    exportModal.classList.add('open');
    
    // Setze die erste Auflösungs-Preset als aktiv
    if (resolutionPresets && resolutionPresets.length > 0) {
      resolutionPresets[0].classList.add('active');
    }
  }
}

/**
 * Verbirgt den Export-Dialog
 */
export function hideExportDialog() {
  if (exportModal) {
    exportModal.classList.remove('open');
  }
}

/**
 * Runtime modal following the #exportModal contract:
 * .modal.open > .modal-overlay + .modal-container > .modal-header (h2 + ×) + .modal-content.
 * Returns the root, the content host and close(), which removes the dialog and
 * reports onClose. Overlay click and the header × close; Escape stays with the
 * caller (it usually belongs to the focused input).
 */
export function createModal({ id, title, onClose } = {}) {
  const modal = document.createElement('div');
  if (id) modal.id = id;
  modal.className = 'modal open';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const container = document.createElement('div');
  container.className = 'modal-container';
  const header = document.createElement('div');
  header.className = 'modal-header';
  const heading = document.createElement('h2');
  heading.textContent = title || '';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close-btn';
  setIcon(closeBtn, 'close');
  header.append(heading, closeBtn);
  const content = document.createElement('div');
  content.className = 'modal-content';
  container.append(header, content);
  modal.append(overlay, container);
  const close = () => {
    if (!modal.isConnected) return;
    modal.remove();
    if (onClose) onClose();
  };
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target === overlay) close(); });
  document.body.appendChild(modal);
  return { modal, content, close };
}

/** Resolved value of a CSS custom property on :root (export clones carry literal values). */
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name);

/**
 * Export clone of the live graph: sanitized (FR-8.5), namespaced, with the
 * label-visibility classes carried over so the export matches the screen.
 */
function buildExportClone(svgElement) {
  const svgClone = svgElement.cloneNode(true);
  sanitizeExportClone(svgClone);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  for (const cls of ['labels-hidden', 'labels-attributes-only']) {
    if (svgElement.classList.contains(cls)) svgClone.classList.add(cls);
  }
  return svgClone;
}

/**
 * Inline stylesheet for an export clone — the graph's CSS variables resolved
 * to literal values. withBody adds the canvas background (PNG rasterization).
 */
function buildExportStylesheet({ withBody = false } = {}) {
  const styleElement = document.createElement('style');
  styleElement.textContent = `
      .link { stroke: ${cssVar('--link-stroke')}; stroke-width: ${cssVar('--link-stroke-width')}; stroke-opacity: ${cssVar('--link-opacity')}; }
      #arrow path { fill: ${cssVar('--link-stroke')}; fill-opacity: ${cssVar('--link-opacity')}; }
      .node-circle { fill: ${cssVar('--node-fill')}; stroke: ${cssVar('--node-stroke')}; stroke-width: ${cssVar('--node-stroke-width')}; }
      .cluster { fill: ${cssVar('--cluster-fill')}; stroke: ${cssVar('--cluster-stroke')}; stroke-width: ${cssVar('--cluster-stroke-width')}; opacity: ${cssVar('--cluster-opacity')}; }
      .label { font-size: ${cssVar('--label-font-size')}; fill: ${cssVar('--label-fill')}; }
      .link-label { font-size: ${cssVar('--link-label-font-size')}; fill: ${cssVar('--link-label-fill')}; text-anchor: middle; }
      .attribute-circle { fill: none; opacity: ${cssVar('--attribute-circle-opacity')}; }
      ${withBody ? `body { background-color: ${cssVar('--canvas-bg')}; }` : ''}
      .labels-hidden .label { display: none; }
      .labels-attributes-only .label { display: none; }
      .labels-attributes-only .node.has-attributes .label { display: block; }
    `;
  return styleElement;
}

/**
 * Export sanitization (FR-8.5, AK 89): the exported artifact must not leak
 * raw tenant values anywhere a parser could read them. Visible text is
 * already pseudonymized fail-closed by the display-label resolver, so what
 * remains are interaction-only carriers: data-* attributes (ring group keys),
 * <title>/<desc> tooltips and comments. They serve no purpose in an export
 * and are stripped unconditionally. PNG exports go through canvas.toBlob,
 * which writes no textual metadata chunks.
 */
export function sanitizeExportClone(root) {
  for (const el of root.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
    }
  }
  for (const t of root.querySelectorAll('title, desc')) t.remove();
  const comments = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.remove();
}

/**
 * Exportiert den Graphen als SVG-Datei
 */
export function exportAsSvg() {
  // SVG-Element abrufen
  const svgElement = document.querySelector(SVG_ID);
  if (!svgElement) {
    showTemporaryNotification('SVG-Element konnte nicht gefunden werden.');
    return;
  }
  
  try {
    const svgClone = buildExportClone(svgElement);

    // Aktuelles ViewBox und Style extrahieren
    const viewBox = svgClone.getAttribute('viewBox');
    const computedStyle = window.getComputedStyle(svgElement);
    const width = parseInt(computedStyle.width, 10);
    const height = parseInt(computedStyle.height, 10);
    
    svgClone.setAttribute('width', width);
    svgClone.setAttribute('height', height);
    if (!viewBox) {
      svgClone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    // Farben und Stile als inline CSS einfügen
    svgClone.insertBefore(buildExportStylesheet(), svgClone.firstChild);
    
    // SVG in Text umwandeln
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svgClone);
    
    // Erstelle einen Blob aus dem SVG-String
    const svgBlob = new Blob([svgString], {type: 'image/svg+xml;charset=utf-8'});
    
    // Download des SVG initiieren
    const url = URL.createObjectURL(svgBlob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'orggraph_export_' + getTimestamp() + '.svg';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
    
    // Dialog schließen und Erfolg melden
    hideExportDialog();
    showTemporaryNotification('SVG-Export erfolgreich!');
  } catch (error) {
    console.error('Fehler beim SVG-Export:', error);
    showTemporaryNotification('Fehler beim SVG-Export: ' + error.message);
  }
}

/**
 * Exportiert den Graphen als PNG-Datei mit gewählter Auflösung und Qualität
 */
export function exportAsPng() {
  // SVG-Element abrufen
  const svgElement = document.querySelector(SVG_ID);
  if (!svgElement) {
    showTemporaryNotification('SVG-Element konnte nicht gefunden werden.');
    return;
  }
  
  try {
    // Auflösung aus Eingabefeldern abrufen
    const width = parseInt(customWidthInput.value, 10) || 1200;
    const height = parseInt(customHeightInput.value, 10) || 800;
    
    // Qualitätsfaktor (Pixeldichte) - immer Maximum für beste Qualität
    const quality = 4.0;
    
    const svgClone = buildExportClone(svgElement);
    
    // Aktuelles ViewBox und Style extrahieren
    const currentViewBox = svgElement.getAttribute('viewBox') || `0 0 ${WIDTH} ${HEIGHT}`;
    
    // Setze Größe und ViewBox für Export
    svgClone.setAttribute('width', width);
    svgClone.setAttribute('height', height);
    svgClone.setAttribute('viewBox', currentViewBox);

    // Inline-Styles einfügen
    svgClone.insertBefore(buildExportStylesheet({ withBody: true }), svgClone.firstChild);

    // Hintergrundfarbe hinzufügen (da SVGs standardmäßig keinen Hintergrund haben)
    const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backgroundRect.setAttribute('width', '100%');
    backgroundRect.setAttribute('height', '100%');
    backgroundRect.setAttribute('fill', cssVar('--canvas-bg'));
    svgClone.insertBefore(backgroundRect, svgClone.firstChild);
    
    // SVG in Text umwandeln
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgClone);
    
    // Base64-kodiertes SVG erstellen für die Bildkonvertierung
    const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
    
    // Konvertieren in ein Bild mit Canvas
    const img = new Image();
    img.onload = function() {
      // Canvas für die Konvertierung erstellen
      const canvas = document.createElement('canvas');
      canvas.width = width * quality; // Höhere Auflösung durch Qualitätsfaktor
      canvas.height = height * quality;
      
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = cssVar('--canvas-bg');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Anti-Aliasing aktivieren
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Bild im Canvas zeichnen
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Canvas in PNG umwandeln
      const pngDataUrl = canvas.toDataURL('image/png');
      
      // Download des PNG initiieren
      const downloadLink = document.createElement('a');
      downloadLink.href = pngDataUrl;
      downloadLink.download = 'orggraph_export_' + getTimestamp() + '.png';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Dialog schließen und Erfolg melden
      hideExportDialog();
      showTemporaryNotification('PNG-Export erfolgreich!');
    };
    
    // Fehlerbehandlung für Bildladung
    img.onerror = function(error) {
      console.error('Fehler beim Laden des SVG für PNG-Export:', error);
      showTemporaryNotification('Fehler beim PNG-Export: Bild konnte nicht geladen werden');
    };
    
    // Starte den Ladevorgang des Bildes
    img.src = svgBase64;
  } catch (error) {
    console.error('Fehler beim PNG-Export:', error);
    showTemporaryNotification('Fehler beim PNG-Export: ' + error.message);
  }
}

/**
 * Generiert einen Zeitstempel im Format YYYYMMDD_HHmmss für Dateinamen
 * @returns {string} Formatierter Zeitstempel
 */
export function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}


// ===== src/storage.js =====
// ========== Local persistence layer (IndexedDB) ==========
// Dependency-free. Stores the raw text of dropped/loaded files so the app can
// reload them automatically on the next visit without a server or fetch().
// Works on file:// origins (unlike fetch of local files), which is the whole
// point of the standalone build.

