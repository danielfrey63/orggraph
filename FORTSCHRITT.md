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

## Akzeptanzkriterien-Stand

- [ ] `npm run build` → eine doppelklickbare, baseline-identische `index.html`
- [ ] `node build.js` läuft ohne `npm install`
- [ ] `src/`-Module kohärent, Logik von Seiteneffekten getrennt, keine Doppelspurigkeiten
- [ ] `npm run test:coverage` grün, ≥ 80 % Lines auf reiner Logik, Grenzschicht via `coverage.exclude` ausgenommen
- [ ] `coverage/lcov.info` + Gutter-Anzeige in VS Code dokumentiert
- [x] Repo frei von regenerierbaren Artefakt-/Fremdtool-Verzeichnissen (Teil von „Repo sauber"; `git status` final sauber steht noch aus)
- [ ] Alle Skripte idempotent

## Nächster Schritt (Iteration 8)

Test-Infrastruktur aufsetzen (Phase 5 Start): Vitest + jsdom + fake-indexeddb +
@vitest/coverage-v8 als devDependencies, `vitest.config.js` mit `coverage.exclude`
für die Grenzschicht-Sektionen, `package-lock.json` dabei sauber neu erzeugen.
Erste Tests gegen die reinsten, bereits importierbaren Sektionen (08-color-geometry:
hashCode, quantizedHueFromCategory, colorToTransparent, computeClusterPolygon;
01-config-status: Konstanten). Damit steht der Coverage-Workflow Ende-zu-Ende
(lcov.info für Gutters), bevor die Test-Masse wächst. Import-Wiring zwischen
Sektionen folgt danach testgetrieben (nur wo Tests es brauchen).

## Offene Fragen / Risiken

- `package-lock.json` lokal modifiziert, Ursache unklar — bei Phase-5-Setup sauber neu erzeugen.
- `helpers/` ist gitignored, enthält aber das via `package.json` referenzierte `transform.js` —
  bewusst so belassen (lokales Tooling mit teils sensiblen Daten); bei Bedarf später entkoppeln.
