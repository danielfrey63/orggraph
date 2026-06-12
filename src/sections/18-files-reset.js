export async function handleDroppedFiles(entryList) {
  const summary = await storeEntries(entryList);
  await requestPersistence();

  if (summary.unknown.length) {
    showTemporaryNotification(`Nicht erkannt, ignoriert: ${summary.unknown.join(', ')}`, 5000);
  }
  if (summary.missing.length) {
    showTemporaryNotification(`In env.json referenziert, aber nicht im Import enthalten: ${summary.missing.join(', ')}`, 6000);
  }
  if (summary.ignored.length) {
    showTemporaryNotification(`Nicht verwendet (env.json ist massgebend): ${summary.ignored.join(', ')}`, 5000);
  }
  if (!summary.stored.length) return;

  const kinds = new Set(summary.stored.map(s => s.kind));
  const onlyAttributes = kinds.size > 0 && [...kinds].every(k => k === 'attr');

  if (onlyAttributes) {
    // Datensatz steht bereits – Attribute inkrementell nachladen.
    for (const s of summary.stored) {
      const entry = Array.from(entryList).find(en => (en && en.file ? en.file : en)?.name === s.filename);
      const file = entry && (entry.file || entry);
      if (file) {
        try { await loadAttributesFromFile(file); } catch (e) { console.error(e); }
      }
    }
    showTemporaryNotification(`${summary.stored.length} Attribut-Datei(en) geladen und gespeichert.`, 3000);
    return;
  }

  // Datensatz/Env/Pseudo geändert → sauberer Neustart über den Init-Pfad.
  hideDropZone();
  setStatus('Daten gespeichert – lade neu …');
  location.reload();
}

/** Löscht alle lokal gespeicherten Daten und kehrt zum Leerzustand zurück. */
export async function resetAllData() {
  try { await idbClear(); } catch (e) { console.error(e); }
  location.reload();
}

