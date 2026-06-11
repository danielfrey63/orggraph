export function showFuzzyMatchDialog(fuzzyMatches, unmatchedEntries, newPersonAttributes, attributeTypes) {
  // Dialog-Container erstellen
  const dialogContainer = document.createElement('div');
  dialogContainer.className = 'fuzzy-match-dialog-container';
  
  // Event-Listener für Dialog-Schließung durch Klick auf Overlay - Abbruch ohne Änderungen
  dialogContainer.addEventListener('click', (e) => {
    // Nur reagieren, wenn direkt auf den Container geklickt wurde (nicht auf Dialog-Inhalt)
    if (e.target === dialogContainer) {
      // Bereinige alle Dropdown-Elemente
      document.querySelectorAll('body > .combo-list').forEach(el => {
        el.remove();
      });
      
      // Entferne den Dialog ohne Attribute zu importieren
      dialogContainer.remove();
      
      // Benachrichtigung anzeigen
      showTemporaryNotification('Import abgebrochen - keine Änderungen vorgenommen');
    }
  });
  
  // ESC-Taste zum Abbrechen des Dialogs ohne Änderungen
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape' && document.body.contains(dialogContainer)) {
      // Bereinige alle Dropdown-Elemente
      document.querySelectorAll('body > .combo-list').forEach(el => {
        el.remove();
      });
      
      // Entferne den Dialog ohne Attribute zu importieren
      dialogContainer.remove();
      
      // Benachrichtigung anzeigen
      showTemporaryNotification('Import abgebrochen - keine Änderungen vorgenommen');
      
      // Entferne den Event-Listener nach Dialog-Schließung
      document.removeEventListener('keydown', escHandler);
    }
  });
  
  const dialog = document.createElement('div');
  dialog.className = 'fuzzy-match-dialog';
  
  // Dialog-Header
  const header = document.createElement('div');
  header.className = 'fuzzy-match-header';
  
  const title = document.createElement('h2');
  title.textContent = 'Mögliche Übereinstimmungen gefunden';
  header.appendChild(title);
  
  // Close Button (Abbrechen)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'fuzzy-match-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Abbrechen';
  closeBtn.addEventListener('click', () => {
    // Abbrechen ohne Änderungen - nichts importieren
    
    // Bereinige alle Dropdown-Elemente, die direkt an body angehängt wurden
    document.querySelectorAll('body > .combo-list').forEach(el => {
      el.remove();
    });
    
    // Entferne den Dialog ohne Attribute zu importieren
    dialogContainer.remove();
    
    // Benachrichtigung anzeigen
    showTemporaryNotification('Import abgebrochen - keine Änderungen vorgenommen');
  });
  header.appendChild(closeBtn);
  
  dialog.appendChild(header);
  
  // Dialog-Inhalt
  const content = document.createElement('div');
  content.className = 'fuzzy-match-content';
  
  // Meldung
  const message = document.createElement('p');
  message.textContent = 'Folgende Einträge konnten nicht eindeutig zugeordnet werden. Bitte wählen Sie die korrekte Zuordnung:'
  content.appendChild(message);
  
  // Liste der Fuzzy-Matches
  const matchList = document.createElement('div');
  matchList.className = 'fuzzy-match-list';
  
  // Für jeden unklaren Eintrag
  for (const [identifier, { attrs, potentialMatches }] of fuzzyMatches.entries()) {
    const matchItem = document.createElement('div');
    matchItem.className = 'fuzzy-match-item';
    
    // Vereinfachter Header mit Identifier und Attributen in einer Zeile
    const itemInfo = document.createElement('div');
    itemInfo.className = 'fuzzy-match-info';
    
    // Erstelle Infotext (Identifier und Attribute)
    const identifierDisplay = document.createElement('span');
    identifierDisplay.className = 'fuzzy-identifier';
    identifierDisplay.textContent = identifier;
    itemInfo.appendChild(identifierDisplay);
    
    // Trenner
    itemInfo.appendChild(document.createTextNode(' — '));
    
    // Attribute anzeigen
    const attrsDisplay = document.createElement('span');
    attrsDisplay.className = 'fuzzy-attrs';
    attrsDisplay.textContent = Array.from(attrs.entries())
      .map(([name, value]) => `${name}${value !== '1' ? `: ${value}` : ''}`)
      .join(', ');
    itemInfo.appendChild(attrsDisplay);
    
    matchItem.appendChild(itemInfo);
    
    // Combo-Container im Stil des Hauptfensters (eine einzelne Komponente)
    const comboContainer = document.createElement('div');
    comboContainer.className = 'fuzzy-match-combo';
    
    // Die eigentliche Combo-Box
    const combo = document.createElement('div');
    combo.className = 'combo';
    comboContainer.appendChild(combo);
    
    // Suchfeld innerhalb der Combo
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'combo-input';
    searchInput.placeholder = 'Klicken zum Auswählen...';
    searchInput.id = `fuzzy-search-${identifier}`;
    searchInput.setAttribute('data-identifier', identifier);
    
    // Standardwert: "Keine Übereinstimmung - als unzugeordnet markieren"
    const defaultText = 'Keine Übereinstimmung - als unzugeordnet markieren';
    searchInput.value = defaultText;
    
    // Default: keine Übereinstimmung (unmatched entry)
    unmatchedEntries.set(identifier, attrs);
    
    combo.appendChild(searchInput);
    
    // Dropdown-Liste mit verbesserter Sichtbarkeit
    const dropdownList = document.createElement('ul');
    dropdownList.className = 'combo-list';
    dropdownList.id = `fuzzy-list-${identifier}`;
    
    // Beginn: unsichtbar, aber bereit zum Anzeigen
    dropdownList.style.cssText = 'display: none; visibility: hidden; opacity: 0;';
    
    // Füge das Dropdown direkt an body an, damit es nicht von anderen Elementen verdeckt wird
    // Wir werden die Position später anpassen
    document.body.appendChild(dropdownList);
    
    // Speichere die Referenz auf das Dropdown im Combo-Element
    combo.dropdownElement = dropdownList;
    
    // Option "Keine Übereinstimmung" als erstes Item
    const noMatchItem = document.createElement('li');
    noMatchItem.dataset.value = 'none';
    noMatchItem.dataset.search = 'keine übereinstimmung unzugeordnet';
    noMatchItem.textContent = 'Keine Übereinstimmung - als unzugeordnet markieren';
    noMatchItem.classList.add('none-match-option');
    noMatchItem.addEventListener('click', (e) => {
      e.stopPropagation(); // Verhindern, dass das Klick-Event zu anderen Elementen propagiert
      searchInput.value = noMatchItem.textContent;
      dropdownList.style.cssText = 'display: none !important;';
      // "Keine Übereinstimmung" - zur unmatched Liste hinzufügen
      unmatchedEntries.set(identifier, attrs);
      
      // Fokus zurück auf Eingabefeld setzen
      searchInput.focus();
    });
    dropdownList.appendChild(noMatchItem);
    
    // Keine Trennlinie mehr zwischen "Keine Übereinstimmung" und den Vorschlägen
    
    // Speichere die Matches für die Suche
    const matchOptions = [];
    
    // Potentielle Matches als Liste hinzufügen
    for (const match of potentialMatches) {
      const option = document.createElement('li');
      option.dataset.value = match.id;
      
      // Ähnlichkeit als Prozentsatz anzeigen
      const similarityPercent = Math.round((1 - match.similarity) * 100);
      
      // HTML für formatiertes Item
      const nameHtml = `<strong>${match.label}</strong> (ID: ${match.id})`;
      const emailHtml = match.email ? ` - ${match.email}` : '';
      const similarityHtml = ` <span class="match-similarity">${similarityPercent}%</span>`;
      const matchedOnHtml = ` <span class="match-source">(${match.matchedOn})</span>`;
      
      option.innerHTML = nameHtml + emailHtml + similarityHtml + matchedOnHtml;
      
      // Such-Keywords hinzufügen
      let searchTerms = match.label + ' ' + match.id;
      if (match.email) searchTerms += ' ' + match.email;
      searchTerms += ' ' + match.matchedOn + ' ' + similarityPercent;
      option.dataset.search = searchTerms.toLowerCase();
      
      // Click-Handler mit verbessertem Verhalten
      option.addEventListener('click', (e) => {
        e.stopPropagation(); // Verhindere Bubbling
        
        // Setze den Wert im Suchfeld
        searchInput.value = match.label + (match.email ? ` (${match.email})` : ` (ID: ${match.id})`);
        
        // Dropdown vollständig ausblenden mit !important
        dropdownList.style.cssText = 'display: none !important; visibility: hidden !important;';
        
        // Aus unmatched entfernen, falls vorhanden
        unmatchedEntries.delete(identifier);
        
        // Attribute zuordnen
        const personId = match.id;
        if (!newPersonAttributes.has(personId)) {
          newPersonAttributes.set(personId, new Map());
        }
        for (const [attrName, attrValue] of attrs.entries()) {
          newPersonAttributes.get(personId).set(attrName, attrValue);
        }
        
        // Fokus zurück auf Eingabefeld setzen
        searchInput.focus();
      });
      
      dropdownList.appendChild(option);
      matchOptions.push({
        element: option,
        id: match.id,
        label: match.label,
        email: match.email || '',
        matchedOn: match.matchedOn,
        similarity: match.similarity,
        similarityPercent: similarityPercent,
        searchTerms: searchTerms.toLowerCase()
      });
    }
    
    // Variablen für die aktuelle Auswahl in der Combo-Box
    let activeItemIndex = -1;
    let visibleItems = [];
    
    // Hilfsfunktion, um das aktive Item zu setzen
    const setActiveItem = (index) => {
      // Alte Auswahl entfernen
      dropdownList.querySelectorAll('li').forEach(li => li.classList.remove('is-active'));
      
      // Gültige Indizes prüfen
      activeItemIndex = Math.max(-1, Math.min(index, visibleItems.length - 1));
      
      // Neue Auswahl setzen, wenn Index gültig
      if (activeItemIndex >= 0) {
        visibleItems[activeItemIndex].classList.add('is-active');
      }
    };
    
    // Hilfsfunktion zum Auswählen eines Items
    const chooseItem = (index) => {
      if (index >= 0 && index < visibleItems.length) {
        // Simuliere einen Klick auf das Element
        visibleItems[index].click();
      }
    };
    
    // Verbesserter Event-Listener für Tastatureingaben
    searchInput.addEventListener('keydown', (e) => {
      // Stell sicher, dass das Dropdown sichtbar ist
      const isVisible = window.getComputedStyle(dropdownList).display !== 'none';
      if (!isVisible && e.key !== 'ArrowDown') return;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          // Falls das Dropdown nicht sichtbar ist, zeige es an
          if (!isVisible) {
            showDropdown();
            setActiveItem(0); // Aktiviere das erste Element
          } else {
            setActiveItem(activeItemIndex + 1);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveItem(Math.max(-1, activeItemIndex - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (activeItemIndex >= 0) {
            chooseItem(activeItemIndex);
          } else if (searchInput.value.trim() !== '') {
            // Falls etwas eingegeben wurde, aber kein Item aktiviert ist
            // Erster sichtbarer Eintrag auswählen
            if (visibleItems.length > 0) {
              chooseItem(0);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          // Vollständiges Ausblenden mit !important
          dropdownList.style.cssText = 'display: none !important; visibility: hidden !important;';
          break;
      }
    });
    
    // Event-Listeners für die Suche mit verbesserter Anzeige
    searchInput.addEventListener('input', function() {
      const searchTerm = this.value.toLowerCase();
      const dropdownId = `fuzzy-list-${this.getAttribute('data-identifier')}`;
      const dropdown = document.getElementById(dropdownId);
      
      // Dropdown anzeigen (mit showDropdown-Funktion)
      showDropdown();
      
      // Erster Eintrag (Keine Übereinstimmung)
      const noMatchLi = dropdown.children[0];
      
      // Alle sichtbaren Elemente zurücksetzen
      visibleItems = [];
      
      // "Keine Übereinstimmung" filtern
      if (!noMatchLi.dataset.search.includes(searchTerm)) {
        noMatchLi.style.display = 'none';
      } else {
        noMatchLi.style.display = '';
        visibleItems.push(noMatchLi);
      }
      
      // Variable für die Sichtbarkeit der Match-Optionen
      let matchOptionsVisible = false;
      
      // Alle anderen Optionen filtern
      for (const matchOption of matchOptions) {
        const listItem = matchOption.element;
        if (!searchTerm || matchOption.searchTerms.includes(searchTerm)) {
          listItem.style.display = '';
          matchOptionsVisible = true;
          visibleItems.push(listItem);
        } else {
          listItem.style.display = 'none';
        }
      }
      
      // Keine Trennlinie mehr zu verwalten
      
      // Falls keine Ergebnisse, Info anzeigen
      if (visibleItems.length === 0 && searchTerm) {
        const noResults = document.createElement('li');
        noResults.className = 'no-results';
        noResults.textContent = 'Keine Ergebnisse gefunden';
        noResults.style.fontStyle = 'italic';
        noResults.style.color = 'var(--text-muted)';
        noResults.style.textAlign = 'center';
        noResults.style.padding = '10px';
        dropdown.appendChild(noResults);
      } else {
        // Entferne no-results falls vorhanden
        const noResultsEl = dropdown.querySelector('.no-results');
        if (noResultsEl) noResultsEl.remove();
      }
      
      // Aktives Element zurücksetzen
      activeItemIndex = -1;
    });
    
    // Hilfsfunktion zum Positionieren des Dropdowns unter dem Eingabefeld
    const positionDropdown = () => {
      const rect = searchInput.getBoundingClientRect();
      dropdownList.style.position = 'fixed';
      dropdownList.style.top = (rect.bottom + window.scrollY) + 'px';
      dropdownList.style.left = (rect.left + window.scrollX) + 'px';
      
      // Setze die Breite exakt auf die Breite des Eingabefelds
      const inputWidth = rect.width;
      dropdownList.style.width = inputWidth + 'px';
      dropdownList.style.minWidth = inputWidth + 'px';
      dropdownList.style.maxWidth = inputWidth + 'px';
    };
    
    // Hilfsfunktion zum Anzeigen des Dropdowns
    const showDropdown = () => {
      // Positioniere das Dropdown korrekt
      positionDropdown();
      
      // Hole die aktuellen Maße des Eingabefelds
      const rect = searchInput.getBoundingClientRect();
      const inputWidth = rect.width;
      
      // Mache es sichtbar mit !important Eigenschaften
      dropdownList.style.cssText = `
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: fixed !important;
        z-index: 99999 !important;
        top: ${(rect.bottom + window.scrollY)}px !important;
        left: ${(rect.left + window.scrollX)}px !important;
        width: ${inputWidth}px !important;
        min-width: ${inputWidth}px !important;
        max-width: ${inputWidth}px !important;
      `;
      
      // Force DOM Reflow für bessere Sichtbarkeit
      void dropdownList.offsetWidth;
    };
    
    // Fokus-Handler für Suchfeld
    searchInput.addEventListener('focus', function() {
      // Zeige das Dropdown an
      showDropdown();
      
      // Selektiere den gesamten Text im Input
      this.select();
    });
    
    // Wenn das Fenster oder ein Element die Größe ändert, Dropdown neu positionieren
    window.addEventListener('resize', () => {
      if (dropdownList.style.display !== 'none') {
        positionDropdown();
      }
    });
    
    // Bei jedem Klick auf das Eingabefeld das Dropdown anzeigen
    searchInput.addEventListener('click', function() {
      showDropdown();
    });
    
    // Klick außerhalb schließt die Dropdown-Liste
    document.addEventListener('click', function(e) {
      if (!combo.contains(e.target) && e.target !== dropdownList && !dropdownList.contains(e.target)) {
        dropdownList.style.display = 'none';
      }
    });
    
    matchItem.appendChild(comboContainer);
    matchList.appendChild(matchItem);
  }
  
  content.appendChild(matchList);
  dialog.appendChild(content);
  
  // Footer mit Aktionsbuttons
  const footer = document.createElement('div');
  footer.className = 'fuzzy-match-footer';
  
  // "Bestätigen" Button
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'fuzzy-match-confirm-btn';
  confirmBtn.textContent = 'Bestätigen';
  confirmBtn.addEventListener('click', () => {
    // Prüfen, ob Einträge ohne Auswahl vorhanden sind und diese als "unmatched" markieren
    for (const [identifier, { attrs }] of fuzzyMatches.entries()) {
      const searchInput = document.getElementById(`fuzzy-search-${identifier}`);
      
      // Wenn kein Wert ausgewählt wurde, als unmatched markieren
      if (!searchInput || searchInput.value === '') {
        unmatchedEntries.set(identifier, attrs);
      }
    }
    
    // Unmatched exportieren
    if (unmatchedEntries.size > 0) {
      exportUnmatchedEntries(unmatchedEntries);
    }
    
    // Bereinige alle Dropdown-Elemente, die direkt an body angehängt wurden
    document.querySelectorAll('body > .combo-list').forEach(el => {
      el.remove();
    });
    
    finalizeFuzzyMatching(newPersonAttributes, attributeTypes);
    dialogContainer.remove();
  });
  footer.appendChild(confirmBtn);
  
  dialog.appendChild(footer);
  dialogContainer.appendChild(dialog);
  document.body.appendChild(dialogContainer);
}

/**
 * Schließt den Fuzzy-Match-Prozess ab und wendet die Attribute an
 */
export function finalizeFuzzyMatching(newPersonAttributes, attributeTypes) {
  // Generiere Farben für neue Attributtypen
  const attributeNames = new Set();
  for (const [id, attrs] of newPersonAttributes.entries()) {
    for (const attrName of attrs.keys()) {
      attributeNames.add(attrName);
    }
  }
  
  // Erstelle Farben für neue Attributtypen
  for (const attrName of attributeNames) {
    if (!attributeTypes.has(attrName)) {
      // Generiere eine neue Farbe für diesen Attributtyp
      const hue = (hashCode(attrName) % 360);
      const color = `hsl(${hue}, 70%, 50%)`;
      attributeTypes.set(attrName, color);
      activeAttributes.add(attrName); // Neue Attribute standardmäßig aktivieren
    }
  }
  
  // Setze die neuen Attribute und aktualisiere
  personAttributes = newPersonAttributes;
  
  // UI aktualisieren
  buildAttributeLegend();
  updateAttributeStats();
  
  // Nur die Attribut-Kreise aktualisieren, ohne Layout-Neuberechnung
  if (currentSubgraph) updateAttributeCircles();
  
  // Benachrichtigung anzeigen
  showTemporaryNotification(`Attribute wurden erfolgreich zugeordnet und aktualisiert`);
}

/**
 * Exportiert nicht zugeordnete Einträge in eine separate Datei
 */
export function exportUnmatchedEntries(unmatchedEntries) {
  if (unmatchedEntries.size === 0) return;
  
  // Erstelle den Export-Inhalt im CSV-Format
  let exportContent = 'Identifier,Attribute,Wert\n';
  
  for (const [identifier, attrs] of unmatchedEntries.entries()) {
    for (const [attrName, attrValue] of attrs.entries()) {
      // Vermeide Komma-Probleme durch Anführungszeichen
      const safeIdentifier = `"${identifier.replace(/"/g, '""')}"`;
      const safeAttrName = `"${attrName.replace(/"/g, '""')}"`;
      const safeAttrValue = `"${String(attrValue).replace(/"/g, '""')}"`;
      
      exportContent += `${safeIdentifier},${safeAttrName},${safeAttrValue}\n`;
    }
  }
  
  // Erstelle einen Download-Link
  const blob = new Blob([exportContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `unmatched_attributes_${timestamp}.csv`;
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
  
  showTemporaryNotification(`${unmatchedEntries.size} nicht zugeordnete Einträge exportiert als ${filename}`);
}

// Zustand für OE-Sichtbarkeit (init mit true = sichtbar)
let oesVisible = true;
let savedAllowedOrgs = new Set();

// ========== Standalone-Persistenz: Drop-Handling & Reset [SF] ==========

/**
 * Verarbeitet gedroppte/gewählte Dateien: speichert sie in IndexedDB und lädt
 * neu. Enthält der Drop einen Datensatz (data/env/pseudo), wird die Seite neu
 * geladen, damit der reguläre Init-Pfad (inkl. Start-Knoten) greift. Reine
 * Attribut-Drops werden live nachgeladen, ohne die Ansicht zu verlieren.
 */
