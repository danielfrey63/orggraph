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
sowie die `/* v8 ignore */`-Coverage-Marker. Mit `--no-bump` ist der Build
idempotent; ohne zählt er die Build-Nummer hoch (siehe Versionierung).

### Versionierung

Single Source of Truth für die App-Version ist das `version`-Feld in
`package.json` (Schema `MAJOR.MINOR.BUILD`). Der Build stempelt sie als
`@@VERSION@@` ins Template: sichtbar im Header neben dem Titel (`#appVersion`)
und als globale JS-Konstante `APP_VERSION` in `index.html`.

Das Hochzählen passiert automatisch (`bump-version.js`):

- **Build-Nummer** (drittes Segment): jeder `node build.js` zählt sie hoch.
  Ausnahme ist `--no-bump` für reproduzierbare Re-Builds — `verify.js`,
  `test:coverage` und der Pre-Commit-Hook nutzen das.
- **Minor** (zweites Segment): der Hook `.githooks/pre-commit` zählt sie bei
  jedem Commit hoch, setzt die Build-Nummer auf 0, baut `index.html` neu und
  staged beide Dateien mit.

Der Hook-Pfad wird via `prepare`-Script (`git config core.hooksPath .githooks`)
bei `npm install` gesetzt — nach einem frischen Clone einmal `npm install`
ausführen. **Major** wird bewusst nur manuell angehoben (direkt in
`package.json` editieren).

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
`data/env.example.json`). Sie kann auf zwei Wegen geladen werden:

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
  TSV/CSV/TXT) — explizite Auflistung einzelner Dateien
