/**
 * Export-Funktionen für Grafiken
 */

// Globale Export-Variablen
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
function initializeExport() {
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
    if (exportModal && exportModal.style.display === 'flex') {
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
      if (format === 'svg') {
        svgOptionsDiv.style.display = 'block';
        pngOptionsDiv.style.display = 'none';
      } else if (format === 'png') {
        svgOptionsDiv.style.display = 'none';
        pngOptionsDiv.style.display = 'block';
      }
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
function showExportDialog() {
  if (exportModal) {
    exportModal.style.display = 'flex';
    
    // Setze die erste Auflösungs-Preset als aktiv
    if (resolutionPresets && resolutionPresets.length > 0) {
      resolutionPresets[0].classList.add('active');
    }
  }
}

/**
 * Verbirgt den Export-Dialog
 */
function hideExportDialog() {
  if (exportModal) {
    exportModal.style.display = 'none';
  }
}

/**
 * Exportiert den Graphen als SVG-Datei
 */
function exportAsSvg() {
  // SVG-Element abrufen
  const svgElement = document.querySelector(SVG_ID);
  if (!svgElement) {
    showTemporaryNotification('SVG-Element konnte nicht gefunden werden.');
    return;
  }
  
  try {
    // Klonen des SVG-Elements für den Export
    const svgClone = svgElement.cloneNode(true);
    
    // SVG-Attribute für Export setzen
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    
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
    
    // Labels-Sichtbarkeit übernehmen - prüfe ob das SVG bereits die Klasse 'labels-hidden' hat
    const originalSvg = document.querySelector(SVG_ID);
    if (originalSvg && originalSvg.classList.contains('labels-hidden')) {
      svgClone.classList.add('labels-hidden');
    }
    
    // Farben und Stile als inline CSS einfügen
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .link { stroke: ${getComputedStyle(document.documentElement).getPropertyValue('--link-stroke')}; stroke-width: ${getComputedStyle(document.documentElement).getPropertyValue('--link-stroke-width')}; stroke-opacity: ${getComputedStyle(document.documentElement).getPropertyValue('--link-opacity')}; }
      .node-circle { fill: ${getComputedStyle(document.documentElement).getPropertyValue('--node-fill')}; stroke: ${getComputedStyle(document.documentElement).getPropertyValue('--node-stroke')}; stroke-width: ${getComputedStyle(document.documentElement).getPropertyValue('--node-stroke-width')}; }
      .cluster { fill: ${getComputedStyle(document.documentElement).getPropertyValue('--cluster-fill')}; stroke: ${getComputedStyle(document.documentElement).getPropertyValue('--cluster-stroke')}; stroke-width: 1.5px; opacity: ${getComputedStyle(document.documentElement).getPropertyValue('--cluster-opacity')}; }
      .label { font-size: 8px; fill: #000; }
      .attribute-circle { fill: none; opacity: 0.8; }
      .labels-hidden .label { display: none; }
    `;
    svgClone.insertBefore(styleElement, svgClone.firstChild);
    
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
function exportAsPng() {
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
    
    // Aktuellen Inhalt des SVGs klonen und für Export aufbereiten
    const svgClone = svgElement.cloneNode(true);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    
    // Aktuelles ViewBox und Style extrahieren
    const currentViewBox = svgElement.getAttribute('viewBox') || `0 0 ${WIDTH} ${HEIGHT}`;
    
    // Setze Größe und ViewBox für Export
    svgClone.setAttribute('width', width);
    svgClone.setAttribute('height', height);
    svgClone.setAttribute('viewBox', currentViewBox);
    
    // Labels-Sichtbarkeit übernehmen - prüfe ob das SVG bereits die Klasse 'labels-hidden' hat
    const originalSvg = document.querySelector(SVG_ID);
    if (originalSvg && originalSvg.classList.contains('labels-hidden')) {
      svgClone.classList.add('labels-hidden');
    }
    
    // Inline-Styles einfügen
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .link { stroke: ${getComputedStyle(document.documentElement).getPropertyValue('--link-stroke')}; stroke-width: ${getComputedStyle(document.documentElement).getPropertyValue('--link-stroke-width')}; stroke-opacity: ${getComputedStyle(document.documentElement).getPropertyValue('--link-opacity')}; }
      .node-circle { fill: ${getComputedStyle(document.documentElement).getPropertyValue('--node-fill')}; stroke: ${getComputedStyle(document.documentElement).getPropertyValue('--node-stroke')}; stroke-width: ${getComputedStyle(document.documentElement).getPropertyValue('--node-stroke-width')}; }
      .cluster { fill: ${getComputedStyle(document.documentElement).getPropertyValue('--cluster-fill')}; stroke: ${getComputedStyle(document.documentElement).getPropertyValue('--cluster-stroke')}; stroke-width: 1.5px; opacity: ${getComputedStyle(document.documentElement).getPropertyValue('--cluster-opacity')}; }
      .label { font-size: 8px; fill: #000; }
      .attribute-circle { fill: none; opacity: 0.8; }
      body { background-color: ${getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg')}; }
      .labels-hidden .label { display: none; }
    `;
    svgClone.insertBefore(styleElement, svgClone.firstChild);
    
    // Hintergrundfarbe hinzufügen (da SVGs standardmäßig keinen Hintergrund haben)
    const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backgroundRect.setAttribute('width', '100%');
    backgroundRect.setAttribute('height', '100%');
    backgroundRect.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg'));
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
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg');
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
function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}
