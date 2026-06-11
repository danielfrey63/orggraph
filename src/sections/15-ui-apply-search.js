export function applyFromUI(triggerSource = 'unknown', callStack = false) {
  Logger.log(`[Timing] Start: applyFromUI.${triggerSource}`);
  if (!raw || !raw.links || !raw.nodes) return;
  if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
  
  Logger.log(`[UI] applyFromUI triggered by: ${triggerSource}`);
  if (callStack && debugMode) console.trace();
  
  // Reset hidden count für neue Berechnung
  currentHiddenCount = 0;
  
  // Get current search input value
  const input = document.querySelector(INPUT_COMBO_ID);
  const inputValue = input?.value.trim() || '';

  // Get selected depth
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  const depth = depthEl ? parseInt(depthEl.value, 10) || 0 : 0;

  // Get direction mode from split component
  let dirMode = 'both';
  const upHalf = document.querySelector('#directionToggle .direction-up');
  const downHalf = document.querySelector('#directionToggle .direction-down');
  if (upHalf && downHalf) {
    const upActive = upHalf.classList.contains('active');
    const downActive = downHalf.classList.contains('active');
    if (upActive && downActive) {
      dirMode = 'both';
    } else if (upActive) {
      dirMode = 'up';
    } else if (downActive) {
      dirMode = 'down';
    }
  }

  // Determine roots
  let roots = Array.isArray(selectedRootIds) && selectedRootIds.length > 0 ? selectedRootIds.slice() : [];
  if (roots.length === 0) {
    let startId = currentSelectedId;
    if (!startId && input && input.value) {
      startId = guessIdFromInput(input.value);
    }
    if (!startId) { setStatus("Startknoten nicht gefunden"); return; }
    roots = [String(startId)];
  }

  // Prüfen, ob sich die Root-Auswahl geändert hat (für BFS-Animation)
  const rootsKey = JSON.stringify(roots.slice().sort());
  const lastRootsKey = JSON.stringify((lastRenderRoots || []).slice().sort());
  const isNewRootSelection = rootsKey !== lastRootsKey;

  // Single-root or multi-root render
  let nextSubgraph;
  let scopeOrgs = new Set();

  if (roots.length === 1) {
    const startId = roots[0];
    // Merke letzten Einzel-Root für zukünftiges Shift-Add Seeding
    lastSingleRootId = String(startId);
    currentSelectedId = String(startId);
    nextSubgraph = computeSubgraph(startId, Number.isFinite(depth) ? depth : 2, dirMode);
    if (nextSubgraph.legendOrgs) scopeOrgs = nextSubgraph.legendOrgs;
  } else {
    // Multi-root: compute union of subgraphs
    const nodeMap = new Map();
    const linkSet = new Set();
    const effDepth = Number.isFinite(depth) ? depth : 2;
    
    for (const rid of roots) {
      const sub = computeSubgraph(rid, effDepth, dirMode);
      for (const n of sub.nodes) {
        const id = String(n.id);
        if (!nodeMap.has(id)) {
          nodeMap.set(id, { ...n });
        } else {
          const cur = nodeMap.get(id);
          cur.level = Math.min(cur.level || 0, n.level || 0);
          nodeMap.set(id, cur);
        }
      }
      for (const l of sub.links) {
        const s = idOf(l.source), t = idOf(l.target);
        linkSet.add(`${s}>${t}`);
      }
      // Add legend orgs from this subgraph
      if (sub.legendOrgs) {
        sub.legendOrgs.forEach(o => scopeOrgs.add(o));
      }
    }
    const nodes = Array.from(nodeMap.values());
    const links = Array.from(linkSet).map(k => {
      const [s, t] = k.split('>');
      return { source: s, target: t };
    });
    nextSubgraph = { nodes, links };
  }

  // Transition durchführen [SF][PA]
  const oldSubgraph = currentSubgraph;
  currentSubgraph = nextSubgraph;
  
  // Neue Transition ID generieren
  const transitionId = ++lastTransitionId;

  // Async Transition starten
  transitionGraph(oldSubgraph, nextSubgraph, roots, transitionId).then(() => {
    if (transitionId !== lastTransitionId) return; // Wenn veraltet, nichts mehr tun

    // Nach Abschluss sicherstellen, dass alles konsistent ist
    updateFooterStats(nextSubgraph);
    
    // Legende anwenden
    if (scopeOrgs.size > 0) {
      applyLegendScope(scopeOrgs);
      // syncGraphAndLegendColors() wird bereits in buildScopedOrgLegend() aufgerufen
    }
  });

  // Letzten Render-Zustand merken (für zukünftige Root-Wechsel-Erkennung)
  lastRenderRoots = roots.slice();
  lastRenderDepth = depth;
  lastRenderDirMode = dirMode;

  // Titel der Hidden-Legende aktualisieren nach allen Graph-Berechnungen
  updateHiddenLegendTitle();
}

