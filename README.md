# OrgGraph

Minimaler statischer D3-Graph. Benutzer kann Startknoten wählen und Such-Tiefe konfigurieren.

## ENV-Konfiguration

Die App kann über eine `env.json` Datei konfiguriert werden. Kopieren Sie `env.example.json` nach `env.json` und passen Sie die Werte an:

```bash
cp env.example.json env.json
```

```json
{
  "DATA_URL": "./data.default.json",
  "DEFAULT_START_ID": "p-1",
  "DEFAULT_DEPTH": 2,
  "DEFAULT_DIR": "both",
  "DEFAULT_MANAGEMENT": true,
  "DEFAULT_LABELS": true,
  "DEFAULT_HIERARCHY": true,
  "DEFAULT_DEBUG": false,
  "DEFAULT_ATTRIBUTES": true,
  "DEFAULT_HIDDEN_ROOTS": ["p-1"],
  "ATTRIBUTES_URL": "./attributes.tsv.txt"
}
```

### Konfigurationsoptionen

- **`DATA_URL`**: URL zur Datendatei (optional)
- **`DEFAULT_START_ID`**: Standard-Startknoten-ID
- **`DEFAULT_DEPTH`**: Standard-Suchtiefe
- **`DEFAULT_DIR`**: Standard-Richtung (`both`, `down`, `up`)
- **`DEFAULT_MANAGEMENT`**: Management-Filter standardmäßig aktiviert
- **`DEFAULT_LABELS`**: Knoten-Labels standardmäßig sichtbar
- **`DEFAULT_HIERARCHY`**: Hierarchie-Layout standardmäßig aktiviert
- **`DEFAULT_DEBUG`**: Debug-Modus standardmäßig aktiviert (zeigt Koordinaten statt Namen)
- **`DEFAULT_ATTRIBUTES`**: Attribut-Sichtbarkeit standardmäßig aktiviert
- **`DEFAULT_HIDDEN_ROOTS`**: Array von Knoten-IDs, die standardmäßig ausgeblendet werden
- **`ATTRIBUTES_URL`**: URL zur Attributdatei (TSV/CSV-Format, optional)

## Datenformat

Die App erwartet eine Datei `data.json` oder `data.generated.json` im `orggraph/` Verzeichnis mit folgendem Format:

- **`persons`**: Array von Personen-Objekten
  - `id` (string, required): Eindeutige ID
  - `label` (string, required): Anzeigename
  - `email` (string, optional): E-Mail-Adresse
  - `isBasis` (boolean, optional): `true` = Person ohne Mitarbeiter (Blatt-Knoten, wird bei aktiviertem Management-Filter ausgeblendet)
- **`orgs`**: Array von Organisations-Objekten
  - `id` (string, required): Eindeutige ID
  - `label` (string, required): Name der Organisationseinheit
- **`links`**: Array von Beziehungen
  - `source` (string, required): Quell-ID
  - `target` (string, required): Ziel-ID
  - Typen: Person→Person (Vorgesetzter→Mitarbeiter), Person→Org (Mitgliedschaft), Org→Org (Hierarchie)

### Optional: Transform-Utility

Falls deine Quelldaten ein anderes Format haben, kannst du das mitgelieferte Transform-Skript verwenden:

```bash
# Mit Positionsargumenten
node transform.js input.json output.json

# Mit benannten Optionen
node transform.js --input source.json --output data.json
node transform.js -i source.json -o data.json

# Hilfe anzeigen
node transform.js --help
```

## Start

- Öffne `index.html` direkt im Browser, oder
- Starte einen simplen Static-Server (z.B. via VS Code Live Server oder `python -m http.server`).

## Nutzung

- **Suchfeld**: Namen oder ID eingeben (min. 2 Zeichen für große Datensätze)
  - Zeigt max. 100 Ergebnisse an
  - Debounced Search (150ms Verzögerung) für bessere Performance
  - Mehrfach-Roots:
    - Shift+Klick auf Treffereintrag → als weiterer Root hinzufügen
    - Shift+Enter bei Tastenauswahl (↑/↓) → als weiterer Root hinzufügen
    - Enter/Klick ohne Shift → ersetzt alle Roots durch den ausgewählten
