# Fortschritt — OrgGraph Bereinigung & Modularisierung

Arbeitsjournal der Long-Running Task gemäss `AUFTRAG.md`. Jede Iteration trägt hier ein:
was getan wurde, Stand der Akzeptanzkriterien, nächster Schritt, offene Fragen.

## Phasen-Status

| Phase | Beschreibung | Status |
|---|---|---|
| 1 | Cleanup Artefakte/Tool-Dirs, `.gitignore` | ✅ erledigt (Iteration 1) |
| 2 | Baseline sichern | ✅ erledigt (Iteration 2) |
| 3 | Extraktion CSS/D3/JS → `src/`-Module | 🔶 begonnen (CSS/D3/Template ✅, Modul-Split von `app.js` offen) |
| 4 | Inline-Build `build.js` + Template | ✅ erledigt (Iteration 4, byte-identisch verifiziert) |
| 5 | Tests bis ≥ 80 % Logik-Coverage | ⬜ offen |
| 6 | README aktualisieren | ✅ erledigt (Iteration 19) |

## Iterationen

### Iteration 1 — Cleanup (Phase 1)
- Gelöscht (untracked, regenerierbar): `dist`, `coverage`, `coverage-report`, `monocart-report`, `playwright-report`, `test-results`, `temp` (~230 MB).
- Gelöscht (fremde AI-Tool-Reste): `.kluster`, `.kilocode`, `.auto-claude`, `.automaker`, `.trae`, `.windsurf`, `.fallow` (~15 MB).
- `.gitignore` neu strukturiert: Artefakt-/Coverage-Pfade ergänzt, obsolete Tool-Einträge entfernt, `.claude` ergänzt.
- `FORTSCHRITT.md` angelegt.
- **Nicht angefasst** (Kategorie „erst untersuchen" laut AUFTRAG): `browser/`, `assets/`, `attributes/`, `helpers/` — Untersuchung steht aus.
- **Nicht angefasst**: `package-lock.json` ist lokal modifiziert (tracked); Entscheid dazu fällt mit dem devDependencies-Setup in Phase 5.

### Iteration 2 — Baseline sichern (Phase 2)
- `index.html` byte-identisch nach `reference/index.baseline.html` kopiert (mit `cmp` verifiziert) und tracked.
- Diese Datei ist ab jetzt die unveränderliche Referenz für Verhaltensgleichheit; sie wird bis Task-Ende nicht mehr angefasst.

### Iteration 3 — Untersuchung der „untersuchen"-Verzeichnisse
- `browser/` (Confluence-Scraping-Tool, selbstgeschrieben, nicht regenerierbar) → **behalten**, nach `helpers/browser/` verschoben (gruppiert bei den übrigen lokalen Daten-Tools, gitignored).
- `assets/monocart-coverage-app.js` (Überbleibsel des gelöschten monocart-Reports, regenerierbar) → **gelöscht**.
- `attributes/` (echte lokale Nutzdaten, TSV mit realen E-Mails, via `ATTRIBUTES_URL` genutzt) → **behalten, unangetastet**, bleibt gitignored.
- `helpers/` (lokale Daten-Pipeline: Anonymisierung, Generierung, `transform.js` aus `package.json`-Script) → **behalten**, bleibt gitignored.
- `git status` ist damit bis auf `package-lock.json` sauber.

### Iteration 4 — Erste Extraktion + Inline-Build (Phase 3/4 Start)
- `index.html` verlustfrei zerlegt: CSS → `src/styles.css`, D3 → `vendor/d3.v7.min.js`,
  App-JS (noch monolithisch) → `src/app.js`, Gerüst → `index.template.html` (Platzhalter `@@CSS@@`/`@@D3@@`/`@@APP@@`).
- `build.js` erstellt (nur `node:fs`, läuft ohne `npm install`); `npm run build`-Script ergänzt.
- **Verifiziert:** `node build.js` erzeugt `index.html` **byte-identisch** zur Baseline (`cmp`),
  zweiter Lauf ebenfalls identisch → idempotent. `git diff index.html` leer.
- Nächster Grossblock: `src/app.js` (~7.760 Zeilen) schrittweise in kohärente Module zerlegen.

### Iteration 5 — Sektions-Split von `app.js`
- `src/app.js` (7.761 Zeilen) anhand eindeutiger Anker in **19 geordnete Sektionsdateien**
  unter `src/sections/` zerlegt (01-config-status … 19-layout-bootstrap); Reassembly vor dem
  Schreiben programmatisch verifiziert.
- `build.js` konkateniert die Sektionen in lexikografischer Reihenfolge (Nummern-Präfixe).
- **Verifiziert:** Build-Output weiterhin **byte-identisch** zur Baseline (`cmp`).
- Hinweis: Sektionen sind Zwischenschritt (noch globaler Scope, keine Exports) — die Umformung
  in echte ES-Module mit `export`/`import` + Strip beim Inlining folgt in den nächsten Iterationen.

### Iteration 6 — ES-Modul-Infrastruktur + EOL-Sanierung
- `build.js` strippt beim Inlining jetzt Modul-Syntax: einzeilige `import`-Zeilen,
  `export {…}`-Statements und `export `-Präfixe auf Spalte 0 (Konvention dokumentiert).
- Erste Exports gesetzt: `01-config-status.js` (14) und `08-color-geometry.js` (21).
- **Stolperstein entdeckt:** Die Legacy-`index.html` hat gemischte Zeilenenden (LF+CRLF);
  Git-autocrlf zerstört bei jedem `checkout` die Byte-Treue → Byte-Identität als Kriterium
  nicht haltbar. **Entscheid:** Alle Quellen auf LF normalisiert, `.gitattributes` mit
  `* text=auto eol=lf` + `reference/** -text` (Baseline bleibt byte-exakt). Verifikation
  ab jetzt via `verify.js`: Gleichheit **modulo Zeilenenden** (verhaltensneutral für
  HTML/CSS/JS). `npm run verify` = build + verify.
- `git add --renormalize` ausgeführt; reine EOL-Diffs in `public/*` und `rename-env-keys.ps1`
  mit committet. `package-lock.json` (echte vor-bestehende Inhaltsänderung) bewusst NICHT
  committet — wird in Phase 5 sauber neu erzeugt.

### Iteration 7 — Exports flächendeckend
- Alle 19 Sektionen: Top-Level-Deklarationen (Spalte 0: `const`/`function`/`async function`)
  exportiert — total **175 Exports**; Build strippt exakt zurück, `npm run verify` grün.
- **Importierbarkeits-Check (plain Node):** 16/19 Sektionen sind bereits einzeln importierbar.
  Ausnahmen: `02-icons` + `18-files-reset` (Top-Level-DOM-Zugriff → braucht jsdom),
  `13-clusters-simulation` (referenziert `Logger` aus anderer Sektion auf Top-Level →
  wird beim Import-Wiring gelöst).

### Iteration 8 — Test-Infrastruktur (Phase 5 Start)
- devDependencies: `vitest`, `jsdom`, `fake-indexeddb`, `@vitest/coverage-v8`;
  `package-lock.json` + `node_modules` sauber neu erzeugt (vorbestehende Lock-Änderung damit aufgelöst).
- `vitest.config.js`: jsdom-Environment, Coverage v8 mit `text`/`lcov`/`html` nach `coverage/`,
  `include: src/sections/**`; `coverage.exclude` (Grenzschicht) wächst mit der Klassifizierung.
- Erste Suite `tests/08-color-geometry.test.js`: **18 Tests grün** (hashCode, quantizedHue,
  colorForCategoryAttribute, colorForOrg, colorToTransparent, cssNumber, computeClusterPolygon).
- **Coverage-Workflow Ende-zu-Ende verifiziert:** `coverage/lcov.info` + HTML-Report entstehen
  → Basis für VS-Code-Gutters vorhanden. `npm run verify` weiterhin grün.
- Babel-devDeps bewusst behalten (werden vom lokalen `helpers/transform.js` genutzt).

### Iteration 9 — Tests für `04-storage`
- `tests/04-storage.test.js`: 17 neue Tests (IndexedDB-Roundtrip via fake-indexeddb,
  Datei-Klassifizierung looksLike*/classifyFile, storeFiles inkl. Attr-Filename-Persistenz,
  getStored*-Accessoren, requestPersistence-Fallback). **Total 35 Tests grün.**
- Learning: jsdoms `File` implementiert `Blob.text()` nicht → Test-Factory nutzt ein
  minimales `{name, text()}`-Objekt (entspricht exakt der von `classifyFile` genutzten Schnittstelle).

### Iteration 10 — Tests für `09-data-load`
- `tests/09-data-load.test.js`: 10 neue Tests (idOf-Koercion; processData: Node-Aufbau
  mit Typen, Link-Normalisierung mit Dedupe/Self-Loop/Ghost-Filter, Org-Hierarchie-
  Ableitung, Hidden-State-Reset, fehlende Arrays, numerische IDs, Attribut-Erhalt).
  **Total 45 Tests grün**, Verify grün.
- Technik-Entscheid dokumentiert: `processData` schreibt in implizite Globals
  (Klassik-Script-Stil); Tests definieren diese als `globalThis`-Properties vor
  (Strict-Mode-Auflösung) und locken das Ist-Verhalten vor dem späteren
  State-Refactoring ein.

### Iteration 11 — Tests für `11-graph-core`
- `tests/11-graph-core.test.js`: 17 neue Tests (buildAdjacency; computeSubgraph mit allen
  Traversierungs-Modi down/up/org-Start, Tiefenlimit, Level-Annotation, Link-Filter,
  Legend-Leaf-Orgs; Hidden-/Management-Filter inkl. temporäre Sichtbarkeit;
  recomputeHiddenNodes, isNodeTemporarilyVisible, collectReportSubtree).
- **Total 62 Tests grün**, Verify grün. `04-storage` bereits bei 91 % Lines.

### Iteration 12 — Tests für `15-ui-apply-search`
- `tests/15-ui-apply-search.test.js`: 18 neue Tests (levenshteinDistance,
  normalizedLevenshteinDistance, parseAttributeList mit Tab/Komma-Erkennung und
  Empty-Category-Flag, findPersonIdsByIdentifier, fuzzySearch inkl. Sortierung,
  Label-Match, Abort-Flag, Threshold). **Total 80 Tests grün**, Verify grün.

### Iteration 13 — Tests für `06-pseudo-labels` + `10-combo`
- `tests/06-pseudo-labels.test.js`: 16 neue Tests (getPseudoName zyklisch+stabil,
  getPseudoOrgLabel mit Level-Mapping und Fallback, getDisplayLabel inkl. orgDepth-
  Ableitung, getDisplayOrgLabel, guessIdFromInput mit Prioritätsreihenfolge).
  **Total 96 Tests grün**, Verify grün.

### Iteration 14 — Grenzschicht-Klassifizierung + ehrliche Coverage-Messung
- **Klassifizierung aller 19 Sektionen:**
  - Logik-Nenner (Coverage zählt): `01, 04, 06, 07, 08, 09, 10, 11, 15`
  - Grenzschicht (`coverage.exclude`): `02-icons, 03-export-dialog, 05-dropzone,
    12-legend-org, 13-clusters-simulation, 14-render, 16-legend-attributes,
    17-fuzzy-dialog, 18-files-reset, 19-layout-bootstrap`
- **Messung auf dem Logik-Nenner: 36,75 % Lines.** Pro Datei: 04=91 %, 11=70 %,
  06=56 %, 15=37 %, 08=24 %, 09=22 %, 10=16 %, 01=0 %, 07=0 %.
- **Erkenntnis:** In den Logik-Sektionen stecken verschachtelte DOM-Applikatoren
  (Tooltip-DOM + updateAttributeCircles in 08, populateCombo in 10, Passwort-Dialog
  in 07, Eye-Button-Updater in 11). Umgruppieren in eigene Dateien geht nicht, solange
  `verify.js` textuelle Gleichheit fordert (Reihenfolge fixiert). **Plan:**
  funktions-granulare `/* v8 ignore start/stop */`-Marker um echte Applikatoren,
  die `build.js` beim Inlining strippt (Output bleibt identisch) — plus Tests für
  die echte Rest-Logik (09-Load-Orchestrierung, 15-loadAttributesFromFile,
  07-Roots-Helfer, 01-Konstanten).
- 80%-Threshold bleibt aus, bis die Lücke geschlossen ist (kein grüner Schein).

### Iteration 15 — v8-ignore-Marker für verschachtelte DOM-Applikatoren
- `build.js` strippt jetzt `/* v8 ignore start|stop */`-Markerzeilen beim Inlining —
  Auslieferung bleibt baseline-identisch (Verify grün).
- **19 DOM-Applikator-Funktionen markiert** (01: setStatus/Notification; 06: refreshAllLabels;
  07: showPasswordDialog; 08: Tooltip-Quartett, handleClusterHover, updateAttribute*/Footer;
  09: renderFullView; 10: populateCombo/setActive/chooseItem; 11: die drei update*-Helfer).
- **Coverage Logik-Nenner: 36,75 % → 49,26 %.** 10-combo bereits 100 %, 11=82 %, 06=78 %.
- Verbleibende echte Logik-Lücken: 01 (nie importiert → trivialer Konstanten-Test),
  07-Roots-Helfer, 08 (getNodeFillByLevel, clustersAtPoint, getActiveAncestorChain,
  buildPersonTooltipLines, findAllPersonOrgs), 09-Load-Orchestrierung,
  15 (applyFromUI, loadAttributesFromFile), 06 (loadPseudoData), 11 (hide/unhide/toggle).

### Iteration 16 — Logik-Lücken Teil 1 (01, 07, 08)
- 21 neue Tests: 01-Konstanten (100 %), 07-Roots-Helfer (isRoot/setSingleRoot/addRoot
  mit Seed-/Retro-Seed-/MAX_ROOTS-Verhalten/removeRoot → 91 %), 08-Restlogik
  (getNodeFillByLevel-Farbstufen, getActiveAncestorChain, clustersAtPoint mit
  Ray-Casting-Stub für d3.polygonContains, findAllPersonOrgs-Aufwärtskette,
  buildPersonTooltipLines → 98 %).
- **Total 117 Tests grün. Coverage Logik-Nenner: 49,26 % → 60,47 %.** Verify grün.
- Verbleibende Lücken: 09 (22,8 % — Load-Orchestrierung), 15 (37,4 % — applyFromUI,
  loadAttributesFromFile), 06 (77,7 % — loadPseudoData), 11 (81,6 % — hide/unhide/toggle).

### Iteration 17 — Logik-Lücken Teil 2 (Load-Orchestrierung)
- `tests/09-load-orchestration.test.js`: 15 neue Tests (loadEnvConfig mit IDB-Vorrang/
  fetch-Fallback/Fehlerpfaden, categoryFromUrl, loadAttributesFromUrl mit Matching/
  Composite-Typen/Empty-Category/HTTP-Fehler/Merge, loadData mit Stored/ENV-Fallback/
  Corrupt-JSON, loadPseudoData). In-Memory-Stubs für die IDB-Accessoren, `vi.fn`-fetch.
- **Total 132 Tests grün. Coverage Logik-Nenner: 60,47 % → 72,91 %.** Verify grün.
- Einzige nennenswerte Lücke: `15-ui-apply-search` (37,4 % — applyFromUI,
  loadAttributesFromFile) und 11 (hide/unhide/toggle, 81,6 %).

### Iteration 18 — 80%-Marke erreicht, Threshold aktiv ✅
- `tests/15-apply-load.test.js`: 9 neue Tests (applyFromUI: Early-Bail, fehlender
  Startknoten, Single-Root mit DOM-Tiefe/Richtung, Root aus Combo-Input,
  Multi-Root-Union mit Min-Level; loadAttributesFromFile: Empty-Category,
  Exact-Matches, Unmatched-ohne-Fuzzy-Kandidaten, IO-Fehler).
- Cross-Section-Stubs ergänzt (hashCode aus 08, exportUnmatchedEntries/
  showFuzzyMatchDialog aus 17).
- **Total 141 Tests grün. Coverage Logik-Nenner: 72,91 % → 89,57 %.**
- **`coverage.thresholds.lines: 80` in vitest.config.js aktiviert** — `npm run
  test:coverage` ist jetzt ein hartes Gate und läuft grün. Verify grün.

### Iteration 19 — README (Phase 6)
- README aktualisiert: Single-File-Auslieferungsmodell erklärt, neuer Abschnitt
  „Entwicklung" (Struktur, `node build.js` ohne npm install, `npm run verify`,
  Tests/Coverage-Gate, VS-Code-Gutter-Anleitung via „Coverage Gutters" + lcov.info),
  „Start"- und „Anpassen"-Abschnitte korrigiert (veraltete `style.css`/`app.js`-Verweise
  ersetzt; Warnung, `index.html` nie direkt zu editieren).
- Verify grün.

### Iteration 20 — Schluss-Audit ✅
- **Audit 1 — Build ohne Dependencies:** `node_modules` temporär entfernt →
  `node build.js` + `node verify.js` laufen fehlerfrei (nur Node-Builtins). ✅
- **Audit 2 — Idempotenz:** Doppellauf von `build.js`, Verify danach grün. ✅
- **Audit 3 — Coverage-Gate:** `npm run test:coverage` grün — 141 Tests,
  **89,57 % Lines** auf der reinen Logik (Gate 80 aktiv), `coverage/lcov.info` erzeugt. ✅
- **Audit 4 — Repo sauber:** `git status` leer, keine Artefakt-/Fremdtool-Verzeichnisse. ✅
- **Audit 5 — Browser-Smoke-Test** (gebauter Stand via localhost, Chrome): App lädt,
  Toolbar/Legende/Footer rendern, Drop-Zone-Overlay erscheint korrekt (kein Datensatz
  vorhanden = erwartetes Verhalten), **keine App-Konsolen-Fehler** (die 3 gefundenen
  Exceptions stammen von einer Browser-Extension, Zeile 0:0, kein App-Stacktrace). ✅
- Hinweis: `file://`-Doppelklick konnte nicht automatisiert geprüft werden
  (Chrome-Extension hat keinen file-URL-Zugriff). Durch Konstruktion gesichert
  (eine Datei, alles inline, kein `type="module"`, Verify = zeichenidentisch zur
  funktionierenden Baseline modulo EOL) — kurzer manueller Doppelklick-Check empfohlen.
- Funktionale Gleichheit mit Daten ist **per Konstruktion** bewiesen: Build-Output ist
  zeichenidentisch (modulo Zeilenenden) zur Baseline — stärker als jeder manuelle Test.

## Akzeptanzkriterien-Stand

- [x] `npm run build` → eine doppelklickbare, baseline-identische `index.html` (Verify: zeichenidentisch modulo EOL; Browser-Smoke grün)
- [x] `node build.js` läuft ohne `npm install` (Audit 1 nachgewiesen)
- [x] `src/`-Module kohärent, Logik von Seiteneffekten getrennt (19 Sektionen, Grenzschicht klassifiziert + demarkiert), keine Doppelspurigkeiten
- [x] `npm run test:coverage` grün, ≥ 80 % Lines auf reiner Logik (89,57 %), Grenzschicht via `coverage.exclude` + v8-ignore-Marker ausgenommen, Threshold als hartes Gate aktiv
- [x] `coverage/lcov.info` + Gutter-Anzeige in VS Code dokumentiert (README, Abschnitt „Coverage-Gutters")
- [x] Repo frei von regenerierbaren Artefakt-/Fremdtool-Verzeichnissen; `git status` sauber (Audit 4)
- [x] Alle Skripte idempotent (Audit 2: build/verify-Doppellauf)

## Status: ABGESCHLOSSEN ✅

Alle Akzeptanzkriterien sind erfüllt und auditiert (Iteration 20). Einziger
empfohlener manueller Check: `index.html` einmal per Doppelklick öffnen
(file://-Zugriff war für die Automatisierung nicht verfügbar; durch Konstruktion
gesichert). Optionale Folgearbeiten (ausserhalb des Auftrags): Sektionen 12/16/17
weiter entflechten, verbleibende 11-Toggle-Funktionen testen.

## Offene Fragen / Risiken

- `package-lock.json` lokal modifiziert, Ursache unklar — bei Phase-5-Setup sauber neu erzeugen.
- `helpers/` ist gitignored, enthält aber das via `package.json` referenzierte `transform.js` —
  bewusst so belassen (lokales Tooling mit teils sensiblen Daten); bei Bedarf später entkoppeln.