/**
 * Parse a list of attributes from a text string.
 * 
 * @param {string} text - The text string to parse.
 * @returns {object} An object containing the parsed attributes.
 */
export function parseAttributeList(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const result = new Map();
  const foundAttributes = new Set();
  let count = 0;
  
  // Leere Dateien sind erlaubt - repräsentieren eine Kategorie ohne Attribute
  if (lines.length === 0) {
    return { 
      attributes: result, 
      types: Array.from(foundAttributes),
      count: 0,
      isEmpty: true
    };
  }
  
  for (const line of lines) {
    // Zeilenweise das Trennzeichen erkennen (Tab oder Komma)
    let separator = ',';
    let parts;
    
    if (line.includes('\t')) {
      // Tab-separiert
      parts = line.split('\t').map(p => p.trim());
    } else {
      // Komma-separiert
      parts = line.split(',').map(p => p.trim());
    }
    
    if (parts.length < 2) continue;
    
    const identifier = parts[0]; // ID oder E-Mail
    const attribute = parts[1]; // Attributname
    const value = parts.length > 2 ? parts[2] : '1'; // Optionaler Attributwert
    
    if (!result.has(identifier)) {
      result.set(identifier, new Map());
    }
    
    result.get(identifier).set(attribute, value);
    foundAttributes.add(attribute);
    count++;
  }
  
  return { 
    attributes: result, 
    types: Array.from(foundAttributes),
    count,
    isEmpty: false
  };
}

/**
 * Berechnet die Levenshtein-Distanz zwischen zwei Strings
 * Gibt einen Wert zurück, der die Ähnlichkeit der Strings angibt (kleinerer Wert = ähnlicher)
 */
export function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Erstelle eine Matrix für die Berechnung
  const matrix = [];
  
  // Initialisiere die erste Zeile und Spalte
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  // Berechne die Distanz
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Löschen
        matrix[i][j - 1] + 1,      // Einfügen
        matrix[i - 1][j - 1] + cost // Ersetzen oder Beibehalten
      );
    }
  }
  
  return matrix[len1][len2];
}

/**
 * Berechnet die normalisierte Levenshtein-Distanz zwischen zwei Strings
 * Gibt einen Wert zwischen 0 und 1 zurück (0 = identisch, 1 = komplett verschieden)
 */
export function normalizedLevenshteinDistance(str1, str2) {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  // Vermeide Division durch Null
  if (maxLength === 0) return 0;
  return distance / maxLength;
}

/**
 * Führt eine Fuzzy-Suche für einen Identifikator durch und gibt potentielle Treffer zurück
 */
