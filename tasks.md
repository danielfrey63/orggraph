# Umsetzungsvorschläge für @[orggraph]

Basierend auf der bestehenden Struktur ([index.html](cci:7://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/index.html:0:0-0:0), [app.js](cci:7://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/app.js:0:0-0:0), [style.css](cci:7://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/style.css:0:0-0:0), [data.generated.json](cci:7://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/data.generated.json:0:0-0:0), [transform.js](cci:7://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/transform.js:0:0-0:0)) schlage ich eine schlanke, statische Lösung ohne neue Abhängigkeiten vor [SF][DM][ISA].

## 1) Dateiladen

- **[Default-Dummy-Daten]**
  - Datei `orggraph/data.default.json` mit minimalem, realistischem Demo-Datensatz (Personen, OEs, Links).
  - Inhalt ein 300 Nodes, 20 OEs, synthethisch, aber konsistent generiert.
  - Startverhalten: Wenn keine andere Quelle konfiguriert ist, wird diese Datei standardmäßig geladen [SF].
- **[Datei-Dialog]**
  - Button „Daten laden…“ + verstecktes `<input type="file" accept="application/json">`.
  - Clientseitiges Parsen via `FileReader`. Unterstützte Schemata:
    - Aktuelles Schema: `{ persons, orgs, links }`.
    - Legacy: `{ nodes, links }` (Personen/OEs werden typisiert; invalides wird sauber ignoriert) [REH].
  - Nach erfolgreichem Laden: [applyFromUI()](cci:1://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/app.js:990:0-1073:1) und „Auf Seite einpassen“ (optional per Auto-Fit) [RP].
- **[Beispiel-ENV]**
  - Datei `orggraph/env.example.json` (vom Nutzer nach `env.json` kopierbar) mit Feldern:
    - `DATA_URL` (z. B. `"./data.generated.json"` oder externer URL)
    - `DEFAULT_START_ID`, `DEFAULT_DEPTH`, `DEFAULT_DIR` (`"both"|"up"|"down"`), `DEFAULT_MANAGEMENT`, `DEFAULT_LABELS gelten nur für den initialen Load. Danach werden sie mit einem expliziten Laden einer Datendatei verworfen und der Baum Graph wird frisch initialisiert.`
    - `env.json` im selben Verzeichnis wie `index.html`
- **[Lade-Priorität]**
  - Reihenfolge zur Datenermittlung [REH]:
    1. **`?data=URL`**
    2. `env.json` → `DATA_URL`
    3. `data.default.json` (Dummy)
  - Daten können manuell geladene Datei (Datei-Dialog) und überschreiben alle vorher geladenen Daten.
  - Manuelles Laden setzt alle anderen Werte auf Defaults zurück.
  - Defaults nach manuellem Laden: Tiefe=2, Richtung=both, Management=on, Labels=on, Auto-Fit=on. `DEFAULT_*` aus `env.json` werden dabei nicht erneut angewandt.
  - Für externe Daten ist keine Authentifizierung vorgesehen.
  - Bei Fehlern wird auf bestehende bereits geladene Daten zurückgegriffen oder falls noch keine geladen sind, die Reihenfolge rückwärts durchsucht und geladen.

## 2) Attributierung

- **[Attribut-Datei laden]**
  - UI: „Attribut laden…“ (Datei) + Eingabe „Attributname“ + Farbwähler.
  - Unterstützte Formate [IV][REH]:
    - TXT: eine E-Mail pro Zeile oder mit Komma, Strichpunkt oder Leerschlag getrennt
  - Matching: case-insensitiv auf `person.email`. Ansonsten nur exakte Matches. Nicht gefundene werden gezählt und in `missing.txt` gespeichert und der User auf einfache Art und Weise informiert (Footer/Panel) [REH].
- **[Darstellung gematchter Knoten]**
  - Technisch: Für jedes aktive Attribut ein eigener SVG-Overlay-Layer mit Kreisen (gleiche Position wie Nodes), nur für gematchte Personen.
  - Optik: Deutlich sichtbarer Ring (z. B. `stroke` = Attributfarbe, `stroke-width` = 4–6 px, `fill` = `none`). Mehrere Attribute = mehrere konzentrische Ringe (pro Layer). Älteste innen, neuste aussen [RP].
  - Keine Beeinflussung der Suche. Auch nicht Suche über E-mails erweitern. Es reicht, wie es ist.
- **[Legende für Attribute]**
  - Neues Panel „Attribute“ (unterhalb OEs, kollabierbar):
    - Eintrag je Attribut: Farbbox, Attributname, Toggle (an/aus), Anzahl Treffer.
    - Klick auf Toggle blendet den jeweiligen Overlay-Layer ein/aus.
- **[Reporting nicht gefundener]**
  - Zusammenfassung: „Attribut X — N gefunden, M nicht gefunden“ im Footer-Status.
  - `missing.txt` wird nach dem Import automatisch als Download angeboten; zusätzlich wird ein Download-Link im Footer/Panel angezeigt.

## 3) Footer-Statistiken

- **[Neue Statuszeile]** (unter Beibehaltung von `#status`) mit dynamischen Kennzahlen:
  - Gesamt geladen: `Knoten`, `Kanten`, `OEs`
  - Sichtbar im aktuellen Subgraph: `Knoten`, `Kanten`
  - Cluster-OEs aktuell (Hüllen gezeichnet): Anzahl aus [refreshClusters()](cci:1://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/app.js:747:0-782:1)-Daten
  - Aktive OEs (in Legende aktiviert): `allowedOrgs.size`
  - Aktive Attribute (sichtbar): Liste der eingeschalteten Attribut-Namen
- Aktualisierung bei: initialem Laden, [applyFromUI()](cci:1://file:///d:/Meine%20Ablage/Akros/Kunden/SEM/Auftrag/orggraph/app.js:990:0-1073:1), OE-Toggles, Attribut-Toggles [DRY].

# Daten- und Attribut-Schema

- **[Graph-Schema]** (bestehend, bleibt bestehen) [ISA]:
  - `persons[]`: `{ id: string, label?: string, email?: string, hasSupervisor?: boolean }`
  - `orgs[]`: `{ id: string, label?: string }`
  - `links[]`: `{ source: string, target: string }` (gerichtet für Hierarchie, bidirektional ausgewertet in Subgraph)
- **[Attribut-Schema (intern)]** [CA]:
  - `attributes: Map<string, { color: string, emails: Set<string>, matchedIds: Set<string>, unmatched: string[], visible: boolean }>`
  - Normalisierung `email` → lowercased; Matching auf `person.email?.toLowerCase()` [IV].

# UI/UX-Änderungen

- **[index.html]**
  - Header Controls: Buttons „Daten laden…“, „Attribut laden…“, Eingabe „Attributname“, Farbwähler.
  - Hauptbereich: Neuer Abschnitt „Attribute“ mit legendärer Liste und Toggles (analog OE-Panel) [RP].
  - Footer: Erweiterte Statuszeile mit separaten `<span>`-Feldern für die Metriken [RP][DRY].
- **[style.css]**
  - Klassen für Attribute-Panel und Overlay-Ringe (z. B. `.attr-ring.layer-<idx>`), kompakt gehalten [SF].
- **[app.js]**
  - `loadDataFromUrl(url)`, `loadDataFromFile(file)`, `applyLoadedData(data, sourceName)`.
  - `loadEnvIfAny()` liest `env.json` und steuert `DATA_URL`.
  - Attribute-API: `loadAttributeFromFile(file, name, color)`, `toggleAttribute(name, visible)`, `renderAttributeOverlays()` [CA].
  - `updateFooterStats(subgraph)` berechnet und setzt Kennzahlen (inkl. Cluster-/OE-/Attribute-Zahlen) [DRY].

# Lade-Reihenfolge (finaler Vorschlag)

 - **Initial-Load (automatisch)**: `?data=URL` > `env.json` (`DATA_URL`) > `data.default.json` [REH][SF].
 - **Manuelles Laden**: ist keine Stufe der automatischen Kette; ersetzt die Daten jederzeit und setzt die UI auf Defaults zurück.
 - Hinweis: Das weicht bewusst von der älteren Notiz „kein Fallback“ ab; Ihr aktueller Wunsch nach Dummy-Default hat Priorität. Bestätigen Sie bitte diese Reihenfolge [TR].

# Edge Cases

- **Fehlendes `email`**: Personen ohne `email` werden beim Attribut-Matching übersprungen; zählen in „nicht gefunden“ [REH].
- **Ungültiges JSON/CSV**: Fehler-Toast und keine State-Änderung [REH].
- **Große Dateien**: Streaming nicht nötig; UI bleibt reaktiv durch einfache DOM-Updates [PA].
- **Mehrere Attribute auf einem Knoten**: Mehrere Ringe; Reihenfolge nach Einlade-Zeitpunkt [RP].
 - **Legacy `nodes[].type` fehlt oder unbekannt**: Typisierung per Heuristik (mit `email` ⇒ person, sonst org). Unbekannte/fehlerhafte `type`-Werte werden in `unknown-types.txt` gesammelt, als Download bereitgestellt (analog `missing.txt`), Verarbeitung läuft weiter.

# Akzeptanzkriterien

- **Default-Daten**: Ohne Aktion wird ein Dummy-Graph geladen; Startknoten-Suche funktioniert.
- **Datei-Dialog**: JSON-Datei laden aktualisiert Graph und Legenden.
- **ENV**: `env.json` mit `DATA_URL` steuert initiale Quelle.
- **Attribut-Import**: E-Mail-Liste laden, Name+Farbe vorschlagen und ändern, Treffer markiert (Ring), Nicht-Treffer ausgewiesen.
- **Attribute-Legende**: Toggle zeigt/versteckt Markierungen; Farbe entspricht Legende.
- **Footer**: Alle geforderten Metriken korrekt und aktualisieren sich nach UI-Aktionen.

# Geplante Dateien

- **`orggraph/data.default.json`** (Dummy-Daten)
- **`orggraph/env.example.json`** (Beispiel-ENV)
- `orggraph/attr-example.csv` (Beispiel-Attributliste)
