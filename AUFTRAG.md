# Auftrag: OrgGraph bereinigen, modularisieren, testbar machen

## Kontext & Ausgangslage
- Repo: `orggraph` — eine D3-basierte Org-Graph-Visualisierung als Single-Page-App.
- Aktueller Stand: **alles in `index.html`** (618 KB / 9.909 Zeilen): CSS (Z. 8–1934), D3 v7 inline (Z. 2141–2143), die gesamte App-Logik in **einem** `<script>`-Block (Z. 2144–9907, ~7.760 Zeilen, ~120+ Funktionen im globalen Scope).
- **Keine Tests** vorhanden. Kein Build (Vite wurde bewusst entfernt).
- Repo verschmutzt durch ~370 MB regenerierbare Artefakte und fremde AI-Tool-Verzeichnisse (alle untracked/gitignored).

## Hartes Zielbild (nicht verhandelbar)
1. **Auslieferung = eine einzige, doppelklickbare `index.html`**, offline lauffähig über `file://`, ohne Server, ohne Runtime-Dependencies. Funktional **identisch** zur heutigen App.
2. **Quellcode = mehrere kleine ES-Module** unter `src/`, saubere Trennung von reiner Logik und DOM/D3/IndexedDB-Seiteneffekten, **ohne Doppelspurigkeiten**, mit **minimaler, nur wo nötig** eingeführter Abstraktion.
3. **Trivialer Inline-Build**: ein kleines Node-Skript (`build.js`, ohne Bundler-Framework), das die Module + CSS + D3 in die ausgelieferte `index.html` inlined. Idempotent, beliebig oft ausführbar.
4. **Tests mit >80 % Code-Coverage über den GESAMTEN App-Code** (alle Sektionen unter `src/sections/`, siehe Architekturprinzip 4 — nachgeschärft), im Editor als **Gutter** sichtbar (VS Code), auch in der gebauten `index.html`.

## Architekturprinzipien (verbindlich)
1. **Kein TypeScript, kein JSDoc.** Reines, schlichtes ES-Modul-JS. Keine Typ-Annotationen, keine Doc-Comments — maximale Einfachheit.
2. **Build & Laufzeit = null Dependencies.** `build.js` nutzt ausschliesslich Node-Builtins (`node:fs`, `node:path`) und läuft via `node build.js` **ohne `npm install`**. Die ausgelieferte `index.html` hat keine Runtime-Dependencies (D3 inlined). Vitest/jsdom/coverage sind reine `devDependencies` und berühren weder Build noch Auslieferung.
3. **Keine Entscheidung an der DOM/D3-Grenze.** Jedes `if`, jede Berechnung, jede Logik-Schleife gehört in eine *reine* Funktion, die fertige Daten/ViewModels zurückgibt. Die DOM/D3-Schicht *appliziert* diese Daten nur mechanisch auf Elemente (`el.attr('fill', d.fill)`), ohne eigene Verzweigung. Der Hebel ist nicht *wenig* Grenzcode, sondern *entscheidungsfreier* Grenzcode — so wird die untestbare Schicht per Augenschein korrekt.
4. **Coverage misst das ganze System — ehrlich.** (Nachgeschärft am 2026-06-11 nach User-Review: der ursprüngliche Grenzschicht-Ausschluss verdeckte 2/3 des App-Codes und war Augenwischerei.) Die ≥ 80 % gelten **brutto über alle Sektionen** unter `src/sections/`. DOM-lastige Sektionen werden per **jsdom getestet**, nicht ausgeschlossen. Ausnahmen (`coverage.exclude` oder `/* v8 ignore */`-Marker) sind nur zulässig für Code, der **nachweislich entscheidungsfrei** ist oder in jsdom prinzipiell nicht ausführbar (z. B. echtes Canvas-Rendering) — jede Ausnahme wird einzeln in `FORTSCHRITT.md` begründet, und in den Berichten wird **immer auch die Brutto-Zahl ohne jegliche Ausnahmen** ausgewiesen. Bestehende Marker um logiktragende Funktionen werden zurückgebaut und die Funktionen getestet.
   **Vorgehensregel:** Das Coverage-Gate (`thresholds.lines: 80`) bleibt in jedem Commit grün — pro Iteration wird eine Sektion erst getestet und dann aus `coverage.exclude` entfernt, nie umgekehrt.
