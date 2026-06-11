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
| 6 | README aktualisieren | ⬜ offen |

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

## Akzeptanzkriterien-Stand

- [ ] `npm run build` → eine doppelklickbare, baseline-identische `index.html`
- [ ] `node build.js` läuft ohne `npm install`
- [ ] `src/`-Module kohärent, Logik von Seiteneffekten getrennt, keine Doppelspurigkeiten
- [ ] `npm run test:coverage` grün, ≥ 80 % Lines auf reiner Logik, Grenzschicht via `coverage.exclude` ausgenommen
- [ ] `coverage/lcov.info` + Gutter-Anzeige in VS Code dokumentiert
- [x] Repo frei von regenerierbaren Artefakt-/Fremdtool-Verzeichnissen (Teil von „Repo sauber"; `git status` final sauber steht noch aus)
- [ ] Alle Skripte idempotent

## Nächster Schritt (Iteration 13)

Tests für `06-pseudo-labels` (getPseudoName, getPseudoOrgLabel, getDisplayLabel,
getDisplayOrgLabel) und `10-combo` (guessIdFromInput). Danach die Grenzschicht-
Klassifizierung aller 19 Sektionen (`coverage.exclude`-Liste + 80%-Threshold
in vitest.config) — dann zeigt sich, wo noch Coverage-Lücken auf der reinen
Logik sind.

## Offene Fragen / Risiken

- `package-lock.json` lokal modifiziert, Ursache unklar — bei Phase-5-Setup sauber neu erzeugen.
- `helpers/` ist gitignored, enthält aber das via `package.json` referenzierte `transform.js` —
  bewusst so belassen (lokales Tooling mit teils sensiblen Daten); bei Bedarf später entkoppeln.
