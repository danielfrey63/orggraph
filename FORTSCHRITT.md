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

## Akzeptanzkriterien-Stand

- [ ] `npm run build` → eine doppelklickbare, baseline-identische `index.html`
- [ ] `node build.js` läuft ohne `npm install`
- [ ] `src/`-Module kohärent, Logik von Seiteneffekten getrennt, keine Doppelspurigkeiten
- [ ] `npm run test:coverage` grün, ≥ 80 % Lines auf reiner Logik, Grenzschicht via `coverage.exclude` ausgenommen
- [ ] `coverage/lcov.info` + Gutter-Anzeige in VS Code dokumentiert
- [x] Repo frei von regenerierbaren Artefakt-/Fremdtool-Verzeichnissen (Teil von „Repo sauber"; `git status` final sauber steht noch aus)
- [ ] Alle Skripte idempotent

## Nächster Schritt (Iteration 3)

Vorarbeit zu Phase 3: Die vier „untersuchen"-Verzeichnisse (`browser/`, `assets/`,
`attributes/`, `helpers/`) auf Relevanz prüfen und Entscheid in FORTSCHRITT.md
dokumentieren — danach beginnt die Extraktion (CSS → Datei, D3 → `vendor/`).

## Offene Fragen / Risiken

- `browser/`, `assets/`, `attributes/`, `helpers/`: Relevanz noch ungeklärt — vor Phase 3 untersuchen.
  `helpers/transform.js` ist via `package.json`-Script `transform` referenziert, liegt aber gitignored.
- `package-lock.json` lokal modifiziert, Ursache unklar — bei Phase-5-Setup sauber neu erzeugen.
