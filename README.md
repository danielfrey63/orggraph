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
verify.js             # Prüft, ob index.html mit den Quellen in Sync ist (Re-Build + Vergleich)
tests/*.test.js       # Vitest-Suiten
```

### Build (kein npm install nötig)

```bash
node build.js     # erzeugt index.html aus Template + Quellen
npm run verify    # Re-Build + Sync-Check des committeten index.html (modulo Zeilenenden)
```

`build.js` läuft mit purem Node (nur `node:fs`): Es inlined CSS, D3 und die Sektionen
in `index.html` und strippt dabei die Modul-Syntax (`import`-Zeilen, `export`-Präfixe)
sowie die `/* v8 ignore */`-Coverage-Marker. Der Build ist idempotent.

### Tests & Coverage (einmalig `npm install`)

```bash
npm test               # Vitest-Suiten
npm run test:coverage  # mit Coverage; Gate: >= 80 % Lines brutto ueber ALLE Sektionen
```

Die Coverage misst den **gesamten App-Code**: alle 19 Sektionen zählen, es gibt
keine Datei-Ausschlüsse (`coverage.exclude` ist leer). Aktueller Stand: ~91 %
Lines brutto. Einzige Ausnahmen sind 5 nachweislich verzweigungsfreie
Applikator-Funktionen (`setStatus`, Tooltip-Setter, `renderFullView`, zusammen
39 Zeilen), markiert mit `/* v8 ignore start/stop */`; inklusive dieser Zeilen
liegt die absolute Brutto-Coverage bei ~90,6 %.

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

Die App wird über eine Env-Datei im JSON-Format konfiguriert (Vorlage:
`public/env.example.json`). Sie kann auf zwei Wegen geladen werden:

1. **Import** (empfohlen, funktioniert überall inkl. `file://`): Datei, Ordner
   oder ZIP per Drag & Drop importieren — siehe [Import per Drag & Drop](#import-per-drag--drop).
   Die Config landet in IndexedDB und wird bei jedem Start von dort gelesen.
2. **Dev-Server-Fallback**: Liegt nichts in IndexedDB, versucht die App
   `./env.json` per `fetch` relativ zur Seite zu laden (funktioniert nur über
   einen Server, nicht über `file://`).

```json
{
  "DATA_URL": "./data.example.json",
  "DATA_ATTRIBUTES_URL": "./attributes.example.txt",

  "TOOLBAR_DEPTH_DEFAULT": 2,
  "TOOLBAR_DIRECTION_DEFAULT": "down",
  "TOOLBAR_MANAGEMENT_ACTIVE": false,
  "TOOLBAR_HIERARCHY_ACTIVE": false,
  "TOOLBAR_LABELS_ACTIVE": false,
  "TOOLBAR_ZOOM_DEFAULT": 0.3,
  "TOOLBAR_PSEUDO_ACTIVE": true,
  "TOOLBAR_PSEUDO_PASSWORD": "",
  "TOOLBAR_DEBUG_ACTIVE": false,
  "TOOLBAR_SIMULATION_ACTIVE": false,

  "LEGEND_OES_COLLAPSED": false,
  "LEGEND_ATTRIBUTES_COLLAPSED": false,
  "LEGEND_ATTRIBUTES_ACTIVE": false,
  "LEGEND_HIDDEN_COLLAPSED": false,
  "LEGEND_HIDDEN_ROOTS_DEFAULT": [],

  "GRAPH_START_ID_DEFAULT": "p-29"
}
```

### Konfigurationsoptionen

- **`DATA_URL`**: Pfad/URL zur Datendatei (beim Import relativ zur Env-Datei
  aufgelöst, am Dev-Server relativ zur Seite)
- **`DATA_ATTRIBUTES_URL`**: Pfad/URL zu Attributdateien (String oder Array;
  TSV/CSV/TXT)
- **`TOOLBAR_DEPTH_DEFAULT`**: Standard-Suchtiefe
- **`TOOLBAR_DIRECTION_DEFAULT`**: Standard-Richtung (`both`, `down`, `up`)
- **`TOOLBAR_MANAGEMENT_ACTIVE`**: Management-Filter standardmässig aktiviert
- **`TOOLBAR_HIERARCHY_ACTIVE`**: Hierarchie-Layout standardmässig aktiviert
- **`TOOLBAR_LABELS_ACTIVE`**: Label-Sichtbarkeit (`true`/`false` oder
  `"all"`/`"attributes"`/`"none"`)
- **`TOOLBAR_ZOOM_DEFAULT`**: initialer Zoomfaktor (Zahl > 0)
- **`TOOLBAR_PSEUDO_ACTIVE`**: Pseudonymisierung standardmässig aktiviert
- **`TOOLBAR_PSEUDO_PASSWORD`**: Passwort zum Deaktivieren der
  Pseudonymisierung (leer = kein Schutz)
- **`TOOLBAR_DEBUG_ACTIVE`**: Debug-Modus (zeigt Koordinaten statt Namen)
- **`TOOLBAR_SIMULATION_ACTIVE`**: kontinuierliche Simulation aktiviert
- **`LEGEND_OES_COLLAPSED`** / **`LEGEND_ATTRIBUTES_COLLAPSED`** /
  **`LEGEND_HIDDEN_COLLAPSED`**: jeweilige Legenden-Sektion initial eingeklappt
- **`LEGEND_ATTRIBUTES_ACTIVE`**: Attribut-Sichtbarkeit im Graph
- **`LEGEND_HIDDEN_ROOTS_DEFAULT`**: Array von Knoten-IDs, deren Subtrees
  standardmässig ausgeblendet werden
- **`GRAPH_START_ID_DEFAULT`**: Startknoten-ID (String oder Array für
  Mehrfach-Roots)

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

## Import per Drag & Drop

Daten lassen sich jederzeit per Drag & Drop ins Fenster laden (oder über den
Dateiauswahl-Button der Drop-Zone). Alles wird lokal im Browser (IndexedDB)
gespeichert und beim nächsten Öffnen automatisch geladen — funktioniert damit
vollständig offline über `file://`, ohne Server.

### Desktop-Workflow (file://)

1. `index.html` per Doppelklick öffnen.
2. Den **Ordner** (oder das **ZIP**) mit Env-, Daten- und Attributdateien aus
   dem Explorer/Finder direkt ins Browserfenster ziehen — ein
   Verzeichnis-Dialog ist nicht nötig, der Drop ersetzt das «Verzeichnis
   öffnen».
3. Die App speichert alles in IndexedDB und lädt sich neu; ab dann startet sie
   auch ohne erneuten Import direkt mit diesen Daten.

Der Button «Dateien auswählen…» öffnet einen Datei-Dialog (mehrere Dateien
inkl. ZIP möglich, aber keine Ordner) — für ganze Ordner den Drag & Drop-Weg
nutzen. Hinweis: Beim Drop einer *einzelnen* Env-Datei kann der Browser aus
Sicherheitsgründen nicht auf deren Nachbardateien zugreifen; die referenzierten
Dateien müssen Teil desselben Drops sein (Ordner/ZIP) oder separat gedroppt
werden.

### Unterstützte Drops

- **Einzeldateien** (auch mehrere gleichzeitig): Datensatz-JSON, Env-JSON,
  Pseudo-Daten, Attribut-Dateien (`.tsv`/`.csv`/`.txt`).
- **Ordner**: wird rekursiv eingelesen.
- **ZIP-Archiv**: wird direkt im Browser entpackt (ohne Dependencies, via
  `DecompressionStream`; Stored- und Deflate-Einträge).

### Wie Dateien erkannt werden

Die Erkennung erfolgt **inhaltsbasiert, nicht über den Dateinamen** — die
Dateien dürfen beliebig heissen:

- **Env-Config**: parsebares JSON, das einen `DATA_URL`-Schlüssel oder
  Schlüssel mit Präfix `TOOLBAR_`/`LEGEND_` enthält.
- **Datensatz**: JSON mit `persons`-, `orgs`- oder `links`-Array.
- **Pseudo-Daten**: JSON mit `names`-Array oder `organizationalUnits*`-Schlüsseln.
- **Attribute**: Dateiendung `.tsv`/`.csv`/`.txt`.

Nur wenn ein Drop **mehrere** Env-Kandidaten enthält, zählt der Name: Die Datei
mit dem exakten Namen `env.json` gewinnt (sonst die alphabetisch erste).

### Env-gesteuertes Nachziehen

Enthält ein Ordner-/ZIP-Drop eine Env-Config, ist sie **massgebend**: Die in
`DATA_URL` und `DATA_ATTRIBUTES_URL` referenzierten Dateien werden relativ zur
Lage der Env-Datei im Drop aufgelöst (Fallback: eindeutiger Dateiname) und
gezielt übernommen; nicht referenzierte Datensatz-/Env-Kandidaten werden
ignoriert (mit Hinweis). Referenzen, die im Drop fehlen, werden gemeldet — auf
einem Dev-Server greift dafür weiterhin der `fetch`-Fallback.

Nach dem Import liest die App die Konfiguration bei jedem Start zuerst aus
IndexedDB; der `fetch` auf `./env.json` ist nur noch Fallback für den
Dev-Server-Betrieb ohne importierte Daten. «Daten zurücksetzen» im Footer
leert den lokalen Speicher wieder.

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
