# OrgGraph

Minimaler statischer D3-Graph. Benutzer kann Startknoten wählen und Such-Tiefe konfigurieren.

Die Auslieferung ist eine **einzige, doppelklickbare `index.html`** (offline lauffähig über
`file://`, keine Runtime-Dependencies). Entwickelt wird in ES-Modulen unter `src/`; ein
dependency-freier Build fügt alles zu einer Datei zusammen.

## Entwicklung

```
src/sections/*.js     # App-Code als ES-Module (nummeriert = Inlining-Reihenfolge)
src/styles.css        # Styles
vendor/d3.v7.min.js   # D3 (wird beim Build inlined)
index.template.html   # HTML-Gerüst mit @@CSS@@/@@D3@@/@@APP@@-Platzhaltern
build.js              # Inline-Build (nur Node-Builtins)
verify.js             # Vergleich Build-Output vs. reference/index.baseline.html
tests/*.test.js       # Vitest-Suiten
```

### Build (kein npm install nötig)

```bash
node build.js     # erzeugt index.html aus Template + Quellen
npm run verify    # Build + Abgleich gegen die Baseline (modulo Zeilenenden)
```

`build.js` läuft mit purem Node (nur `node:fs`): Es inlined CSS, D3 und die Sektionen
in `index.html` und strippt dabei die Modul-Syntax (`import`-Zeilen, `export`-Präfixe)
sowie die `/* v8 ignore */`-Coverage-Marker. Der Build ist idempotent.

### Tests & Coverage (einmalig `npm install`)

```bash
npm test               # Vitest-Suiten
npm run test:coverage  # mit Coverage; Gate: >= 80 % Lines auf der reinen Logik
```

Die Coverage misst die **reine Logik**: DOM/D3-Applikator-Sektionen sind via
`coverage.exclude` in `vitest.config.js` ausgenommen, einzelne in Logik-Sektionen
verschachtelte Applikator-Funktionen über `/* v8 ignore start/stop */`-Marker.

### Coverage-Gutters in VS Code

1. Extension **„Coverage Gutters"** (ryanluker.vscode-coverage-gutters) installieren.
2. `npm run test:coverage` ausführen — erzeugt `coverage/lcov.info`.
3. Befehl „Coverage Gutters: Display Coverage" (oder „Watch") ausführen —
   getestete/ungetestete Zeilen erscheinen farbig im Editor-Gutter.

Die Gutters funktionieren in den Quell-Sektionen (`src/sections/*.js`) **und** in der
gebauten `index.html`: `remap-coverage.js` (läuft automatisch am Ende von
`npm run test:coverage`) übersetzt die Sektions-Coverage zeilengenau auf die
Auslieferungsdatei und hängt einen `index.html`-Record an `coverage/lcov.info` an.

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

- Öffne `index.html` direkt im Browser (Doppelklick, `file://`), oder
- Starte einen simplen Static-Server (z.B. via VS Code Live Server oder `python -m http.server`).

Nach Änderungen an `src/` zuerst `node build.js` ausführen.

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

- HTML-Gerüst: `index.template.html`
- Styles: `src/styles.css`
- Logik/Rendering: `src/sections/*.js` (Nummern-Präfix = Inlining-Reihenfolge)
- Transformation: `helpers/transform.js` (`npm run transform`)

Niemals `index.html` direkt editieren — sie ist Build-Output.