window.addEventListener("DOMContentLoaded", async () => {
  // Persistenz früh anfragen und globales Drag&Drop installieren.
  requestPersistence();
  installGlobalDrop(handleDroppedFiles);

  await loadEnvConfig();

  // Pseudonymisierung initialisieren [SF]
  if (envConfig && typeof envConfig.TOOLBAR_PSEUDO_ACTIVE === 'boolean') {
    pseudonymizationEnabled = envConfig.TOOLBAR_PSEUDO_ACTIVE;
  }
  await loadPseudoData();
  const input = document.querySelector(INPUT_COMBO_ID);
  const list = document.querySelector(LIST_COMBO_ID);
  // Footer: click status to open a file dialog and load JSON dataset
  const statusEl = document.querySelector(STATUS_ID);
  if (statusEl) {
    statusEl.addEventListener('click', async () => {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'application/json,.json';
      picker.style.display = 'none';
      document.body.appendChild(picker);
      picker.addEventListener('change', async () => {
        try {
          const file = picker.files && picker.files[0];
          if (!file) return;
          const text = await file.text();
          const data = JSON.parse(text);
          applyLoadedDataObject(data, file.name);
          populateCombo("");
          try { applyFromUI('fileLoad'); } catch(_) { updateFooterStats(null); }
          // In IndexedDB persistieren, damit beim nächsten Öffnen automatisch geladen wird.
          try { await idbPut(KEY_DATA, text); await requestPersistence(); hideDropZone(); } catch(_) {}
        } catch(_) {
          setStatus('Ungültige Datei');
        } finally {
          picker.remove();
        }
      });
      picker.click();
    });
  }

  // Initialisiere Chevron-Icons im HTML
  initializeChevronIcons();
  
  // Legend-Sektionen aus ENV initialisieren [SF]
  initializeLegendCollapsedStates();
  // Unterdrücke das Browser-Kontextmenü global, wir zeigen eigene Menüs
  try { document.addEventListener('contextmenu', (e) => e.preventDefault()); } catch {}
  const applyBtn = document.querySelector(BTN_APPLY_ID);
  if (applyBtn) applyBtn.addEventListener("click", applyFromUI);
  // OE-Sichtbarkeits-Toggle
  const oeVisibilityBtn = document.getElementById('toggleOesVisibility');
  if (oeVisibilityBtn) {
    // Anfangs aktiv (OEs sichtbar)
    oesVisible = oeVisibilityBtn.classList.contains('active');
    
    oeVisibilityBtn.addEventListener('click', () => {
      // Toggle Button-Status
      oeVisibilityBtn.classList.toggle('active');
      oesVisible = oeVisibilityBtn.classList.contains('active');
      
      // Icon wechseln zwischen eye und eye-closed
      const icon = oeVisibilityBtn.querySelector('[data-icon]');
      if (icon) setIcon(icon, oesVisible ? 'eye' : 'eyeClosed');
      
      if (oesVisible) {
        // OEs einblenden - gespeicherte Auswahl wiederherstellen
        if (savedAllowedOrgs.size > 0) {
          allowedOrgs = new Set(savedAllowedOrgs);
          savedAllowedOrgs = new Set();
        }
      } else {
        // OEs ausblenden - aktuelle Auswahl speichern
        savedAllowedOrgs = new Set(allowedOrgs);
        allowedOrgs = new Set();
      }
      
      // NUR den Graph aktualisieren ohne UI-Elemente zu beeinflussen
      refreshClusters();
      
      // Simulation neu anstoßen, damit sich Kräfte ausbalancieren
      if (currentSimulation) currentSimulation.alpha(0.1).restart();
    });
  }
  
  // Globaler Toggle für temporäre Sichtbarkeit aller Hidden-Subtrees [SF]
  const toggleAllHiddenBtn = document.getElementById('toggleAllHiddenVisibility');
  if (toggleAllHiddenBtn) {
    toggleAllHiddenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAllHiddenVisibility();
    });
    // Initial verstecken wenn keine Hidden-Einträge
    updateGlobalHiddenVisibilityButton();
  }
  
  // Alle Attribut-Kategorien expandieren/kollabieren (Toggle)
  const expandAllAttributesBtn = document.getElementById('expandAllAttributes');
  if (expandAllAttributesBtn) {
    expandAllAttributesBtn.addEventListener('click', () => {
      const attributeContainer = document.getElementById('attributeContainer');
      const chevron = document.querySelector('[data-target="attributeContainer"]');
      const attributeLegend = document.getElementById('attributeLegend');
      
      // Prüfe ob aktuell alle Kategorien expandiert sind
      const allCategories = Array.from(attributeTypes.keys()).map(k => k.split('::')[0]).filter((v, i, a) => a.indexOf(v) === i);
      const allExpanded = allCategories.every(cat => !collapsedCategories.has(cat));
      
      if (allExpanded) {
        // KOLLABIEREN: Alle Kategorien kollabieren
        allCategories.forEach(cat => collapsedCategories.add(cat));
        
        // Legende neu aufbauen
        buildAttributeLegend();
        
        setTimeout(() => {
          if (attributeLegend) {
            // Alle Listen ausblenden
            const allLists = attributeLegend.querySelectorAll('ul ul');
            allLists.forEach(ul => {
              ul.style.display = 'none';
            });
            
            // Alle Chevrons auf collapsed setzen
            const categoryChevrons = attributeLegend.querySelectorAll('.legend-tree-chevron');
            categoryChevrons.forEach(chev => {
              chev.classList.remove('expanded');
              chev.classList.add('collapsed');
            });
          }
        }, 50);
      } else {
        // EXPANDIEREN: Alle Kategorien expandieren
        // 1. Legende selbst expandieren (falls kollabiert)
        if (attributeContainer && chevron) {
          attributeContainer.classList.remove('collapsed');
          chevron.classList.remove('collapsed');
          chevron.classList.add('expanded');
        }
        
        // 2. Alle Kategorien aus collapsedCategories entfernen
        collapsedCategories.clear();
        
        // 3. Legende neu aufbauen
        buildAttributeLegend();
        
        // 4. Alle Listen und Items einblenden
        setTimeout(() => {
          if (attributeLegend) {
            const allLists = attributeLegend.querySelectorAll('ul');
            allLists.forEach(ul => {
              ul.style.display = 'block';
            });
            
            const categoryChevrons = attributeLegend.querySelectorAll('.legend-tree-chevron');
            categoryChevrons.forEach(chev => {
              chev.classList.remove('collapsed');
              chev.classList.add('expanded');
            });
          }
        }, 50);
      }
    });
  }
  
  // Attribute-Sichtbarkeit-Toggle (nur Graph-Sichtbarkeit, keine Selektion ändern)
  const attributesVisibilityBtn = document.getElementById('toggleAttributesVisibility');
  if (attributesVisibilityBtn) {
    // Anfangszustand aus ENV lesen (LEGEND_ATTRIBUTES_ACTIVE)
    const envAttrVisible = (envConfig && envConfig.LEGEND_ATTRIBUTES_ACTIVE != null)
      ? envConfig.LEGEND_ATTRIBUTES_ACTIVE
      : null;

    if (envAttrVisible != null) {
      attributesVisible = !!envAttrVisible;
      if (!attributesVisible) attributesVisibilityBtn.classList.remove('active');
    } else {
      attributesVisible = attributesVisibilityBtn.classList.contains('active');
    }

    // Icon initial korrekt setzen (eye vs. eye-closed)
    const initialIcon = attributesVisibilityBtn.querySelector('[data-icon]');
    if (initialIcon) setIcon(initialIcon, attributesVisible ? 'eye' : 'eyeClosed');
    
    attributesVisibilityBtn.addEventListener('click', (e) => {
      // Stop bubbling to the section header: setIcon replaces the clicked SVG,
      // so the header's data-ignore-header-click check cannot find the button
      // anymore via the detached e.target and would toggle the collapse state
      e.stopPropagation();

      if (e.shiftKey) {
        // Shift+Click: toggle the visibility of every category,
        // leaving the global visibility state untouched
        const cats = new Set(Array.from(attributeTypes.keys()).map(k => String(k).split('::')[0]));
        for (const c of emptyCategories) cats.add(c);
        if (hiddenCategories.size > 0) {
          hiddenCategories.clear();
          showTemporaryNotification('Alle Attribut-Kategorien eingeblendet');
        } else {
          cats.forEach(c => hiddenCategories.add(c));
          showTemporaryNotification('Alle Attribut-Kategorien ausgeblendet');
        }
        buildAttributeLegend();
        updateAttributeCircles();
        return;
      }

      // Toggle Button-Status
      attributesVisibilityBtn.classList.toggle('active');
      attributesVisible = attributesVisibilityBtn.classList.contains('active');
      
      // Icon wechseln zwischen eye und eye-closed
      const icon = attributesVisibilityBtn.querySelector('[data-icon]');
      if (icon) setIcon(icon, attributesVisible ? 'eye' : 'eyeClosed');
      
      // NUR die Graph-Sichtbarkeit steuern, KEINE Änderung an:
      // - activeAttributes (bleiben wie sie sind)
      // - hiddenCategories (bleiben wie sie sind)
      // - Legende (bleibt wie sie ist)
      
      // Nur Attribut-Kreise im Graph aktualisieren
      updateAttributeCircles();
      
      // Simulation kurz reaktivieren um Links neu zu positionieren [SF]
      if (currentSimulation) {
        currentSimulation.alpha(0.1).restart();
        // Nach kurzer Zeit wieder stoppen
        setTimeout(() => {
          if (currentSimulation) currentSimulation.alpha(0);
        }, 100);
      }
    });
  }
  
  // Toggle-All für OEs
  const toggleAllOesBtn = document.getElementById('toggleAllOes');
  if (toggleAllOesBtn) {
    toggleAllOesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Prüfe ob mindestens eine OE ausgewählt ist
      const hasAnySelected = allowedOrgs.size > 0;
      
      if (hasAnySelected) {
        // Mindestens eine OE ist ausgewählt -> Alle abwählen
        allowedOrgs.clear();
        showTemporaryNotification('Alle OEs abgewählt');
      } else {
        // Keine OE ist ausgewählt -> Alle auswählen
        raw.orgs.forEach(o => {
          if (o && o.id) allowedOrgs.add(String(o.id));
        });
        showTemporaryNotification('Alle OEs ausgewählt');
      }
      
      // Graph und Legende aktualisieren
      syncGraphAndLegendColors();
    });
  }
  
  // Toggle-All für Attribute
  const toggleAllAttributesBtn = document.getElementById('toggleAllAttributes');
  if (toggleAllAttributesBtn) {
    toggleAllAttributesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Prüfe ob mindestens ein Attribut ausgewählt ist
      const hasAnySelected = activeAttributes.size > 0;
      
      if (hasAnySelected) {
        // Mindestens ein Attribut ist ausgewählt -> Alle abwählen
        activeAttributes.clear();
        showTemporaryNotification('Alle Attribute abgewählt');
      } else {
        // Kein Attribut ist ausgewählt -> Alle auswählen
        attributeTypes.forEach((color, key) => {
          activeAttributes.add(key);
        });
        showTemporaryNotification('Alle Attribute ausgewählt');
      }
      
      // Legende und Graph aktualisieren
      buildAttributeLegend();
      updateAttributeCircles();
      updateAttributeStats();
    });
  }
  
  // OE-Filter initialisieren
  const oeFilter = document.getElementById('oeFilter');
  if (oeFilter) {
    oeFilter.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      const legend = document.querySelector('#legend');
      if (!legend) return;
      
      const items = legend.querySelectorAll('.legend-list li');
      let anyVisible = false;
      
      items.forEach(li => {
        const chip = li.querySelector('.legend-label-chip');
        const label = chip?.textContent?.toLowerCase() || '';
        const match = label.includes(term);
        
        // Setze Sichtbarkeit basierend auf Filter
        li.style.display = term === '' || match ? '' : 'none';
        
        // Merke, ob mindestens ein Element sichtbar ist
        if (li.style.display !== 'none') {
          anyVisible = true;
        }
        
        // Wenn der übergeordnete Knoten sichtbar ist, mache alle Kinder sichtbar
        if (match && term !== '') {
          // Mache alle Eltern-ULs sichtbar
          let parent = li.parentElement;
          while (parent) {
            if (parent.tagName === 'UL') {
              parent.style.display = '';
              const parentLi = parent.parentElement;
              if (parentLi && parentLi.tagName === 'LI') {
                parentLi.style.display = '';
              }
            }
            parent = parent.parentElement;
          }
          
          // Mache alle Kind-ULs sichtbar und expandiere sie
          const childUl = li.querySelector('ul');
          if (childUl) {
            childUl.style.display = '';
            const twisty = li.querySelector('.twisty');
            if (twisty && twisty.textContent === '▸') {
              twisty.textContent = '▾';
            }
          }
        }
      });
      
      // Zeige Meldung, wenn keine Treffer
      let noMatchesMsg = legend.querySelector('.no-matches-message');
      if (!anyVisible && term !== '') {
        if (!noMatchesMsg) {
          noMatchesMsg = document.createElement('div');
          noMatchesMsg.className = 'no-matches-message';
          noMatchesMsg.textContent = 'Keine OEs gefunden';
          legend.appendChild(noMatchesMsg);
        }
      } else if (noMatchesMsg) {
        noMatchesMsg.remove();
      }
    });
  }
  
  const mgmt = document.querySelector('#toggleManagement');
  if (mgmt) {
    // Management-Modus aus ENV lesen (TOOLBAR_MANAGEMENT_ACTIVE)
    const envMgmtOnly = (envConfig && envConfig.TOOLBAR_MANAGEMENT_ACTIVE != null)
      ? envConfig.TOOLBAR_MANAGEMENT_ACTIVE
      : null;

    if (envMgmtOnly != null) {
      managementEnabled = !!envMgmtOnly;
      if (!managementEnabled) mgmt.classList.remove('active');
    } else {
      managementEnabled = mgmt.classList.contains('active');
    }
    mgmt.addEventListener('click', () => {
      mgmt.classList.toggle('active');
      managementEnabled = mgmt.classList.contains('active');
      applyFromUI('toggleManagement');
    });
  }
  // Auto-fit functionality has been removed
  
  function updateLinkLabelVisibility() {
    const display = (debugMode && labelsVisible !== 'none') ? 'block' : 'none';
    d3.select('#graph').selectAll('.link-label')
      .style('display', display);
  }
  
  /**
   * Aktualisiert die Label-Sichtbarkeit im SVG basierend auf dem aktuellen Modus [SF]
   */
  function updateLabelVisibility() {
    const svg = document.querySelector('#graph');
    if (!svg) return;
    
    // CSS-Klassen für Label-Sichtbarkeit setzen
    svg.classList.remove('labels-hidden', 'labels-attributes-only');
    if (labelsVisible === 'none') {
      svg.classList.add('labels-hidden');
    } else if (labelsVisible === 'attributes') {
      svg.classList.add('labels-attributes-only');
    }
    
    // Link-Labels aktualisieren
    updateLinkLabelVisibility();
  }
  
  /**
   * Aktualisiert das Icon des Label-Toggle-Buttons basierend auf dem Zustand [SF]
   */
  function updateLabelToggleIcon(btn) {
    const icon = btn.querySelector('[data-icon]');
    if (!icon) return;

    // Icon + Button-Zustand basierend auf labelsVisible setzen
    switch (labelsVisible) {
      case 'all':
        setIcon(icon, 'tag');
        btn.classList.add('active');
        btn.title = 'Alle Labels anzeigen';
        break;
      case 'attributes':
        setIcon(icon, 'property');
        btn.classList.add('active');
        btn.title = 'Nur Attribut-Labels anzeigen';
        break;
      case 'none':
        setIcon(icon, 'eyeClosed');
        btn.classList.remove('active');
        btn.title = 'Labels ausgeblendet';
        break;
    }
  }

  const lbls = document.querySelector('#toggleLabels');
  if (lbls) {
    // Label-Sichtbarkeit aus ENV lesen (TOOLBAR_LABELS_ACTIVE)
    const envLabelsVisible = (envConfig && envConfig.TOOLBAR_LABELS_ACTIVE != null)
      ? envConfig.TOOLBAR_LABELS_ACTIVE
      : null;

    if (envLabelsVisible != null) {
      // ENV-Wert kann boolean oder string sein
      if (typeof envLabelsVisible === 'string') {
        labelsVisible = ['all', 'attributes', 'none'].includes(envLabelsVisible) ? envLabelsVisible : 'all';
      } else {
        labelsVisible = envLabelsVisible ? 'all' : 'none';
      }
    } else {
      labelsVisible = lbls.classList.contains('active') ? 'all' : 'none';
    }
    
    // Initiales Icon setzen
    updateLabelToggleIcon(lbls);
    
    lbls.addEventListener('click', () => {
      // Prüfe ob Attribute aktiv sind (für 3-Zustand-Toggle)
      const hasActiveAttributes = attributesVisible && activeAttributes.size > 0;
      
      // Zykliere durch die Zustände
      if (hasActiveAttributes) {
        // 3 Zustände: all -> attributes -> none -> all
        switch (labelsVisible) {
          case 'all': labelsVisible = 'attributes'; break;
          case 'attributes': labelsVisible = 'none'; break;
          case 'none': labelsVisible = 'all'; break;
        }
      } else {
        // 2 Zustände: all -> none -> all (kein 'attributes' Zustand ohne aktive Attribute)
        labelsVisible = (labelsVisible === 'none') ? 'all' : 'none';
      }
      
      // UI aktualisieren
      updateLabelToggleIcon(lbls);
      updateLabelVisibility();
      
      Logger.log('[Labels] Mode changed to:', labelsVisible);
    });
  }
  if (input && list) {
    input.addEventListener('input', () => {
      currentSelectedId = null;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => populateCombo(input.value), 150);
    });
    
    input.addEventListener('keydown', (e) => {
      const max = filteredItems.length - 1;
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); setActive(Math.min(max, activeIndex + 1)); break;
        case 'ArrowUp': e.preventDefault(); setActive(Math.max(-1, activeIndex - 1)); break;
        case 'Enter': {
          const addMode = !!(e.shiftKey);
          // Wenn kein aktives Element, wähle den ersten Treffer automatisch
          const idx = activeIndex >= 0 ? activeIndex : (filteredItems.length > 0 ? 0 : -1);
          Logger.log('[ui] key Enter', { addMode, activeIndex, chosenIdx: idx, items: filteredItems.length });
          if (idx >= 0) chooseItem(idx, addMode);
          applyFromUI('keyEnter');
          break;
        }
        case 'Escape': list.hidden = true; break;
      }
    });
    
    input.addEventListener('change', () => applyFromUI('inputChange'));
    input.addEventListener('focus', () => { if (filteredItems.length) list.hidden = false; });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 0));
  }
  const fitBtn = document.querySelector('#fit');
  if (fitBtn) {
    fitBtn.addEventListener('click', fitToViewport);
  }
  
  // Toggle für kontinuierliche Simulation [SF]
  const simToggleBtn = document.querySelector('#toggleSimulation');
  if (simToggleBtn) {
    // Anfangszustand aus ENV lesen
    if (envConfig && typeof envConfig.TOOLBAR_SIMULATION_ACTIVE === 'boolean') {
      continuousSimulation = envConfig.TOOLBAR_SIMULATION_ACTIVE;
      if (continuousSimulation) {
        simToggleBtn.classList.add('active');
      } else {
        simToggleBtn.classList.remove('active');
      }
    }
    
    simToggleBtn.addEventListener('click', () => {
      simToggleBtn.classList.toggle('active');
      continuousSimulation = simToggleBtn.classList.contains('active');
      
      if (continuousSimulation && currentSimulation) {
        // Simulation dauerhaft am Laufen halten
        keepSimulationRunning();
      }
      
      Logger.log(`[Simulation] Continuous mode: ${continuousSimulation}`);
    });
  }
  
  // Toggle für Pseudonymisierung [SF]
  const pseudoBtn = document.querySelector('#togglePseudonymization');
  if (pseudoBtn) {
    // Synchronisiere Button-Status mit dem geladenen pseudonymizationEnabled
    if (pseudonymizationEnabled) {
      pseudoBtn.classList.add('active');
    } else {
      pseudoBtn.classList.remove('active');
    }
    
    pseudoBtn.addEventListener('click', () => {
      const wasEnabled = pseudonymizationEnabled;
      const willEnable = !wasEnabled;
      
      // Passwort-Schutz beim De-Pseudonymisieren [SF][SFT]
      if (!willEnable && envConfig?.TOOLBAR_PSEUDO_PASSWORD) {
        showPasswordDialog((password) => {
          if (password === envConfig.TOOLBAR_PSEUDO_PASSWORD) {
            // Passwort korrekt - De-Pseudonymisierung durchführen
            pseudoBtn.classList.remove('active');
            pseudonymizationEnabled = false;
            refreshAllLabels();
            showTemporaryNotification('Pseudonymisierung deaktiviert');
            Logger.log('[Pseudo] Pseudonymisierung deaktiviert');
          }
          // Bei falschem Passwort zeigt der Dialog selbst den Fehler
        });
        return; // Warten auf Dialog-Callback
      }
      
      pseudoBtn.classList.toggle('active');
      pseudonymizationEnabled = pseudoBtn.classList.contains('active');
      
      // Alle Labels aktualisieren
      refreshAllLabels();
      
      const status = pseudonymizationEnabled ? 'aktiviert' : 'deaktiviert';
      showTemporaryNotification(`Pseudonymisierung ${status}`);
      Logger.log(`[Pseudo] Pseudonymisierung ${status}`);
    });
  }
  
  const debugBtn = document.querySelector('#debugBtn');
  if (debugBtn) {
    // Synchronisiere Button-Status mit dem bereits geladenen debugMode (aus loadEnvConfig)
    if (debugMode) {
      debugBtn.classList.add('active');
    }
    
    debugBtn.addEventListener('click', () => {
      debugBtn.classList.toggle('active');
      debugMode = debugBtn.classList.contains('active');
      Logger.log(`[Debug] Debug mode toggled to: ${debugMode}`);
      
      // Aktualisiere Labels und Link-Labels sofort [SF]
      const svg = d3.select('#graph');
      
      // Node-Labels aktualisieren
      svg.selectAll('.node text.label').text(d => {
        return debugMode 
          ? `(${Math.round(d.x || 0)}, ${Math.round(d.y || 0)})`
          : getDisplayLabel(d);
      });
      
      // Link-Labels ein/ausblenden (nur wenn auch Labels sichtbar)
      updateLinkLabelVisibility();
      
      // Zoom-Info im Debug-Modus anzeigen [SF]
      updateDebugZoomDisplay();
    });
  }
  // Auto-apply on depth change and direction change
  const depthEl = document.querySelector(INPUT_DEPTH_ID);
  if (depthEl) {
    if (envConfig?.TOOLBAR_DEPTH_DEFAULT != null) {
      depthEl.value = envConfig.TOOLBAR_DEPTH_DEFAULT;
    }
    depthEl.addEventListener('change', applyFromUI);
    depthEl.addEventListener('input', applyFromUI);
  }
  // Direction Split Component
  const upHalf = document.querySelector('#directionToggle .direction-up');
  const downHalf = document.querySelector('#directionToggle .direction-down');
  let currentDir = 'both';
  
  // Helper function to get current direction state
  const getCurrentDirection = () => {
    if (!upHalf || !downHalf) return 'both';
    const upActive = upHalf.classList.contains('active');
    const downActive = downHalf.classList.contains('active');
    if (upActive && downActive) return 'both';
    if (upActive) return 'up';
    if (downActive) return 'down';
    return 'both';
  };
  
  // Initialize direction from config
  if (envConfig?.TOOLBAR_DIRECTION_DEFAULT) {
    currentDir = envConfig.TOOLBAR_DIRECTION_DEFAULT;
    if (upHalf && downHalf) {
      if (currentDir === 'both') {
        upHalf.classList.add('active');
        downHalf.classList.add('active');
      } else if (currentDir === 'up') {
        upHalf.classList.add('active');
        downHalf.classList.remove('active');
      } else if (currentDir === 'down') {
        upHalf.classList.remove('active');
        downHalf.classList.add('active');
      }
    }
  }
  
  // Direction half click handlers with constraint: at least one must be active
  if (upHalf && downHalf) {
    upHalf.addEventListener('click', () => {
      const upActive = upHalf.classList.contains('active');
      const downActive = downHalf.classList.contains('active');
      
      if (upActive && !downActive) {
        // Only up active - switch to only down
        upHalf.classList.remove('active');
        downHalf.classList.add('active');
      } else if (upActive && downActive) {
        // Both active - deactivate up
        upHalf.classList.remove('active');
      } else {
        // Up inactive - activate it
        upHalf.classList.add('active');
      }
      
      currentDir = getCurrentDirection();
      applyFromUI('directionUp');
    });
    
    downHalf.addEventListener('click', () => {
      const upActive = upHalf.classList.contains('active');
      const downActive = downHalf.classList.contains('active');
      
      if (downActive && !upActive) {
        // Only down active - switch to only up
        downHalf.classList.remove('active');
        upHalf.classList.add('active');
      } else if (upActive && downActive) {
        // Both active - deactivate down
        downHalf.classList.remove('active');
      } else {
        // Down inactive - activate it
        downHalf.classList.add('active');
      }
      
      currentDir = getCurrentDirection();
      applyFromUI('directionDown');
    });
  }
  
  // Hierarchy toggle button
  const hier = document.querySelector('#toggleHierarchy');
  if (hier) {
    // Layout-Modus aus ENV lesen (TOOLBAR_HIERARCHY_ACTIVE)
    const envHierLayout = (envConfig && envConfig.TOOLBAR_HIERARCHY_ACTIVE != null)
      ? envConfig.TOOLBAR_HIERARCHY_ACTIVE
      : null;

    if (envHierLayout != null) {
      const hierEnabled = !!envHierLayout;
      if (!hierEnabled) hier.classList.remove('active');
      currentLayoutMode = hierEnabled ? 'hierarchy' : 'force';
    } else {
      currentLayoutMode = hier.classList.contains('active') ? 'hierarchy' : 'force';
    }
    
    hier.addEventListener('click', () => {
      hier.classList.toggle('active');
      currentLayoutMode = hier.classList.contains('active') ? 'hierarchy' : 'force';
      if (currentSimulation) switchLayout(currentLayoutMode, currentSimulation);
    });
  }

  // Attribute-Funktionalität einbinden
  const loadAttrBtn = document.getElementById('loadAttributes');
  const attrFileInput = document.getElementById('attributeFileInput');
  if (loadAttrBtn && attrFileInput) {
    // Klick auf Button löst File-Dialog aus
    loadAttrBtn.addEventListener('click', (e) => {
      // Verhindere Bubbling zum Header, damit dieser nicht kollabiert wird
      e.preventDefault();
      e.stopPropagation();
      attrFileInput.click();
    });
    
    // Datei-Input-Änderung verarbeiten
    attrFileInput.addEventListener('change', async () => {
      if (attrFileInput.files && attrFileInput.files[0]) {
        const file = attrFileInput.files[0];
        await loadAttributesFromFile(file);
        // In IndexedDB persistieren (Inhalt + Originalname für Kategorie-Ableitung).
        try {
          const text = await file.text();
          await idbPut(ATTR_PREFIX + file.name, text);
          await idbPut(ATTR_PREFIX + file.name + '::name', file.name);
          await requestPersistence();
        } catch (_) {}
        attrFileInput.value = ''; // Reset für wiederholtes Laden
      }
    });
    
    // Initialen leeren Attribut-Legend erzeugen
    buildAttributeLegend();
    updateAttributeStats();
  }
  
  // Kollabierbare Legenden einrichten
  initializeCollapsibleLegends();

  // Lade Daten erst nachdem ENV vollständig verarbeitet wurde [SF][REH]
  if (await loadData()) {
    hideDropZone();
    // Apply initial start node(s) from env.json if provided
    let initialUpdateTriggered = false;
    if (envConfig && envConfig.GRAPH_START_ID_DEFAULT != null) {
    const def = envConfig.GRAPH_START_ID_DEFAULT;
    if (Array.isArray(def)) {
      const requested = def.map(v => String(v));
      const roots = requested.filter(id => byId.has(id));
      const invalid = requested.filter(id => !byId.has(id));
      if (roots.length > 0) {
        selectedRootIds = roots.slice();
        currentSelectedId = roots[0];
        lastSingleRootId = roots[0];
        initialUpdateTriggered = true;
        
        // Nach Initial-Apply das Suchfeld leeren und Dropdown schließen
        if (input && list) {
          input.value = "";
          list.innerHTML = "";
          list.hidden = true;
        }
      }
      if (invalid.length > 0) {
        // Zeige Info über ungültige IDs
        showTemporaryNotification(`Ungültige GRAPH_START_ID_DEFAULT Einträge ignoriert: ${invalid.join(', ')}`);
      }
    } else {
      const sid = String(def);
      const startNode = byId.get(sid);
      if (startNode) {
        currentSelectedId = String(startNode.id);
        lastSingleRootId = String(startNode.id);
        initialUpdateTriggered = true;
        
        // Nach Initial-Apply das Suchfeld leeren und Dropdown schließen
        if (input && list) {
          input.value = "";
          list.innerHTML = "";
          list.hidden = true;
        }
      } else {
        showTemporaryNotification(`GRAPH_START_ID_DEFAULT nicht gefunden: ${sid}`);
      }
    }
  }
  // Apply default hidden roots from env
  if (Array.isArray(envConfig?.LEGEND_HIDDEN_ROOTS_DEFAULT) && envConfig.LEGEND_HIDDEN_ROOTS_DEFAULT.length > 0) {
    hiddenByRoot = new Map();
    for (const ridRaw of envConfig.LEGEND_HIDDEN_ROOTS_DEFAULT) {
      const rid = String(ridRaw);
      if (byId.has(rid)) hiddenByRoot.set(rid, collectReportSubtree(rid));
    }
    recomputeHiddenNodes();
    buildHiddenLegend();
    // Wir triggern hier nicht, sondern setzen initialUpdateTriggered wenn nötig
    // Da Hidden-State das Rendering beeinflusst, sollten wir updaten
    // Aber wenn wir schon für Start-ID updaten, reicht einer.
    if (!initialUpdateTriggered) {
         // Falls KEINE Start-ID gesetzt war, aber Hidden-Roots, müssen wir theoretisch updaten
         // Aber ohne Start-ID rendert eh nichts (außer leere Leinwand).
         // Also reicht es, wenn der Aufruf am Ende kommt.
    }
  }

    // Einmaliger initialer Update-Aufruf, falls Parameter gesetzt wurden
    if (initialUpdateTriggered) {
        try { applyFromUI('initialLoad'); } catch(_) {}
    } else {
        renderFullView(envConfig?.DATA_URL || '(geladen)');
    }
  } else {
    // Keine Daten vorhanden → Drop-Zone zum Laden einblenden.
    showDropZone(handleDroppedFiles);
  }

  // hideSubtree-Button wurde aus der Toolbar entfernt
  // Die hideSubtreeFromRoot-Funktion bleibt für das Kontextmenü erhalten
  buildHiddenLegend();
  
  // Initialisiere Export-Funktionalität
  if (typeof initializeExport === 'function') {
    initializeExport();
  }

  // Reset-Schaltfläche für lokal gespeicherte Daten (Footer).
  const footerStats = document.querySelector('.footer-stats');
  if (footerStats && !document.getElementById('resetData')) {
    const sep = document.createElement('span');
    sep.className = 'stat-separator';
    sep.textContent = '|';
    const resetBtn = document.createElement('button');
    resetBtn.id = 'resetData';
    resetBtn.className = 'footer-reset-btn';
    resetBtn.type = 'button';
    resetBtn.title = 'Lokal gespeicherte Daten löschen und zurücksetzen';
    resetBtn.textContent = 'Daten zurücksetzen';
    resetBtn.addEventListener('click', () => { resetAllData(); });
    footerStats.appendChild(sep);
    footerStats.appendChild(resetBtn);
  }
});