- **`DATA_ATTRIBUTES_DIR`**: Verzeichnis(se) mit Attributdateien (String oder
  Array). Alle TSV/CSV/TXT-Dateien darin werden geladen, ohne sie einzeln
  aufzulisten; kombinierbar mit `DATA_ATTRIBUTES_URL` (Duplikate werden
  übersprungen). Beim Import zählt die Verzeichnisstruktur des Drops; am
  Dev-Server wird das Directory-Listing des Servers ausgewertet (funktioniert
  z.B. mit `python -m http.server`, VS Code Live Server, nginx autoindex)
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
- **Attribute**: siehe eigene Sektion [Attribute](#attribute)

### Kontextmenü

- Rechtsklick auf Personenknoten öffnet ein kontextbezogenes Menü (Browser-Menü ist global deaktiviert):
  - „Ausblenden“: blendet die Berichtslinie dieser Management-Person aus
  - „Als Root entfernen“: nur sichtbar, wenn der Knoten aktueller Root ist und mindestens 2 Roots ausgewählt sind

Hinweis: Das Browser-Kontextmenü ist global unterdrückt, damit die App-eigenen Menüs konsistent funktionieren.

## Attribute

Attributdateien (`.tsv`/`.csv`/`.txt`) ordnen Personen Attribute zu — eine
Zeile pro Zuordnung: `identifier<TAB>attributname` (Identifier = E-Mail oder
Personen-ID; Komma statt Tab funktioniert ebenfalls). Der **Dateiname ohne
Endung** wird zur Kategorie: Die Attribut-Legende gruppiert hierarchisch nach
Kategorie → Attribut (mit Trefferzahl pro Attribut), die Farben sind innerhalb
einer Kategorie ähnlich und zwischen Kategorien klar unterscheidbar.

Geladen wird über die Env-Konfiguration — `DATA_ATTRIBUTES_DIR` (ganzes
Verzeichnis, keine Einzelauflistung nötig) und/oder `DATA_ATTRIBUTES_URL`
(explizite Dateiliste) —, per Drag & Drop oder über den Upload-Button im
Legenden-Header. Importierte Dateien landen in IndexedDB und werden beim
nächsten Start automatisch geladen. Leere Dateien registrieren eine Kategorie
als Platzhalter.

### Bedienung der Attribut-Legende

- **Attribut-Zeile anklicken**: Attribut an-/abwählen (zeichnet die farbigen
  Ringe um die Personen-Knoten).
- **Kategorie-Zeile**: Chevron klappt auf/zu; **Doppelhäkchen** wählt alle
  Attribute der Kategorie an/ab; **Auge** blendet die Kategorie temporär aus
  (ohne die Anwahl zu ändern); **Download** exportiert die Kategorie als TSV.
- **Header-Buttons**: Doppel-Chevron expandiert/kollabiert alle Kategorien;
  **Doppelhäkchen** wählt alle Attribute an/ab; **Trichter** schaltet den
  Attribut-Fokus (siehe unten); **Auge** schaltet die globale
  Attribut-Sichtbarkeit im Graph — **Shift+Klick** auf das Auge toggelt
  stattdessen die Sichtbarkeit aller Kategorien auf einmal, ohne den globalen
  Status anzufassen.

Pfeil-Endpunkte, Knotenabstände und Label-Positionen richten sich nach den
tatsächlich gezeichneten Ringen: Wird eine Kategorie ausgeblendet, rücken die
Pfeile entsprechend näher an den Knoten.

### Attribut-Fokus

Der Trichter-Button im Legenden-Header blendet alle Knoten aus, die weder
selbst ein sichtbares Attribut tragen noch auf dem Pfad (Manager,
Mitglieds-OEs, übergeordnete OEs) zu einem solchen liegen — es bleibt also
genau das Verbindungsgerüst zu den attributierten Personen stehen. «Sichtbar»
heisst: Attribut angewählt und Kategorie nicht per Auge ausgeblendet (das
globale Auge zählt bewusst nicht). Innerhalb der aktuellen Ansicht bleiben
exakt die attributierten Knoten plus die Verbindungspfade zum Root stehen —
Äste ohne attributiertes Ende (etwa weil die Suchtiefe, ein ausgeblendeter
Teilbaum oder der Management-Filter den attributierten Nachfahren entfernt)
werden ebenso gekappt wie unattributierte Knoten auf Zyklen (z.B.
Person-OE-Manager-Dreiecke). Jede Attribut-Änderung
berechnet die Ausblendung sofort neu. Der Zustand ist transient: keine
Einträge in der Hidden-Legende, nichts persistiert, Ausschalten stellt alles
wieder her; der Root-Knoten bleibt immer sichtbar.

### Attribute erstellen & speichern

Per Rechtsklick auf einen Personen-Knoten («Attribute») lassen sich bestehende
Attribute zuweisen sowie **neue Attribute und neue Kategorien** anlegen.
Geänderte Kategorien zeigen in der Legende einen **Speichern-Button**
(Diskette) — auch frisch im UI erstellte Kategorien.

Speichern wirkt zweistufig:

1. **IndexedDB**: Der aktuelle Stand der Kategorie wird unter dem Schlüssel
   der importierten Datei abgelegt und überlebt damit jeden Reload —
   unabhängig von der Festplatte.
2. **Festplatte**: In Browsern mit File System Access API (Chrome/Edge)
   öffnet sich ein Speichern-Dialog; das gewählte Datei-Handle wird pro
   Kategorie gemerkt, weitere Speichervorgänge überschreiben die Datei
   direkt ohne Dialog. Andere Browser erhalten einen normalen Download.

Gespeichert wird `identifier<TAB>attributname`; ein optionaler Attributwert
aus der Quelldatei (dritte Spalte, Default `1`) bleibt dabei erhalten —
Laden und Speichern sind verlustfrei.

### Fuzzy-Matching & gespeicherte Zuordnungen

Identifier ohne exakten Treffer durchlaufen beim Import eine Fuzzy-Suche
(Levenshtein über Namen und E-Mails). Gefundene Kandidaten werden in einem
Dialog zur Bestätigung angeboten; Einträge ohne Zuordnung werden als CSV
exportiert.

Alle Auflösungen werden in IndexedDB persistiert (`identifier → Personen-ID`
bzw. `null` für bestätigte Nicht-Treffer): Beim nächsten Reload werden sie
direkt angewendet — Fuzzy-Suche und Dialog laufen nur noch für neue
Identifier. Zeigt eine gespeicherte Zuordnung auf eine Person, die es im
aktuellen Datensatz nicht mehr gibt, wird der Identifier automatisch neu
aufgelöst. «Daten zurücksetzen» (Footer) löscht auch diese Zuordnungen; ein
erneuter Ordner-Drop behält sie.

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
- Styles: `src/styles.css` (u.a. `--root-node-fill` für die Füllfarbe der
  Root-Knoten und die `--attribute-circle-*`-Variablen für die Attributringe)
- Logik/Rendering: `src/sections/*.js` (Nummern-Präfix = Inlining-Reihenfolge)
- Transformation: `helpers/transform.js` (`npm run transform`)

Niemals `index.html` direkt editieren — sie ist Build-Output.
