# OrgGraph

Interaktive D3-basierte Organisations-Graph-Visualisierung. Benutzer kann Startknoten wählen, Such-Tiefe konfigurieren, Attribute laden und den Graphen exportieren.

## Schnellstart

```bash
npm install
npm run dev          # Dev-Server auf http://localhost:5173
```

Für Beispieldaten:

```bash
npm run dev:example  # Lädt data.example.json statt Produktionsdaten
```

## Scripts

| Befehl | Beschreibung |
|--------|--------------|
| `npm run dev` | Vite Dev-Server starten |
| `npm run dev:example` | Dev-Server mit Beispieldaten |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm run preview` | Produktions-Build lokal testen |
| `npm run lint` | ESLint prüfen |
| `npm run lint:fix` | ESLint automatisch korrigieren |
| `npm run transform` | Quelldaten transformieren (siehe unten) |

## Konfiguration

### Configuration Precedence

Die App unterstützt 7 Konfigurationsquellen mit klarer Priorität (höchste zuerst):

| # | Quelle | Beschreibung |
|---|--------|--------------|
| 1 | **CLI args** | `vite --define 'import.meta.env.VITE_KEY="value"'` |
| 2 | **Runtime injected** | `window.__ORGGRAPH_ENV__` (Script-Tag im HTML) |
| 3 | **System env** | `VITE_*` Umgebungsvariablen des Systems |
| 4 | **.env files** | `.env`, `.env.production`, `.env.development` |
| 5 | **env.json** | `public/env.json` (zur Laufzeit geladen) |
| 6 | **config.json** | `public/config.json` (zur Laufzeit geladen) |
| 7 | **Code defaults** | Hartcodierte Standardwerte in `src/config/env.js` |

> **Hinweis:** Quellen 1, 3 und 4 werden von Vite zur Build-Zeit in `import.meta.env` gebündelt und sind zur Laufzeit nicht unterscheidbar.

### Konfigurationsoptionen

#### Daten

| Schlüssel | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `DATA_URL` | string | `./data.json` | URL zur Graphdaten-Datei |
| `DATA_ATTRIBUTES_URL` | string[] | `["./attributes.txt"]` | URLs zu Attributdateien (TSV/CSV) |

#### Toolbar

| Schlüssel | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `TOOLBAR_DEPTH_DEFAULT` | number | `2` | Standard-Suchtiefe (BFS-Stufen) |
| `TOOLBAR_DIRECTION_DEFAULT` | string | `both` | Richtung: `both`, `up`, `down` |
| `TOOLBAR_MANAGEMENT_ACTIVE` | boolean | `true` | Management-Filter aktiviert |
| `TOOLBAR_HIERARCHY_ACTIVE` | boolean | `false` | Hierarchie-Layout aktiviert |
| `TOOLBAR_LABELS_ACTIVE` | string | `all` | Label-Modus: `all`, `attributes`, `none` |
| `TOOLBAR_ZOOM_DEFAULT` | string/number | `fit` | Zoom: `fit` oder numerischer Wert |
| `TOOLBAR_PSEUDO_ACTIVE` | boolean | `true` | Pseudonymisierung aktiviert |
| `TOOLBAR_PSEUDO_PASSWORD` | string | `""` | Passwort zum Aufheben der Pseudonymisierung |
| `TOOLBAR_DEBUG_ACTIVE` | boolean | `false` | Debug-Modus aktiviert |
| `TOOLBAR_SIMULATION_ACTIVE` | boolean | `false` | Simulation dauerhaft aktiv |

#### Legende

| Schlüssel | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `LEGEND_OES_COLLAPSED` | boolean | `false` | OE-Legende eingeklappt |
| `LEGEND_ATTRIBUTES_COLLAPSED` | boolean | `false` | Attribut-Legende eingeklappt |
| `LEGEND_ATTRIBUTES_ACTIVE` | boolean | `false` | Attribute sichtbar |
| `LEGEND_HIDDEN_COLLAPSED` | boolean | `true` | Ausgeblendet-Legende eingeklappt |
| `LEGEND_HIDDEN_ROOTS_DEFAULT` | string[] | `[]` | IDs standardmäßig ausgeblendeter Knoten |

#### Graph

| Schlüssel | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `GRAPH_START_ID_DEFAULT` | string | `""` | Standard-Startknoten-ID |

#### Debug-Parameter (Force-Simulation)

| Schlüssel | Typ | Default |
|-----------|-----|---------|
| `DEBUG_LINK_DISTANCE` | number | `30` |
| `DEBUG_LINK_STRENGTH` | number | `0.25` |
| `DEBUG_CHARGE_STRENGTH` | number | `-250` |
| `DEBUG_ALPHA_DECAY` | number | `0.05` |
| `DEBUG_VELOCITY_DECAY` | number | `0.5` |
| `DEBUG_NODE_RADIUS` | number | `16` |
| `DEBUG_NODE_STROKE_WIDTH` | number | `4` |
| `DEBUG_LABEL_FONT_SIZE` | number | `21` |
| `DEBUG_LINK_STROKE_WIDTH` | number | `4` |
| `DEBUG_ARROW_SIZE` | number | `16` |

### Konfiguration via JSON-Dateien

Kopiere `public/env.example.json` nach `public/env.json` und passe die Werte an:

```bash
cp public/env.example.json public/env.json
```

`env.json` überschreibt `config.json`. Beide Dateien verwenden dieselben Schlüssel (siehe Tabellen oben).

### Konfiguration via .env-Dateien

Erstelle eine `.env`-Datei im Projektroot. Alle Schlüssel müssen mit `VITE_` prefixed werden:

```env
VITE_DATA_URL=./data.sem-n.json
VITE_DATA_ATTRIBUTES_URL=./attr1.tsv,./attr2.tsv
VITE_TOOLBAR_LABELS_ACTIVE=attributes
VITE_TOOLBAR_PSEUDO_PASSWORD=Alles zeigen
```

> Arrays werden als komma-separierte Strings oder JSON-Arrays unterstützt.

### Runtime-Injection (ohne Rebuild)

Für Deployments, die Konfiguration zur Laufzeit benötigen (z.B. Docker, Server-seitiges Rendering):

```html
<script>
  window.__ORGGRAPH_ENV__ = {
    DATA_URL: './other-data.json',
    TOOLBAR_PSEUDO_ACTIVE: false
  };