5. **Minimale Naht, kein Framework.** Die DOM-Grenze ist die kleinste nötige Naht, **keine** Abstraktionsebene. Kein generischer DOM-Wrapper, kein Mini-Framework, keine „schöne" Fassade — das wäre genau die unnötige Abstraktion, die vermieden werden soll.

## Architektur-Zielstruktur (Richtwert, vom ausführenden Modell zu verfeinern)
```
src/
  main.js          # Bootstrap/Verdrahtung (dünn)
  graph.js         # reine Logik: buildAdjacency, computeSubgraph, getNodesLevels, processData, idOf
  data.js          # Laden/Klassifizieren: classifyFile, loadData, looksLike*, applyLoadedDataObject
  storage.js       # IndexedDB-Kapsel: openDb, idbGet/Put/Delete/Keys/Clear, storeFiles, getStored*
  labels.js        # getDisplayLabel, getDisplayOrgLabel, pseudo-Logik, refreshAllLabels
  attributes.js    # Attribut-Parsing/-Statistik, Kategorie-/Farb-Mathematik (rein wo möglich)
  color.js         # hashCode, colorForOrg, orgDepth, quantizedHueFromCategory, colorToTransparent (rein)
  geometry.js      # clustersAtPoint, computeClusterPolygon, positionNodesInCircle, radialLayout… (rein)
  render.js        # D3-Rendering, createSimulation, renderFullView (Seiteneffekte)
  legend.js        # Legend-Aufbau/-Interaktion (DOM)
  menus.js         # Node-/Legend-Kontextmenüs (DOM)
  export.js        # SVG/PNG-Export (DOM/Canvas)
  icons.js         # ICON-Registry, setIcon, hydrateIcons
  ui.js            # Combobox, Status, Notifications, Drop-Zone, Dialoge
  config.js        # Konstanten (SVG_ID, WIDTH, DB_NAME, …), env-Defaults
index.template.html  # HTML-Gerüst + CSS + <script src>-Platzhalter
build.js             # inlined Module+CSS+D3 → dist-fähige index.html
vendor/d3.v7.min.js  # ausgelagertes D3 (wird beim Build inlined)
tests/               # *.test.js, gespiegelt zur src-Struktur
```
**Priorität bei der Aufteilung:** reine Logik (`graph`, `color`, `geometry`, Teile von `attributes`/`data`/`labels`) zuerst herauslösen — das ist der Coverage-Hebel.

