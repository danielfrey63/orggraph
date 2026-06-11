# Fortschritt — OrgGraph Bereinigung & Modularisierung

Arbeitsjournal der Long-Running Task gemäss `AUFTRAG.md`. Jede Iteration trägt hier ein:
was getan wurde, Stand der Akzeptanzkriterien, nächster Schritt, offene Fragen.

## Phasen-Status

| Phase | Beschreibung | Status |
|---|---|---|
| 1 | Cleanup Artefakte/Tool-Dirs, `.gitignore` | ✅ erledigt (Iteration 1) |
| 2 | Baseline sichern | ✅ erledigt (Iteration 2) |
| 3 | Extraktion CSS/D3/JS → `src/`-Module | ⬜ offen |
| 4 | Inline-Build `build.js` + Template | ⬜ offen |
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

## Akzeptanzkriterien-Stand

- [ ] `npm run build` → eine doppelklickbare, baseline-identische `index.html`
- [ ] `node build.js` läuft ohne `npm install`
- [ ] `src/`-Module kohärent, Logik von Seiteneffekten getrennt, keine Doppelspurigkeiten
- [ ] `npm run test:coverage` grün, ≥ 80 % Lines auf reiner Logik, Grenzschicht via `coverage.exclude` ausgenommen
- [ ] `coverage/lcov.info` + Gutter-Anzeige in VS Code dokumentiert
- [x] Repo frei von regenerierbaren Artefakt-/Fremdtool-Verzeichnissen (Teil von „Repo sauber"; `git status` final sauber steht noch aus)
- [ ] Alle Skripte idempotent

## Nächster Schritt (Iteration 4)

Phase 3 starten — erste Extraktion: CSS (Z. 8–1934 der `index.html`) nach `src/styles.css`
und D3 (Z. 2141–2143) nach `vendor/d3.v7.min.js` auslagern, `index.template.html` anlegen.
Direkt gefolgt vom minimalen `build.js` (Phase 4 vorgezogen), damit die Baseline-Gleichheit
des Build-Outputs ab der ersten Extraktion verifizierbar ist.

## Offene Fragen / Risiken

- `package-lock.json` lokal modifiziert, Ursache unklar — bei Phase-5-Setup sauber neu erzeugen.
- `helpers/` ist gitignored, enthält aber das via `package.json` referenzierte `transform.js` —
  bewusst so belassen (lokales Tooling mit teils sensiblen Daten); bei Bedarf später entkoppeln.