</script>
<script type="module" src="/src/app.js"></script>
```

Runtime-injizierte Werte haben die zweithöchste Priorität (nach CLI/Build-Zeit-ENV).

## Projektstruktur

```
orggraph/
├── index.html                  # Haupt-HTML mit Toolbar, Legende, SVG-Canvas
├── vite.config.js              # Vite-Konfiguration
├── package.json
├── public/
│   ├── config.json             # Standard-Konfiguration (Layer 6)
│   ├── env.json                # Override-Konfiguration (Layer 5)
│   ├── env.example.json        # Vorlage für env.json
│   ├── data.sem-n.json         # Produktionsdaten
│   └── data.example.json       # Beispieldaten
├── src/
│   ├── app.js                  # App-Controller (Init, Routing, Event-Handling)
│   ├── constants.js            # DOM-Selektoren und Konstanten
│   ├── style.css               # Gesamtes Styling
│   ├── config/
│   │   └── env.js              # Configuration Precedence & Laden
│   ├── state/
│   │   └── store.js            # Zentraler GraphStore (Singleton, Event-basiert)
│   ├── data/
│   │   ├── loader.js           # Daten- und Attribut-Laden
│   │   ├── processor.js        # Datenverarbeitung (Nodes, Links)
│   │   ├── attributes.js       # Attribut-Parsing (TSV/CSV)
│   │   └── pseudonym.js        # Pseudonymisierungs-Daten
│   ├── graph/
│   │   ├── renderer.js         # D3 SVG-Rendering (Nodes, Links, Labels)
│   │   ├── simulation.js       # D3 Force-Simulation
│   │   ├── layout.js           # Hierarchie- und Force-Layout
│   │   ├── subgraph.js         # BFS-Teilgraph-Berechnung
│   │   ├── adjacency.js        # Adjazenz-Berechnung
│   │   ├── clusters.js         # Cluster-Erkennung
│   │   └── visibility.js       # Knoten-Sichtbarkeit
│   ├── ui/
│   │   ├── toolbar.js          # Toolbar-Steuerung
│   │   ├── legend.js           # OE- und Attribut-Legende
│   │   ├── search.js           # Suchfeld mit Autocomplete
│   │   ├── debug.js            # Debug-Panel (Force-Slider)
│   │   ├── export.js           # SVG/PNG-Export
│   │   ├── dialogs.js          # Modale Dialoge
│   │   ├── node-menu.js        # Knoten-Kontextmenü
│   │   ├── detail-panel.js     # Detail-Ansicht
│   │   ├── colors.js           # Farbpaletten
│   │   ├── icons.js            # SVG-Icons
│   │   ├── label-utils.js      # Label-Hilfsfunktionen
│   │   ├── legend-row.js       # Legenden-Zeilen-Komponente
│   │   ├── buttons.js          # Button-Hilfsfunktionen
│   │   ├── menus.js            # Menü-Hilfsfunktionen
│   │   └── tooltips.js         # Tooltip-Komponente
│   ├── services/
│   │   └── pseudonymization.js # Pseudonymisierungs-Service
│   └── utils/
│       ├── css.js              # CSS-Variablen & Graph-Parameter
│       ├── dom.js              # DOM-Hilfsfunktionen
│       └── logger.js           # Logging-Utility
└── tests/
    ├── fixtures.js             # Coverage-Fixture (immer importieren!)
    ├── _template.spec.js       # Vorlage für neue Tests
    ├── coverage.spec.js        # Basis-Coverage-Test
    └── person-search.spec.js   # Feature-spezifische Tests