## Test- & Coverage-Strategie
- **Framework: Vitest** + **jsdom** (DOM-Simulation) + **fake-indexeddb** (Storage-Tests) + **@vitest/coverage-v8**.
- **Schwerpunkt** der Tests zuerst auf den reinen Logik-Modulen (erledigt), danach **DOM-Sektionen via jsdom**: Legenden-/Menü-/Dialog-Aufbau, Icons, Drop-Zone, Datei-Handling — geprüft wird erzeugte DOM-Struktur und Verhalten, nicht Pixel.
- **Keine pauschalen Ausschlüsse** (siehe Architekturprinzip 4 — nachgeschärft): `coverage.exclude` wird schrittweise geleert; verbleibende Ausnahmen einzeln begründet (Kandidaten: D3-Force-Simulation-Ticks, Canvas/PNG-Export-Pfade).
- **Coverage-Konfiguration** so, dass `coverage/lcov.info` erzeugt wird (Voraussetzung für Editor-Gutters via VS-Code-Extension „Coverage Gutters").
- `package.json`-Scripts: `test`, `test:coverage`, `build`. Coverage-Gate ≥ 80 % (lines) in der Vitest-Config verankern.

## Cleanup (vor der Restrukturierung)
- **Löschen (untracked, regenerierbar):** `dist`, `coverage`, `coverage-report`, `monocart-report`, `playwright-report`, `test-results`, `temp`.
- **Löschen (fremde AI-Tool-Reste):** `.kluster`, `.kilocode`, `.auto-claude`, `.automaker`, `.trae`, `.windsurf`, `.fallow`.
- **Untersuchen, nicht blind löschen:** `browser`, `assets`, `attributes`, `helpers` (Letzteres ist via `package.json` → `transform`-Script referenziert). Erst Relevanz prüfen, dann entscheiden.
- **`node_modules`** sauber gemäss finaler `package.json` neu aufsetzen.
- **`.gitignore`** an die neue Struktur anpassen (`src/` tracked, `dist/`+`coverage/` ignoriert).
- **Behalten:** `.vscode`, `.githooks`, `data/*.example.*`, `README.md`.
- Regel: Nichts ausserhalb von `.gitignore` Stehendes ohne Rückfrage entfernen.

## Vorgehen in Phasen (jede Phase einzeln committen)
1. **Cleanup** der Artefakt-/Tool-Verzeichnisse, `.gitignore` aktualisieren.
2. **Baseline sichern:** aktuelle `index.html` als Referenz (z. B. `reference/index.baseline.html`), damit funktionale Gleichheit prüfbar bleibt.
3. **Extraktion:** CSS → eigene Datei, D3 → `vendor/`, App-JS in die `src/`-Module zerlegen — **verhaltensneutral** (kein Feature-Umbau), Doppelspurigkeiten dabei entfernen.
4. **Inline-Build** `build.js` + `index.template.html`; Output-`index.html` muss visuell/funktional der Baseline entsprechen.
5. **Tests** schreiben, beginnend bei reiner Logik, bis ≥ 80 % Coverage; Gutter-Setup dokumentieren.
6. **README** aktualisieren (Entwickeln in `src/`, `npm run build`, `npm run test:coverage`, Gutter-Anzeige).

## Akzeptanzkriterien (messbar)
- [ ] `npm run build` erzeugt eine einzelne `index.html`, die per Doppelklick (`file://`) offline läuft und **funktional identisch** zur Baseline ist (alle Features: Graph, Suche, Tiefe/Richtung, Drag&Drop-Import, IndexedDB-Persistenz, Attribute, Legende, Kontextmenüs, SVG/PNG-Export).
- [ ] Quellcode liegt in mehreren kohärenten `src/`-Modulen, reine Logik von Seiteneffekten getrennt, keine erkennbaren Doppelspurigkeiten.
- [ ] `npm run test:coverage` läuft grün und meldet **≥ 80 % Lines-Coverage brutto über alle Sektionen** (`src/sections/**`); verbleibende Ausnahmen sind einzeln in `FORTSCHRITT.md` begründet und die Brutto-Zahl ohne Ausnahmen wird mit ausgewiesen.
- [ ] `node build.js` läuft **ohne vorheriges `npm install`** (nur Node-Builtins) und erzeugt die Auslieferungs-`index.html`.
- [ ] `coverage/lcov.info` wird erzeugt; Gutter-Anzeige in VS Code ist im README beschrieben und funktioniert.
- [ ] Repo enthält keine regenerierbaren Artefakt-/Fremdtool-Verzeichnisse mehr; `git status` ist sauber.
- [ ] `build.js` und alle Skripte sind idempotent (mehrfach ausführbar ohne Schaden).

## Nicht-Ziele
- Kein neues Feature, kein UI-Redesign, keine Verhaltensänderung der App.
- Kein schwergewichtiger Bundler (Vite/Webpack/Rollup) — nur das triviale Inline-Build-Skript.
- Keine Laufzeit-Dependencies in der ausgelieferten Datei (D3 bleibt inlined).

## Risiken / Achtsamkeit
- **`file://` + ES-Module** funktionieren nur im **gebauten** (inlined) Zustand — die `src/`-Module sind reine Entwicklungs-/Testbasis.
- **Verhaltensgleichheit** ist das grösste Risiko bei der Extraktion: nach jeder Phase gegen die Baseline gegenprüfen.
- Globaler Scope → Module: Reihenfolge-/Abhängigkeitsfehler möglich; sauber über Imports/Exports auflösen statt globale Variablen.