- **Tiefe**: Anzahl BFS-Stufen ab Startknoten
- **Management-Checkbox**: Standardmäßig aktiviert - blendet Personen ohne Mitarbeiter (Blätter) aus
- **Button „Anzeigen"**: Rendert den Teilgraphen
- **OE-Legende**: Organisationseinheiten ein-/ausblenden (Rechtsklick für Subtree-Aktionen)
  - Single-Root: Legende zeigt OEs im Kontext des Startknotens
  - Multi-Root: Legende zeigt die Vereinigungsmenge aller relevanten OEs der ausgewählten Roots
- **Attribute**: Über ENV-Datei konfigurierbar - bei Angabe von `ATTRIBUTES_URL` werden Attribute automatisch geladen und angezeigt

### Kontextmenü

- Rechtsklick auf Personenknoten öffnet ein kontextbezogenes Menü (Browser-Menü ist global deaktiviert):
  - „Ausblenden“: blendet die Berichtslinie dieser Management-Person aus
  - „Als Root entfernen“: nur sichtbar, wenn der Knoten aktueller Root ist und mindestens 2 Roots ausgewählt sind

Hinweis: Das Browser-Kontextmenü ist global unterdrückt, damit die App-eigenen Menüs konsistent funktionieren.

## Beispiel

```json
{
  "persons": [
    { "id": "p-123", "label": "Max Mustermann", "email": "max@example.ch", "isBasis": true },
    { "id": "p-456", "label": "Anna Müller", "email": "anna@example.ch" }
  ],
  "orgs": [
    { "id": "10000025", "label": "Bundeskanzlei" }
  ],
  "links": [
    { "source": "p-456", "target": "p-123" },
    { "source": "p-123", "target": "10000025" }
  ]
}
```

**Hinweis**: `isBasis: true` bedeutet, dass die Person keine Mitarbeiter hat (Blatt-Knoten). Personen ohne `isBasis`-Feld oder mit `isBasis: false` sind Manager.

## Anpassen

- UI/Styles: `index.html`, `style.css`
- Logik/Rendering: `app.js`
- Transformation: `transform.js`

## Testing

Die App verwendet Playwright für End-to-End-Tests mit Coverage-Tracking.

### Voraussetzungen

```bash
npm install
```

### Tests ausführen

| Befehl | Beschreibung |
|--------|--------------|
| `npm run test:coverage` | Alle Tests mit Coverage-Report |
| `npm run test:ui` | Playwright UI Mode (interaktiv) |
| `npx playwright test [name]` | Einzelnen Test ausführen (z.B. `person-search`) |

### Tests aufzeichnen

1. **Dev-Server starten** (Terminal 1):
   ```bash
   npm run dev
   ```

2. **Test-Recorder starten** (Terminal 2):
   ```bash
   npm run test:record
   ```

3. **Im Recorder**:
   - Interaktionen durchführen → Code wird generiert
   - Code kopieren
   - **Clear** klicken für nächsten Test
   - Wiederholen...

4. **Neuen Test erstellen**:
   - Kopiere `tests/_template.spec.js` → `tests/[feature].spec.js`
   - Füge aufgezeichneten Code ein
   - Ersetze `page.goto('http://localhost:5173/')` mit `page.goto('/')`

### Test-Struktur

```
tests/
├── fixtures.js          # Coverage-Fixture (immer importieren!)
├── _template.spec.js    # Vorlage für neue Tests
├── coverage.spec.js     # Basis-Coverage-Test
└── person-search.spec.js # Feature-spezifische Tests
```

### Coverage-Reports

Nach `npm run test:coverage`:
- **HTML-Report**: `coverage/index.html` (V8 Coverage)
- **LCOV-Report**: `coverage/lcov.info` (für VS Code Gutter)
- **Test-Report**: `coverage-report/index.html`

Für Coverage-Anzeige im VS Code Editor die Extension "Coverage Gutters" installieren und in Settings konfigurieren:
```json
{
  "coverage-gutters.coverageFileNames": ["coverage/lcov.info"]
}
```