export function fuzzySearch(identifier, threshold = 0.3, progressCallback = null, abortFlag = null) {
  if (!identifier || !String(identifier).trim()) return [];
  
  const normalizedInput = String(identifier).toLowerCase();
  const potentialMatches = [];
  let processedCount = 0;
  const totalItems = raw.persons.length;
  const batchSize = 100; // Anzahl der zu verarbeitenden Elemente pro Batch
  
  return new Promise((resolve) => {
    // Timer für Progress-Update, wenn die Suche länger als 1 Sekunde dauert
    let searchStartTime = performance.now();
    let progressShown = false;
    let progressTimer = setTimeout(() => {
      progressShown = true;
      if (progressCallback) progressCallback(0, totalItems);
    }, 1000);
    
    function processNextBatch(startIndex) {
      // Prüfen, ob die Suche abgebrochen wurde
      if (abortFlag && abortFlag.aborted) {
        clearTimeout(progressTimer);
        resolve([]); // Leeres Ergebnis zurückgeben
        return;
      }
      
      let endIndex = Math.min(startIndex + batchSize, totalItems);
      
      // Verarbeite den aktuellen Batch
      for (let i = startIndex; i < endIndex; i++) {
        // Noch einmal prüfen, ob die Suche abgebrochen wurde (feingranularer)
        if (abortFlag && abortFlag.aborted) break;
        
        const person = raw.persons[i];
        if (!person || !person.id) continue;
        
        // Berechne die Levenshtein-Distanz für ID
        const personId = String(person.id);
        const normalizedId = personId.toLowerCase();
        const idDistance = normalizedLevenshteinDistance(normalizedInput, normalizedId);
        
        // Berechne die Levenshtein-Distanz für E-Mail, falls vorhanden
        let emailDistance = 1; // Maximum (keine Übereinstimmung)
        let normalizedEmail = '';
        if (person.email) {
          normalizedEmail = person.email.toLowerCase();
          emailDistance = normalizedLevenshteinDistance(normalizedInput, normalizedEmail);
        }
        
        // Berechne die Levenshtein-Distanz für das Label (Name), falls vorhanden
        let labelDistance = 1; // Maximum (keine Übereinstimmung)
        let normalizedLabel = '';
        if (person.label) {
          normalizedLabel = person.label.toLowerCase();
          labelDistance = normalizedLevenshteinDistance(normalizedInput, normalizedLabel);
        }
        
        // Nehme den besten Match (kleinsten Distanzwert)
        const bestDistance = Math.min(idDistance, emailDistance, labelDistance);
        const matchedOn = bestDistance === idDistance ? 'ID' : 
                         (bestDistance === emailDistance ? 'E-Mail' : 'Name');
        
        // Wenn die Distanz unter dem Threshold liegt, füge es zu den potentiellen Matches hinzu
        if (bestDistance <= threshold) {
          potentialMatches.push({
            id: personId,
            label: person.label || personId,
            email: person.email || '',
            similarity: bestDistance,
            matchedOn
          });
        }
      }
      
      processedCount = endIndex;
      
      // Update Progress-Callback wenn gezeigt
      if (progressShown && progressCallback) {
        progressCallback(processedCount, totalItems);
      }
      
      // Abbruch oder Fortsetzung?
      if (abortFlag && abortFlag.aborted) {
        clearTimeout(progressTimer);
        resolve([]); // Leeres Ergebnis bei Abbruch
        return;
      }
      
      // Prüfen ob wir fertig sind oder den nächsten Batch verarbeiten müssen
      if (processedCount < totalItems) {
        // Für bessere Reaktionsfähigkeit der UI, zeitversetzt fortsetzen
        setTimeout(() => processNextBatch(endIndex), 0);
      } else {
        // Fertig! Timer löschen und Ergebnis zurückgeben
        clearTimeout(progressTimer);
        
        // Sortiere nach Ähnlichkeit (kleinere Werte zuerst)
        resolve(potentialMatches.sort((a, b) => a.similarity - b.similarity));
      }
    }
    
    // Starte die Verarbeitung mit dem ersten Batch
    processNextBatch(0);
  });
}

/**
 * Sucht nach Personen im Datensatz basierend auf ID oder E-Mail
 */
export function findPersonIdsByIdentifier(identifier) {
  const normalizedId = String(identifier).toLowerCase();
  const matches = [];
  
  // Suche nach exakter ID
  const exactById = raw.persons.find(p => String(p.id).toLowerCase() === normalizedId);
  if (exactById) matches.push(String(exactById.id));
  
  // Suche nach exakter E-Mail
  const exactByEmail = raw.persons.find(p => (p.email || '').toLowerCase() === normalizedId);
  if (exactByEmail && !matches.includes(String(exactByEmail.id))) {
    matches.push(String(exactByEmail.id));
  }
  
  return matches;
}

/**
 * Lädt Attributliste aus einer Datei mit Fuzzy-Search-Unterstützung
 */