```

## Datenformat

Die App erwartet eine JSON-Datei (konfigurierbar via `DATA_URL`) mit folgendem Format:

- **`persons`**: Array von Personen-Objekten
  - `id` (string, required): Eindeutige ID
  - `label` (string, required): Anzeigename
  - `email` (string, optional): E-Mail-Adresse
  - `isBasis` (boolean, optional): `true` = Person ohne Mitarbeiter (Blatt-Knoten)
- **`orgs`**: Array von Organisations-Objekten
  - `id` (string, required): Eindeutige ID
  - `label` (string, required): Name der Organisationseinheit
- **`links`**: Array von Beziehungen
  - `source` (string, required): Quell-ID
  - `target` (string, required): Ziel-ID
  - Typen: Person→Person (Vorgesetzter→Mitarbeiter), Person→Org (Mitgliedschaft), Org→Org (Hierarchie)

### Beispiel

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

> **Hinweis:** `isBasis: true` = Person ohne Mitarbeiter (Blatt-Knoten, wird bei aktiviertem Management-Filter ausgeblendet).

### Transform-Utility

Falls die Quelldaten ein anderes Format haben:

```bash
node transform.js input.json output.json
node transform.js --input source.json --output data.json
node transform.js --help
```

## Nutzung

- **Suchfeld**: Namen oder ID eingeben (min. 2 Zeichen)
  - Max. 100 Ergebnisse, Debounced (150ms)
  - **Shift+Klick/Enter**: Als weiteren Root hinzufügen
  - **Klick/Enter**: Ersetzt alle Roots
- **Tiefe**: Anzahl BFS-Stufen ab Startknoten (Stepper-Buttons)
- **Richtung**: Aufwärts/Abwärts/Beide (Split-Button)
- **Management**: Blendet Personen ohne Mitarbeiter aus
- **Hierarchie**: Wechselt zwischen Force- und Hierarchie-Layout
- **Labels**: Schaltet zwischen `all` → `attributes` → `none`
- **Zoom/Fit**: Passt den Graphen auf die Ansicht ein
- **Simulation**: Hält die Force-Simulation dauerhaft aktiv
- **Export**: SVG- oder PNG-Export mit wählbarer Auflösung
- **Pseudonymisierung**: Anonymisiert Namen (Passwort zum Aufheben konfigurierbar)
- **Debug**: Zeigt Force-Simulation-Slider für Feintuning

### Legende

- **OEs**: Organisationseinheiten ein-/ausblenden, filtern, alle an/abwählen
- **Attribute**: Attribut-Kategorien laden, expandieren, filtern
- **Ausgeblendet**: Temporär ausgeblendete Knoten verwalten

### Kontextmenü

Rechtsklick auf Personenknoten:
- **Ausblenden**: Blendet die Berichtslinie aus
- **Als Root entfernen**: Nur bei Multi-Root-Auswahl sichtbar

> Das Browser-Kontextmenü ist global unterdrückt.

## Testing

Die App verwendet Playwright für End-to-End-Tests mit Coverage-Tracking.

```bash
npm install
npx playwright install   # Browser-Binaries installieren
```

| Befehl | Beschreibung |
|--------|--------------|
| `npm test` | Alle Tests ausführen |
| `npm run test:coverage` | Tests mit Coverage-Report |
| `npm run test:ui` | Playwright UI Mode (interaktiv) |
| `npm run test:record` | Test-Recorder starten |
| `npm run test:file -- "name"` | Einzelnen Test ausführen |

### Tests aufzeichnen

1. Dev-Server starten: `npm run dev`
2. Recorder starten: `npm run test:record`
3. Interaktionen durchführen → Code kopieren
4. Kopiere `tests/_template.spec.js` → `tests/[feature].spec.js`
5. `page.goto('http://localhost:5173/')` → `page.goto('/')` ersetzen

### Coverage-Reports

Nach `npm run test:coverage`:
- **HTML-Report**: `coverage/index.html` (V8 Coverage)
- **LCOV-Report**: `coverage/lcov.info` (für VS Code Gutter)
- **Test-Report**: `coverage-report/index.html`

Für Coverage-Anzeige im VS Code die Extension "Coverage Gutters" installieren:
```json
{
  "coverage-gutters.coverageFileNames": ["coverage/lcov.info"]
}
```