export async function loadAttributesFromFile(file) {
  try {
    const text = await file.text();
    const { attributes, types, count, isEmpty } = parseAttributeList(text);
    
    // Leere Datei = nur Kategorie ohne Attribute
    if (isEmpty) {
      const category = file.name.replace(/\.[^/.]+$/, ''); // Dateiname ohne Extension
      
      // Registriere die leere Kategorie
      emptyCategories.add(category);
      
      // Speichere Quell-Informationen auch für leere Kategorien
      categorySourceFiles.set(category, {
        filename: file.name,
        url: null, // Von Datei geladen, nicht von URL
        originalText: text,
        format: 'comma' // Default für leere Dateien
      });
      
      showTemporaryNotification(`Kategorie "${category}" geladen (leer - nur Platzhalter)`, 3000);
      
      // UI aktualisieren
      buildAttributeLegend();
      updateAttributeStats();
      
      return true;
    }
    
    // Erkenne das verwendete Format für die Statusmeldung
    const hasTabFormat = text.includes('\t');
    const formatInfo = hasTabFormat ? 'Tab-separiert' : 'Komma-separiert';
    
    // Verknüpfe die geladenen Attribute mit den Personen-IDs
    const newPersonAttributes = new Map();
    const fuzzyMatches = new Map();
    const unmatchedEntries = new Map();
    let matchedCount = 0;
    
    // Progress-Anzeige erstellen
    let searchProgress = null;
    let searchCount = 0;
    let searchAborted = false; // Flag, um die Suche abzubrechen
    
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';
    progressContainer.style.display = 'none';
    
    const progressOverlay = document.createElement('div');
    progressOverlay.className = 'progress-overlay';
    
    const progressBox = document.createElement('div');
    progressBox.className = 'progress-box';
    
    const progressText = document.createElement('div');
    progressText.className = 'progress-text';
    progressText.textContent = 'Suche nach ähnlichen Einträgen...';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    
    const progressBarInner = document.createElement('div');
    progressBarInner.className = 'progress-bar-inner';
    progressBar.appendChild(progressBarInner);
    
    const progressPercent = document.createElement('div');
    progressPercent.className = 'progress-percent';
    progressPercent.textContent = '0%';
    
    // Abbrechen-Button hinzufügen
    const progressCancelBtn = document.createElement('button');
    progressCancelBtn.className = 'progress-cancel-btn';
    progressCancelBtn.textContent = 'Abbrechen';
    progressCancelBtn.addEventListener('click', () => {
      // Suche abbrechen
      searchAborted = true;
      
      // Dialog entfernen
      progressContainer.remove();
      
      // Meldung anzeigen
      showTemporaryNotification('Suche nach ähnlichen Einträgen abgebrochen');
    });
    
    progressBox.appendChild(progressText);
    progressBox.appendChild(progressBar);
    progressBox.appendChild(progressPercent);
    progressBox.appendChild(progressCancelBtn); // Button zum Container hinzufügen
    progressContainer.appendChild(progressOverlay);
    progressContainer.appendChild(progressBox);
    document.body.appendChild(progressContainer);
    
    // Progress-Callback für Fortschrittsanzeige
    const updateProgress = (processed, total) => {
      if (progressContainer.style.display === 'none') {
        progressContainer.style.display = 'flex';
      }
      
      const percent = Math.round((processed / total) * 100);
      progressBarInner.style.width = `${percent}%`;
      progressPercent.textContent = `${processed} / ${total} (${percent}%)`;
      progressText.textContent = `Suche nach ähnlichen Einträgen für ${searchCount} nicht exakt zugeordnete Attribute...`;
    };
    
    // Verarbeite alle Attribute
    // Sammle explizit alle Einträge ohne exakte Zuordnung für die spätere Fuzzy-Suche
    const unmatchedToSearch = [];
    for (const [identifier, attrs] of attributes.entries()) {
      const personIds = findPersonIdsByIdentifier(identifier);
      if (personIds.length > 0) {
        for (const id of personIds) {
          if (!newPersonAttributes.has(id)) {
            newPersonAttributes.set(id, new Map());
          }
          for (const [attrName, attrValue] of attrs.entries()) {
            newPersonAttributes.get(id).set(attrName, attrValue);
          }
        }
        matchedCount++;
      } else {
        // Zähle nicht exakt zugeordnete Einträge
        searchCount++;
        unmatchedToSearch.push([identifier, attrs]);
      }
    }
    
    // Abbruch-Flag außerhalb des Blocks deklarieren, damit es nachher sicher verfügbar ist
    let abortFlagObj = null;

    // Neue, vollständig lineare Fortschrittsberechnung für nicht-matched Attribute
    if (searchCount > 0) {
      progressText.textContent = `Vorbereitung der Suche für ${searchCount} nicht zugeordnete Attribute...`;
      
      // Klare Berechnung: Gesamtfortschritt = 100% / searchCount für jeden Eintrag
      const progressPerEntry = 1 / searchCount;
      
      // Statische Variablen zum Tracking des Fortschritts
      let searchesCompleted = 0;
      
      // Neuer, linearer Progress-Handler
      const linearProgressHandler = (entriesProcessed, totalEntries, currentEntryIndex) => {
        // Korrekte Index-Anzeige (1-basiert, begrenzt)
        const displayIndex = Math.max(1, Math.min(currentEntryIndex + 1, searchCount));
        
        // Prüfe auf Division durch Null
        const entryProgress = totalEntries > 0 ? entriesProcessed / totalEntries : 0;
        
        // Linearer Gesamtfortschritt:
        // - Abgeschlossene Einträge zählen zu 100%
        // - Aktueller Eintrag zählt anteilig
        const overallProgress = (searchesCompleted * progressPerEntry) + 
                              (entryProgress * progressPerEntry);
        
        // Sichere Prozentberechnung mit Rundung
        const percent = Math.round(overallProgress * 100);
        const boundedPercent = Math.max(0, Math.min(100, percent));
        
        // Aktualisiere die visuelle Anzeige
        progressBarInner.style.width = `${boundedPercent}%`;
        progressPercent.textContent = `${boundedPercent}%`;
        progressText.textContent = `Suche nach ähnlichen Einträgen... (${displayIndex} von ${searchCount})`;
        
        // Stelle sicher, dass der Progress-Dialog sichtbar ist
        if (progressContainer.style.display === 'none') {
          progressContainer.style.display = 'flex';
        }
      };
      
      // Objekt für das Abbruch-Flag (als Referenz, damit es in der fuzzySearch-Funktion aktualisiert werden kann)
      abortFlagObj = { aborted: false };
      
      // Abbruch-Flag mit dem Cancel-Button verknüpfen
      progressCancelBtn.addEventListener('click', () => {
        abortFlagObj.aborted = true;
      });
      
      // Fuzzy-Suche nur über die tatsächlich nicht zugeordneten Einträge durchführen
      for (let i = 0; i < unmatchedToSearch.length; i++) {
        if (searchAborted || (abortFlagObj && abortFlagObj.aborted)) break;

        const [identifier, attrs] = unmatchedToSearch[i];

        // Fortschritt-Handler für diesen Eintrag (Index i ist 0-basiert)
        const entryProgressHandler = (processed, total) => {
          linearProgressHandler(processed, total, i);
        };

        // Fuzzy Search durchführen
        const potentialMatches = await fuzzySearch(identifier, 0.3, entryProgressHandler, abortFlagObj);
        if (potentialMatches.length > 0) {
          fuzzyMatches.set(identifier, { attrs, potentialMatches });
        } else if (!abortFlagObj.aborted) {
          unmatchedEntries.set(identifier, attrs);
        }

        // Eintrag abgeschlossen -> Gesamtfortschritt erhöhen
        searchesCompleted++;
      }
    }
    
    // Progress-Anzeige entfernen
    progressContainer.remove();
    
    // Prüfen, ob die Suche abgebrochen wurde
    if (searchAborted || (abortFlagObj && abortFlagObj.aborted)) {
      showTemporaryNotification('Attribute-Import abgebrochen - keine Änderungen vorgenommen');
      return false;
    }
    
    // Generiere Farben für neue Attributtypen
    for (const type of types) {
      if (!attributeTypes.has(type)) {
        // Generiere eine neue Farbe für diesen Attributtyp
        const hue = (hashCode(type) % 360);
        const color = `hsl(${hue}, 70%, 50%)`;
        attributeTypes.set(type, color);
        activeAttributes.add(type); // Neue Attribute standardmäßig aktivieren
      }
    }
    
    // Wenn es Fuzzy-Matches gibt, zeige den Dialog
    if (fuzzyMatches.size > 0) {
      showFuzzyMatchDialog(fuzzyMatches, unmatchedEntries, newPersonAttributes, attributeTypes);
      return true;
    }
    
    // Wenn nur unmatched entries existieren, exportiere diese
    if (unmatchedEntries.size > 0) {
      exportUnmatchedEntries(unmatchedEntries);
    }
    
    // Setze die neuen Attribute und aktualisiere
    personAttributes = newPersonAttributes;
    
    // Speichere Quell-Informationen für späteres Speichern
    const category = file.name.replace(/\.[^/.]+$/, '');
    categorySourceFiles.set(category, {
      filename: file.name,
      url: null, // Von Datei geladen, nicht von URL
      originalText: text,
      format: hasTabFormat ? 'tab' : 'comma'
    });
    
    // UI aktualisieren
    buildAttributeLegend();
    updateAttributeStats();
    
    // Nur die Attribut-Kreise aktualisieren, ohne Layout-Neuberechnung
    if (currentSubgraph) updateAttributeCircles();
    
    // Zeige eine temporäre Benachrichtigung ohne den Status zu überschreiben
    showTemporaryNotification(`Attribute geladen: ${count} Einträge, ${matchedCount} gefunden (${formatInfo})`);
    
    return true;
  } catch (e) {
    // Zeige Fehler als Benachrichtigung an, nicht als Status
    showTemporaryNotification(`Fehler beim Laden der Attribute: ${e.message}`, 5000);
    console.error('Fehler beim Laden der Attribute:', e);
    return false;
  }
}

/**
 * Hilfsfunktionen für Icons (zentrale Registry ICON, siehe icons.js)
 */
