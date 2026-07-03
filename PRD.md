# PRD — OrgGraph 2.0: Typisierter Property-Graph

> **Status: Verbindlich (2026-07-02).** Dieses PRD ist die massgebliche Produkt- und Anforderungsspezifikation für den Umbau von OrgGraph auf einen typisierten Property-Graphen. Es ersetzt und integriert die Vorgänger-Dokumente `GRAPH-MODEL-SPEC.md` (Datenmodell) und `CRAWLING-SPEC.md` (Akquise). Das Alt-Format bleibt in [DATA-FORMAT-SPEC.md](DATA-FORMAT-SPEC.md) dokumentiert und ist nur noch Input des Einmal-Migrationsskripts (§10).

---

## 1. Produktübersicht

### 1.1 Vision

OrgGraph visualisiert Organisations-Wissen als interaktiven Graphen — offline, als einzelne HTML-Datei, ohne Server und ohne Laufzeit-Dependencies ausser D3. Heute kennt die App drei fest verdrahtete Begriffe (Person, Organisationseinheit, Attribut); künftig arbeitet sie auf einem **generischen, typisierten Property-Graphen (Labeled Property Graph, LPG)**: typisierte Knoten mit skalaren Eigenschaften, typisierte Kanten, Zeitdimension über Versionierung. Die Org-Hierarchie ist dann nur noch eine **Projektion (View)** über diesen Graphen — eine von beliebig vielen.

### 1.2 Anlass und Zielnutzer

Der SBB/SEM-Use-Case verlangt Entitäten, die heute als «Attribute» (farbige Ringe) abgebildet werden, in Wahrheit aber eigene, geteilte, traversierbare Objekte sind: Rollen, Teams, Trainings, Projekte, Gremien, Firmen, Standorte. Zielnutzer sind Analysten und Führungskräfte, die Organisationsdaten aus verschiedenen Quellen (AdminDir, Confluence, HR-Exporte) explorieren, vergleichen und über die Zeit verfolgen.

### 1.3 Leitentscheidungen

| # | Entscheidung | Datum |
|---|--------------|-------|
| E1 | Zielmodell = LPG; Reifizierung: alles Geteilte wird Knoten, echte Skalare bleiben `props` | 2026-06 |
| E2 | Hierarchie = Projektion; Ordnung = BFS-Distanz entlang designierter Hierarchie-Kanten | 2026-06 |
| E3 | Abfrage über deklarative JSON-Selektoren (Views), bewusst **kein GraphQL**; später allenfalls kleines GQL/openCypher-Subset | 2026-06 |
| E4 | Zeit: datierte Voll-Snapshots als Input, intern Validity-Intervalle; Modi `asOf` und `diff` | 2026-06 |
| E5 | Mehrfach-Eltern: eine Knoteninstanz, alle Eltern-Kanten vollwertig gezeichnet, flachste Hierarchie-Kante bestimmt die Ordnung | 2026-07 |
| E6 | **Volle Versionierung** von Knoten, Kanten und Properties: Intervall pro props-Stand (§5) | 2026-07 |
| E7 | Kontext+Rolle-Relationen doppelt reifiziert; Bindung der ternären Relation als **typisierte Knoten-Referenz-Property** auf der Kante (§4.5) | 2026-07 |
| E8 | Typ-Registry = kuratierte Repo-Datei `schema/registry.json` | 2026-07 |
| E9 | Umsetzung als **Big Bang**: Datenmodell und Rendering in einem Zug, kein Adapter-Pfad | 2026-07 |
| E10 | Migration Alt→Neu über ein **separates Einmal-Skript**, kein Legacy-Import in der App (App war nie distribuiert) | 2026-07 |
| E11 | **Knotentypen sind generisch**: Engine typ-agnostisch, Typ-Verhalten deklarativ über Registry-Capabilities (§4.2) | 2026-07 |
| E12 | Bestehende UI-Elemente, Algorithmen und Konfigurationen werden übernommen; Layout-Algorithmen bleiben identisch (§9) | 2026-07 |
| E13 | Darstellung (Farben, Icons) ist keine Typ-Konfiguration: nicht in der Registry, nicht in env.json — die Farbstrategie folgt deterministisch dem Render-Modus der View (§4.2, FR-4.2a) | 2026-07 |
| E14 | Alle konkreten Typ-, Kanten- und View-Nennungen im PRD sind **Illustrationen**, kein Implementierungsauftrag; verbindlich ist allein, was über Phase A + Gate in die Registry gelangt (FR-6.1a) | 2026-07 |
| E15 | Kanten-Identität = `type`+`source`+`target` **plus** die im Schema deklarierten `identityProps` (z. B. `kontext`) — sonst kollidieren gleichzeitige gleiche Rollen bei verschiedenen Firmen (FR-5.2) | 2026-07 |
| E16 | Umsetzungsweg: vollständige Neuerstellung auf separatem Branch, als Goal-Loop gegen die Akzeptanzkriterien (§13) getrieben; Tech-Stack unverändert (§1.5) | 2026-07 |
| E17 | Kantenrichtung: Kanten zeigen **vom Untergeordneten zum Übergeordneten** (Namen lesen sich als Satz); Baum-Abstieg traversiert gegen die Kantenrichtung; Legacy-Richtungen werden bei der Migration normalisiert (FR-7.2a) | 2026-07 |
| E18 | **Hierarchie ist ausschliesslich ein View-Konzept**: kein `hierarchy`-Flag in der Registry; die View definiert allein, was den Baum aufspannt. Fehlt `VIEWS`, gibt es keine Hierarchie — und **nie** einen Full-Graph-Render, nur eine root-begrenzte Diagnose-Projektion (§7) | 2026-07 |
| E19 | View-Definition als **Pfad-Ausdruck** (FR-7.1a): ersetzt `edgeTypes`/`hierarchyEdges`/`visibleNodeTypes`/`render`; Hierarchie aus der Pfad-Reihenfolge; Pfeile = gespeicherte Kantenrichtung; runde Klammern = Verzweigungen, eckige = Render-Modus; Selbst-Hops implizit transitiv; `[hidden]` kontrahiert zu abgeleiteten Kanten | 2026-07 |
| E20 | Snapshot-Input ist **roh und unversioniert**: keine `validFrom`/`validTo` in Snapshot-Dateien; Validity-Intervalle sind ausschliesslich interne Store-Darstellung und entstehen beim Import (FR-3.6, FR-5.1) | 2026-07 |
| E21 | Ring-Attachment explizit: `ring:prev`/`ring:next` bestimmen die sichtbare `node`-Station, an welcher der Badge hängt; `[ring]` = Alias für `[ring:prev]`; `[hidden]`-Stationen sind nie Attachment-Ziel (FR-7.1a, FR-7.3) | 2026-07 |
| E22 | Der **Richtungs-Toggle entfällt** (`TOOLBAR_DIRECTION_DEFAULT` inklusive): Die Richtungs-Semantik ist vollständig im View-Pfad kodiert — ein Laufzeit-Richtungs-Parameter hat im Pfadmodell keine Funktion mehr (FR-8.10, §9.4) | 2026-07 |
| E23 | **Rendering ist reaktiv**: Jede Parameter-Änderung (View, Roots, Tiefe, Zeitstand, Filter) löst das Rendering direkt aus; der «Anzeigen»-Button entfällt, der permanente «Animation fortsetzen»-Button bleibt (FR-8.11) | 2026-07 |
| E24 | **Ein einheitliches Kontextmenü** für Graph-Knoten und Legenden-Rows: dieselbe typunabhängige Aktionsliste, kontextabhängig deaktivierte Einträge — ersetzt die zwei getrennten Menüs der heutigen App (FR-8.7) | 2026-07 |
| E25 | Import-Eingang **ausschliesslich** über Dropzone und Dateidialog; der versteckte Footer-Status-Klick zum Datei-Laden entfällt. Akzeptierte Dateiklassen: Snapshot, `env.json`, Pseudo-Daten, ZIP daraus — Legacy-Formate werden mit Migrationshinweis abgewiesen (FR-6.7) | 2026-07 |
| E26 | Akquise = **Chrome-Konsolen-Harvesting** ausserhalb der Viewer-App: read-only Skripte in der DevTools-Konsole der Quelle, versioniert unter `data/crawling/`; die App importiert nur fertige Snapshots. NFR-5 gilt für den Viewer-Engine-Code, nicht für das Akquise-Tooling (§6.1) | 2026-07 |
| E27 | **Phase A ist LLM-frei und deterministisch**: generischer Analyse-Kern + dünner Provider-Adapter erzeugen einen neutralen, evidenzbasierten **Source Contract** (`schema/analysis.schema.json`) — keine Typentscheide; Registry-Abgleich rein mechanisch; Semantik erst im Gate (FR-6.1d) | 2026-07 |
| E28 | **`harvest-spec.json` ist das normative Gate-Artefakt**; `phase-b-harvest.js` wird daraus in Phase A.5 erstellt und referenziert die Spec-Version — bei Widerspruch gilt die Spec; Phase B ist reine Ausführung, keine erneute Quell-Interpretation (FR-6.1c) | 2026-07 |
| E29 | **Interne Zeitwahrheit ist der Snapshot-Instant** (`YYYYMMDD-HHMM` aus `meta.snapshot`): `validFrom`/`validTo` speichern diesen Instant, `asOf`/`diff` arbeiten intern darauf; die UI darf Daten anzeigen, muss bei mehreren Snapshots pro Tag aber den vollen Stempel anbieten (FR-5.2a) | 2026-07 |

### 1.4 Nicht-Ziele

- Kein Server, keine Datenbank ausser IndexedDB im Browser, keine Build-Dependencies zur Laufzeit.
- Kein GraphQL und keine Ad-hoc-Query-Sprache in v1.
- Kein Legacy-Import (altes `data.json` / Attribut-TSV) in der App — das leistet einmalig das Migrationsskript (§10).
- Kein Speichern benutzerdefinierter Views in v1 (vorgemerkt für v2, §12).

### 1.5 Umsetzungsweg

Big Bang (E9) ist die **Release-Strategie** — es gibt keinen Adapter-Pfad und keinen Parallelbetrieb in `main`. Der Weg dorthin ist eine **vollständige Neuerstellung auf einem separaten Branch** (E16): gleicher Tech-Stack wie heute (dependency-freies Vanilla JS + D3, Sections-Single-File-Build, IndexedDB), getrieben als **Goal-Loop** — implementieren, gegen die Akzeptanzkriterien (§13) und das Übernahme-Inventar (§9) prüfen, nachbessern — bis alle Kriterien erfüllt sind; erst dann wird der Branch nach `main` übernommen.

Aus den Akzeptanzkriterien ergibt sich die **Implementierungsreihenfolge** des Goal-Loops: **(1)** JSON Schemas, Pfad-Parser (FR-7.1a) und Import/Diff-Kern (§5, §6.3) — das Fundament aller weiteren Kriterien (AK 11, 4–6, 13); **(2)** Registry-Bootstrap-Gate für die Legacy-Migration (FR-10.1) — ohne ersten Registry-Commit kann kein Migrations-Snapshot valide sein; **(3)** Einmalmigration (§10), damit der SEM-Referenzbestand als Testdatensatz bereitsteht (AK 12); **(4)** View-Projektion (§7); **(5)** Rendering, Legenden und Interaktion (§8, §9; AK 1–2, 7–9, 14); **(6)** Zeit-/Diff-UI (FR-8.6; AK 4, 10). Jede Stufe wird gegen die zugehörigen Akzeptanzkriterien geprüft, bevor die nächste beginnt.

### 1.6 Normativität und Konfliktauflösung

Bei Widersprüchen zwischen den Artefakten gilt die Rangfolge: **PRD** (dieses Dokument) **> JSON Schemas** (`schema/*.schema.json`) **> Beispiele** (`schema/registry.example.json` und alle als Illustration markierten Nennungen, E14). Ein Widerspruch ist immer ein Fehler und wird am niederrangigen Artefakt korrigiert; Schemas dürfen strenger prüfen, als das PRD beschreibt, aber nichts erlauben, was das PRD ausschliesst. [DATA-FORMAT-SPEC.md](DATA-FORMAT-SPEC.md) ist klar markierte **Legacy-v1-Referenz** ausschliesslich für das Migrationsskript (§10) und hat für OrgGraph 2.0 keine normative Kraft; das wiederverwendbare Snapshot-Format ist kompakt in [SNAPSHOT-FORMAT-SPEC.md](SNAPSHOT-FORMAT-SPEC.md) beschrieben — massgeblich bleiben §3 und `schema/snapshot.schema.json`.

Zur Dokumentgrenze: Dieses Dokument ist bewusst zugleich Produktanforderung, Datenmodellvertrag und technische Umsetzungsspezifikation für den Big-Bang-Umbau. Reine Implementierungsdetails bleiben offen, sofern sie nicht für Datenkompatibilität, Akzeptanz oder Migration relevant sind (§14.3 ist ein Beispiel für einen bewusst offenen Implementierungsentscheid).

---

## 2. Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| Knoten / Kante | Typisierte Entität bzw. typisierte gerichtete Beziehung im Graphen. |
| Registry | Kanonische, kuratierte Typ-Deklaration (`schema/registry.json`); einzige Quelle der Wahrheit für Typen. |
| Snapshot | Datierter Vollstand eines Crawls innerhalb eines deklarierten Scopes. |
| Version | Datensatz eines Knotens/einer Kante mit einem props-Stand und einem Validity-Intervall. |
| View | Deklarativer Selektor, der aus dem Gesamtgraphen einen darstellbaren, geordneten Teilgraphen projiziert. |
| Tenant / Profil | Mandant mit eigenem IndexedDB-Object-Store; enthält Graph, Snapshots-Registry und Konfiguration. |
| Identität | Eindeutiger Knoten (`id`) bzw. eindeutige Kante (`type`+`source`+`target`+`identityProps`) — zeitlos, über alle Versionen hinweg dieselbe. |
| Versionsrecord | Ein Record-Stand einer Identität mit Validity-Intervall (FR-5.2); eine Identität hat einen oder mehrere Versionsrecords. |
| Sichtbare Projektion | Der von einer View aus dem Bestand projizierte, gerenderte Teilgraph (roots, Tiefe, Typen, Zeitschnitt). |
| Source Contract | Deterministisch erhobener Analyse-Report einer Quelle (Phase A): Endpunkte, Selektoren, ID-Regeln, Wertestatistiken, Kandidaten — nur Evidenz, keine Typentscheide (FR-6.1d). |
| Harvest-Spezifikation | Normatives Gate-Artefakt `harvest-spec.json` pro Provider: Quellenzugriff, Mapping, Crawl-Strategie; Grundlage des Phase-B-Skripts (FR-6.1c). |

Alle Mengenangaben in diesem PRD verwenden diese drei Ebenen: Bestandsgrössen zählen **Identitäten**, Speichergrenzen zählen **Versionsrecords**, Render-Grenzen zählen die **sichtbare Projektion**.

---

## 3. Datenformat (Snapshot)

Ein Snapshot ist eine JSON-Datei mit vier Blöcken:

```json
{
  "meta":   { "source": "…", "crawledAt": "2026-06-18T15:00", "snapshot": "20260618-1500", "registryVersion": "…", "scope": { … } },
  "schema": { "nodeTypes": { … }, "edgeTypes": { … } },
  "nodes":  [ … ],
  "edges":  [ … ]
}
```

**FR-3.1** `meta` trägt Provenienz: Quelle, Crawl-Zeitpunkt, Snapshot-Stempel `YYYYMMDD-HHMM`, die verwendete Registry-Version (FR-6.1b) und den Scope (§6.2). Knoten/Kanten dürfen zusätzlich `props.source` führen.

**FR-3.2** Knoten: `id` (eindeutig über alle Knoten, typ-übergreifender ID-Raum), `type` (in `schema.nodeTypes` deklariert), `label` (der **kanonische, versionierte Default-Anzeigename** — im Snapshot immer vorhanden; Auflösungsregel FR-4.2b), optional `props` (skalare Eigenschaften, FR-4.5).

**FR-3.3** Kanten: `type` (explizit, in `schema.edgeTypes` deklariert — nie aus Endpunkten abgeleitet), `source`, `target` (Knoten-IDs), optional `props`.

**FR-3.4** Das Dataset-`schema` ist eine **Teilmenge der Registry**: nur die tatsächlich verwendeten Typen. `edgeTypes` deklarieren `from`/`to` (erlaubte Endpunkt-Typen, `"*"` = beliebig). Ein Hierarchie-Flag gibt es bewusst nicht — Hierarchie ist ein reines View-Konzept (E18).

**FR-3.5** IDs sind **stabil** (Quell-PK, URL-ID, E-Mail; notfalls `slug(label)` mit `props.idSource='name'`) — Voraussetzung für Diff und Versionierung.

**FR-3.6** Snapshots sind **roh und unversioniert** (E20): Sie enthalten keine `validFrom`/`validTo` — Validity-Intervalle sind interne Store-Darstellung und entstehen ausschliesslich beim Import (FR-5.1); auch das Migrationsskript (§10) liefert pro Quellstand einen rohen, datierten Snapshot. Das Snapshot-Format ist maschinenprüfbar definiert in [`schema/snapshot.schema.json`](schema/snapshot.schema.json) (inkl. `meta.scope`) und kompakt beschrieben in [SNAPSHOT-FORMAT-SPEC.md](SNAPSHOT-FORMAT-SPEC.md); die Import-Validierung (FR-6.8) prüft dagegen. Views sind analog in [`schema/view.schema.json`](schema/view.schema.json) definiert.

---

## 4. Typsystem

### 4.1 Kanonische Registry

**FR-4.1** Die Registry lebt als kuratierte, versionierte Repo-Datei `schema/registry.json`. Crawler und Builder importieren sie und mappen hinein; neue Typen entstehen ausschliesslich über das Analyse-Gate der Akquise (§6) plus Commit. Kein Harvester erfindet eigenmächtig Typen. Das Registry-**Format** ist verbindlich definiert als JSON Schema in [`schema/registry.schema.json`](schema/registry.schema.json); ein illustratives Beispiel (E14) liegt in [`schema/registry.example.json`](schema/registry.example.json). Die Datei `schema/registry.json` existiert von Anfang an, startet aber **leer** (Version `0`, keine Typen) und wird ausschliesslich über Gate-Commits gefüllt (Registry-Bootstrap FR-6.1a).

> **Illustration, nicht normativ (E14).** Die folgenden Typenlisten zeigen, was aus den bisherigen SBB/SEM-Analysen voraussichtlich hervorgeht — sie dienen in diesem PRD durchgehend als Beispielmaterial und sind **kein Implementierungsauftrag**. Es gibt keine im Code oder im PRD fixierte Typenliste; verbindlich ist ausschliesslich der jeweilige Stand von `schema/registry.json`, der über Phase A + Gate entsteht und wächst (FR-6.1a).

Beispiel-Knotentypen: `Person`, `OE`, `AufbauOrg`, `Rolle`, `Team`, `Gremium`, `Training`, `Projekt`, `Firma`, `Standort`, `Gebäude`.

Beispiel-Kantentypen:

| Typ | from → to |
|-----|-----------|
| `unterstellt` | OE → OE |
| `mitgliedIn` | Person → OE |
| `berichtetAn` | Person → Person |
| `leitet` | Person → OE |
| `vertritt` | Person → OE |
| `gehoertZu` | Person → AufbauOrg |
| `hatRolle` | Person → Rolle (`props.kontext` referenziert den Firma-Knoten, §4.5) |
| `arbeitetBei` | Person → Firma |
| `imTeam` | Person → Team |
| `imGremium` | Person → Gremium |
| `besuchte` | Person → Training |
| `arbeitetAn` | Person → Projekt |
| `amStandort` | Person/OE → Standort |
| `imGebäude` | Person → Gebäude |

Ein Hierarchie-Flag gibt es in der Registry bewusst nicht (E18): Der Graph ist gerichtet, die Richtungs-Konvention (FR-7.2a) gilt pro Kantentyp — aber **welche** Kantentypen einen Baum aufspannen, bestimmt allein der Pfad-Ausdruck der View (FR-7.1a).

### 4.2 Generische Knotentypen (Capabilities)

**FR-4.2** Die App-Engine ist **vollständig typ-agnostisch**: Im Applikationscode kommt kein Typname (`Person`, `OE`, …) vor. Alles typ-spezifische Verhalten wird deklarativ über **Capabilities** am Registry-Eintrag konfiguriert. Ein neuer Knotentyp ist damit reine Datenpflege — kein Code.

Beispiel (illustrativ, E14):

```json
"nodeTypes": {
  "Person": {
    "labelProp": "label",
    "identifiers": ["id", "props.email"],
    "leafProp": "isBasis",
    "pseudonymize": { "pool": "names" }
  },
  "OE": {
    "pseudonymize": { "pool": "orgUnits", "byLevel": true }
  },
  "Rolle": {}
}
```

| Capability | Ersetzt heutiges Hardcoding | Wirkung |
|------------|------------------------------|---------|
| `labelProp` | `label`-Feld fix | Welche Eigenschaft als Anzeigename dient (`label` oder skalarer `props.*`-Pfad; Auflösungsregel FR-4.2b). |
| `identifiers` | Fuzzy-Suche über `id`/`email`/`label` fix auf Personen | Suchbare/matchbare Identifikatoren des Typs (Suche, Import-Abgleich). |
| `leafProp` | Management-Filter über `isBasis` fix auf Personen | Boolesche Eigenschaft, die Blatt-Knoten markiert; der Blatt-Filter der Toolbar blendet sie typunabhängig aus. |
| `pseudonymize` | `names[]` (Person) / `organizationalUnits{level}[]` (OE) fix | Pseudonym-Pool pro Typ, optional level-abhängig; Typen ohne Capability werden nicht pseudonymisiert. |

**FR-4.2a Darstellung ist keine Typ-Konfiguration (E13).** Farben und Icons gehören weder in die Registry (sie ist der providerübergreifende Datenvertrag, keine Präsentationsschicht) noch in `env.json`. Die Farbstrategie folgt deterministisch dem **Render-Modus der View**: `node` → Level-Verlauf nach BFS-Ordnung (heutiges `getNodeFillByLevel`), `cluster` → Hash-Farbe aus der ID (heutiges `colorForOrg`), `ring` → quantisierter Kategorie-Hue aus dem Typnamen mit Shift pro Knoten (heutige Attribut-Farben). Die bestehenden Farb-Algorithmen bleiben unverändert; es gibt nichts zu konfigurieren. Tooltips und Legenden verwenden den Typnamen aus der Registry statt fester Emojis oder Icons.

**FR-4.2b Label-Auflösung.** `label` ist der kanonische, versionierte Default-Anzeigename jedes Knotens und muss im Snapshot immer vorhanden sein (FR-3.2). `labelProp` ist optional und darf auf `label` oder einen skalaren Pfad wie `props.displayName` zeigen; fehlt `labelProp`, gilt `label`. Zeigt `labelProp` auf einen nicht vorhandenen oder nicht-skalaren Wert, fällt die Anzeige auf `label` zurück und der Import meldet eine Warnung (FR-6.8). Der so aufgelöste Anzeigename ist der **einzige** Anzeigename — Suche, Tooltip, Legenden, Export und die Auflösung von Referenz-Properties verwenden ihn einheitlich; die Pseudonymisierung (FR-8.5) ersetzt ihn an allen Ausgabestellen.

**FR-4.3** Render-Modi sind View-Sache (§7), nicht Typ-Sache: derselbe Typ kann in einer View `node`, in einer anderen `ring` sein.

### 4.3 Reifizierungsregel

**FR-4.4** Eigene Identität / von mehreren geteilt / traversierbar → **Knoten** (`id`+`type`), verbunden über Kante. Einzelwert, genau einer Entität, nie Gruppen- oder Traversal-Ziel → **skalare Eigenschaft** in `props`. Empirisch belegt an SBB-GD: AufbauOrg-Code (geteilt) → Knoten; Beschäftigungsgrad (numerisch) → `props.pensum`; Mobilnummer (unique) → `props.mobil`.

### 4.4 Eigenschaften (`props`)

**FR-4.5** Skalare Werte, verlustfrei gespeichert, versioniert (§5). Normativ: Jeder `props`-Wert ist ein JSON-Skalar (`string`, `number`, `boolean`, `null`) oder eine deklarierte Knoten-Referenz-ID als `string` — **Arrays und verschachtelte Objekte sind in v1 unzulässig** (das Snapshot-Schema erzwingt dies); mehrwertige fachliche Information wird als Knoten/Kanten reifiziert (§4.3), Bedarf an Array-Properties wäre ein v2-Ausbau über deklarierte Property-Typen. Wirkung entfalten `props` nur über Capabilities (`leafProp`, `identifiers`, `labelProp`) oder Anzeige (Tooltip, Label-Modus «attributes»). Einzige Ausnahme vom Skalar-Prinzip: im Schema deklarierte Knoten-Referenz-Properties (FR-4.7).

### 4.5 Ternäre Relationen (Kontext+Rolle) und Knoten-Referenz-Properties

**FR-4.6** Relationen der Form «Person × Rolle × Firma» werden **doppelt reifiziert**: Firma-Knoten (dedupliziert) über `arbeitetBei`, Rolle-Knoten (dedupliziert) über `hatRolle`, und die Bindung liegt als **Knoten-Referenz-Property** `props.kontext` (Wert = **ID** des Firma-Knotens, nicht dessen Label) auf der `hatRolle`-Kante. Damit sind beide Richtungen abfragbar: «alle Personen mit Rolle X» (Traversal über den Rolle-Knoten, firmenübergreifend) und «wer arbeitet in welcher Rolle bei Firma Y» (Traversal über den Firma-Knoten bzw. Filter auf die Referenz).

**FR-4.7 Knoten-Referenz-Properties (generischer Mechanismus).** Eine Kanten- oder Knoten-Property kann im Schema als **Referenz auf einen Knotentyp** deklariert werden, z. B. `"hatRolle": { "from": "Person", "to": "Rolle", "props": { "kontext": { "ref": "Firma", "implies": "arbeitetBei" } } }` (illustrativ, E14). Der Wert ist dann eine Knoten-ID; der Import validiert Existenz und Typ des Ziels (FR-6.8). Die Engine behandelt Referenz-Properties als auflösbar: Anzeige über das Label des referenzierten Knotens (inkl. Pseudonymisierung), Filter/Suche über den Zielknoten. Abgrenzung: Eine Referenz-Property ist ein gerichteter Verweis, **keine dritte Kante** — sie hat nie Ordnungs- oder Hierarchie-Wirkung und wird im BFS nicht traversiert. Braucht eine Relation mehr (mehr als drei Stellen, eigene Versionshistorie oder eigene Kanten an der Relation selbst), wird sie stattdessen als Zwischenknoten voll reifiziert (Eskalationspfad; Entscheid am Gate).

**FR-4.8 Konsistenz durch Konstruktion (implizierte Kanten).** Die Doppel-Reifizierung ist redundant — die Basis-Kante (`arbeitetBei`) ist aus der Referenz-Property ableitbar. Diese Redundanz wird nicht unabhängig gepflegt, sondern **deterministisch materialisiert**: Quellen (Crawler, Migrationsskript) schreiben nur den Primärfakt (die Kante mit der Referenz-Property); deklariert das Schema `implies`, erzeugt der Import die implizierte Kante automatisch mit **identischem Validity-Intervall** (idempotent — existiert sie schon, passiert nichts). Invariante, die der Import prüft (FR-6.8): Zu jeder zu T gültigen Kante mit Referenz-Property auf Ziel F existiert eine zu T gültige implizierte Kante desselben Quellknotens zu F; Widersprüche (unabhängig gelieferte, abweichende Stände) werden gemeldet, nicht still korrigiert. Die Umkehrung ist bewusst nicht gefordert — die Basis-Kante darf allein stehen (z. B. Firmenzugehörigkeit ohne bekannte Rolle).

---

## 5. Zeitmodell und Versionierung

**FR-5.1** Input sind **datierte Voll-Snapshots** (§3); das interne Modell sind **Validity-Intervalle**: Der Import (§6.3) difft jeden neuen Snapshot gegen den aktuellen Stand und schreibt Versionen fort.

**FR-5.2 Volle Versionierung von Knoten, Kanten und Properties.** Eine Version = ein **Record-Stand** mit Intervall `validFrom`/`validTo` (`null` = offen). Der Record-Stand umfasst `label` **und** `props` (beides ist versioniert); `id` und `type` sind dagegen **identitätsfest** — ein Typwechsel wäre eine neue Identität, kein Versionswechsel. Der Graph darf pro Identität mehrere Versionen mit disjunkten Intervallen enthalten: Knoten-Identität = `id`; Kanten-Identität = `type`+`source`+`target` **plus** die im Schema des Kantentyps deklarierten `identityProps` (E15) — typischerweise Referenz-Properties wie `kontext`, damit dieselbe Person dieselbe Rolle gleichzeitig bei zwei Firmen haben kann, ohne dass die Kanten zur selben Identität verschmelzen. Ändert sich irgendein Property-Wert (auch `label`), wird die offene Version geschlossen und eine neue eröffnet. Die vollständige Property-Historie (z. B. Pensum-Verlauf) ist damit aus der Versionsfolge rekonstruierbar; der Diff-Modus weist Änderungen auf **Property-Granularität** aus.

```json
{ "id": "p-1", "type": "Person", "label": "Anna Müller", "props": { "pensum": 80 }, "validFrom": "20250828-1500", "validTo": "20260201-0800" }
{ "id": "p-1", "type": "Person", "label": "Anna Müller", "props": { "pensum": 100 }, "validFrom": "20260201-0800", "validTo": null }
```

**FR-5.2a Zeitgranularität (E29).** Interne Zeitwahrheit ist der **Snapshot-Instant**: der minutenpräzise Stempel `YYYYMMDD-HHMM` aus `meta.snapshot`. `validFrom` und `validTo` speichern genau diesen Instant; `asOf` und `diff` arbeiten intern auf Instants — damit sind auch mehrere Snapshots am selben Tag eindeutig geordnet und reproduzierbar (die chronologische Importregel FR-6.9 ist ohnehin minutenpräzise). Die UI darf für einfache Fälle ein Datum anzeigen; liegen mehrere Snapshot-Stände am selben Tag vor, bietet sie den vollständigen Stempel zur Auswahl an. `view.schema.json` akzeptiert für `time` entsprechend Datum, ISO-Date-Time oder Snapshot-Stempel (Datum wird als Tagesbeginn interpretiert).

**FR-5.3** Zwei gleichwertige Zeitmodi der View: **`asOf`** (Stichtag-Slider; gerendert wird pro Identität die zu T gültige Version, `validFrom ≤ T < validTo`) und **`diff`** (T1→T2; Hervorhebung **neu** / **weggefallen** / **geändert**, letzteres mit Property-Diff im Tooltip).

**FR-5.4** Zeit ist orthogonal zu Mandanten: Profil = Tenant (eigener IndexedDB-Store), Snapshot = Zeit. Alle Zeitstände eines Mandanten liegen in dessen Store.

### 5.1 Signalisierung von Wegfall und Änderung (Lösungsvorschlag, entschieden umzusetzen)

Die ungelöste Frage «Wie signalisieren wir beim erneuten Crawl, dass ein Knoten, eine Kante oder ein Property nicht mehr vorhanden oder geändert ist?» wird über **Scope-deklarierte Vollstands-Semantik** gelöst — ohne explizite Löschmarker (Tombstones) im Datenformat.

Arbeitsteilung: Der **Crawler liefert immer einen Vollstand** seines Scopes und berechnet selbst kein Delta (er kennt den Stand des App-Stores nicht; ein Vollstand ist zudem idempotent und robust gegen Abbrüche). Der **Import macht daraus Create/Update/Delete**: Der erste Import ist die Basis, jeder weitere Snapshot wird gegen den aktuellen Store gedifft und schreibt die Versionen fort (FR-5.6). Der Store hält damit **einen** fortgeschriebenen, versionierten Graphen — nicht N unabhängige Stände; die Snapshot-Dateien unter `data/<tenant>/sources/` sind nur Rohdaten-Archiv und Provenienz.

**FR-5.5 Scope-Deklaration.** Jeder Snapshot deklariert in `meta.scope`, wofür er ein Vollstand ist: `{ "nodeTypes": […], "edgeTypes": […], "roots": […]?, "excluded": […]? }`. `roots` begrenzt optional auf Teilbäume (z. B. nur SEM-Subtree, nicht die ganze Bundesverwaltung); `excluded` listet Bereiche, die der Crawler nicht vollständig erfassen konnte.

**FR-5.5a Scope-Membership (formale Definition).** «War im Scope» bestimmt der Import ausschliesslich auf dem **Bestand vor dem Import**, nach diesen Regeln: (1) **Knoten:** Ohne `roots` ist ein Bestandsknoten im Scope, wenn sein Typ in `scope.nodeTypes` liegt; mit `roots` zusätzlich nur, wenn er von einem der `roots` über Bestandskanten der in `scope.edgeTypes` deklarierten Typen erreichbar ist — traversiert wird einheitlich **gegen die Kantenrichtung** (`target` → `source`), also von der Wurzel abwärts gemäss Richtungs-Konvention FR-7.2a. (2) **Kanten:** Eine Bestandskante ist im Scope, wenn ihr Typ in `scope.edgeTypes` liegt UND ihr `source`-Knoten im Node-Scope ist — der Kanten-Scope hängt am Quellknoten, nicht am Ziel; so schliesst ein Enrichment-Crawl (z. B. nur Trainings-Zuordnungen) verschwundene Kanten seiner erfassten Personen, ohne die Zielknoten anzutasten. (3) **`excluded`:** Knoten-IDs, die als ausgeschlossene Teilbaum-Wurzeln gelten — sie selbst und alles, was nur über sie erreichbar ist, fällt aus dem Scope. (4) **Referenzierte Bestandsknoten:** Snapshot-Kanten und Referenz-Properties dürfen auf Knoten ausserhalb des Scopes zeigen (FR-6.8 validiert gegen Snapshot ∪ Bestand); solche Ziele bleiben unberührt. Lösch-Kandidaten sind genau die Bestand-Identitäten, die nach (1)–(3) im Scope liegen und im Snapshot fehlen.

**FR-5.6 Diff-Regeln beim Import.** Pro Identität im Scope: (a) neu im Snapshot → neue Version mit `validFrom = instant(t)` (Snapshot-Stempel, FR-5.2a); (b) **fehlt im Snapshot, war aber im Scope** → offene Version wird geschlossen (`validTo = instant(t)`) — das Fehlen im Vollstand IST das Signal, ein explizites Lösch-Flag braucht es nicht; (c) vorhanden, aber props abweichend (normalisierter Deep-Compare) → Version schliessen + neue eröffnen; ein in der neuen Version fehlendes Property gilt als entfernt (Teil des props-Stands). Identitäten **ausserhalb des Scopes bleiben unberührt** — über sie macht der Snapshot keine Aussage.

**FR-5.7 Schutz vor kaputten Crawls.** Der Crawler nimmt fehlgeschlagene Teilbereiche (Fetch-Fehler, Abbruch) in `meta.scope.excluded` auf oder exportiert gar nicht — Ausfälle dürfen nie als Löschungen fehlinterpretiert werden. Zusätzlich prüft der Import ein Plausibilitäts-Gate: Würden mehr als 20 % der Scope-Identitäten schliessen, verlangt der Import eine explizite Bestätigung (Dialog mit Zusammenfassung: n neu, n geschlossen, n geändert).

**FR-5.8 Sichtbarkeit.** Das Ergebnis wird dem Nutzer über den `diff`-Modus signalisiert (neu/weggefallen/geändert farblich, Property-Diff im Tooltip) und nach jedem Import als Toast-Zusammenfassung angezeigt.

---

## 6. Akquise und Import

### 6.1 Crawling (Chrome-Konsolen-Harvesting)

Die Gewinnung ist bewusst **einstufig**: Jeder Provider-Crawler erzeugt **direkt** einen Snapshot im Zielformat (§3) — kein Roh-Zwischenformat, denn es gibt kein providerübergreifendes gemeinsames Rohformat; das gemeinsame Format ist die Zielstruktur. Crawler sind dabei **quellenspezifisch** (SBB ≠ SEM ≠ …) — generisch und geteilt sind nur die Registry, das Analyse-/Builder-Toolkit (FR-6.1d; stabile IDs, Dedup, Validierung, Snapshot-Hülle, IndexedDB-Konsolidierung) und das Regelwerk dieses Kapitels; der konkrete Quellenzugriff kann nicht generisch erledigt werden (FR-6.1c).

**Konsolen-Betrieb (E26).** Neue Quellen werden **nicht** aus der Viewer-App heraus gecrawlt: Die App bleibt Import-, Validierungs-, Diff- und Explorationsoberfläche (§6.3); die Akquise läuft als in der Chrome-DevTools-Konsole ausführbare Skripte im **angemeldeten Browser-Kontext der Quelle**, versioniert unter `data/crawling/`. Die Skripte sind strikt read-only: keine mutierenden Aktionen, keine Formulare, keine Datenänderung an der Quelle (FR-6.4). Beide Phasen-Skripte stellen eine globale Konsolen-API bereit: `OrgGraphHarvest.start()` / `status()` / `pause()` / `resume()` / `export()` / `discardAndStart()`; Phase A zusätzlich `exportAnalysisReport()`, Phase B `exportSnapshot()`.

**FR-6.1 Fünfstufige Pipeline mit Gate.** **(1) Phase A (Analyse, deterministisch, LLM-frei — E27):** read-only technische Inventur über alle Folgeseiten in drei Dimensionen — (a) **Knoten-Arten** (Überschriften, Tabellen, Detailseiten-Entitäten), (b) **Verbindungs-Arten** (Linkarten, Spalten-Referenzen, Zuordnungen), (c) **Properties**: Feld-Inventar pro Knoten-Art mit Wertestatistik (Anteil numerisch, Eindeutigkeit pro Entität, Kardinalität und Teilungsgrad der Werte, Beispiele). Output ist der **Source Contract** (FR-6.1d) — dann **Stopp**. **(2) Gate:** Mensch/LLM entscheidet **offline gegen den Source Contract** (kein Quellzugriff nötig) zweierlei: die **Typisierung** — pro Kandidat: bekanntem Typ zuordnen / neuen Typ in die Registry aufnehmen (Commit, FR-6.1a) / als Property führen / ignorieren, wobei die Wertestatistik die Vorlage für die Reifizierungsentscheidung nach §4.3 liefert (numerisch oder unique → `props`; kategorisch geteilt → Knoten + Kante) — und die **Harvest-Strategie**: der `harvestSpecDraft` wird zur finalen `harvest-spec.json` (FR-6.1c). **(3) Phase A.5 (Skript-Erstellung):** Aus Source Contract und Gate-Entscheiden wird `phase-b-harvest.js` erstellt oder aktualisiert (FR-6.1c). **(4) Phase B (Harvest, deterministisch):** Ausführung genau dieses versionierten Skripts — vollständige Extraktion ausschliesslich über die im Gate bestätigten Typen und Feld-Zuordnungen; nichts bleibt still ungetypt, Unklares wird als `props.unclassified` markiert; Export genau eines Snapshots (FR-6.5). **(5) Import** in die App (§6.3).

> **Normativ:** Phase A muss vollständig ohne LLM lauffähig sein. Sie erzeugt keine verbindlichen Typentscheidungen, sondern einen neutralen, evidenzbasierten Source Contract mit Endpunkten, Selektoren, JSON-Pfaden, ID-Regeln, Wertestatistiken und Beispielen; die semantische Zuordnung zum Registry-Modell erfolgt erst im Gate. Und: Phase B ist keine erneute Interpretation der Quelle durch ein LLM, sondern die Ausführung eines nach Phase A und Gate finalisierten, versionierten Harvest-Skripts.

**FR-6.1a Registry-Bootstrap.** Es gibt keine separate Phase 0: Der Erstaufbau der Registry ist der Grenzfall von Phase A mit leerer Registry — dann ist jeder Kandidat `untyped`, und das Gate kuratiert daraus die initiale Registry (Commit an `schema/registry.json`). Liegt eine Registry vor, überprüft und ergänzt derselbe Lauf sie. Registry-Pflege folgt damit derselben Semantik wie die Daten: erster Stand = Basis, jeder weitere Lauf = Abgleich mit kontrollierter Fortschreibung — mit dem Unterschied, dass Registry-Änderungen immer durch das Gate (Mensch/LLM) und einen Commit gehen, nie automatisch.

**FR-6.1b Registry-Transport.** Der Crawl-Auftrag trägt eine Kopie des aktuellen Registry-Stands aus dem Repo in den Lauf; der Crawler kennt zu Laufbeginn also die Registry, aber bewusst **nicht** die Ergebnisse früherer Läufe (Vollstands-Semantik — das Diffen geschieht beim Import, FR-5.6). Der Snapshot vermerkt `meta.registryVersion` (Version oder Hash des verwendeten Registry-Stands); der Import warnt, wenn ein Snapshot gegen einen älteren Stand gecrawlt wurde als den im Tenant bekannten.

**FR-6.1c Harvest-Spezifikation und Phase A.5 (E28).** Das Gate finalisiert aus dem `harvestSpecDraft` des Source Contracts die **`harvest-spec.json`**: Quellenzugriff (API-Endpunkte bzw. DOM-Selektoren, Navigation/Paginierung, Herkunft der stabilen IDs), Mapping Quellfeld → Registry-Typ/Kante/Property und Crawl-Strategie (Traversal-Reihenfolge, Batching, Retry, Scope). Die Spec ist das **normative Gate-Artefakt**; in **Phase A.5** wird daraus `phase-b-harvest.js` erstellt oder aktualisiert (v1 durch LLM/Mensch mit Review, später allenfalls per Codegenerator). Das Skript referenziert die Spec-Version; bei Widerspruch gilt die Spec (Rangfolge analog §1.6). Alle Artefakte werden pro Provider im Repo versioniert — `data/crawling/<provider>/` mit `phase-a-adapter.js`, `analysis-<YYYYMMDD-HHMM>.json` (historisiert), `harvest-spec.json`, `phase-b-harvest.js` und `README.md` —, damit jeder Re-Crawl reproduzierbar ist und die Phasen A–A.5 bei unveränderter Quelle übersprungen werden können.

**FR-6.1d Source Contract (LLM-freie Phase A, E27).** Phase A trifft keine semantischen Entscheidungen — sie sammelt, profiliert und dokumentiert. Architektur nach dem Kern-Adapter-Prinzip: Der **generische Analyse-Kern** `data/crawling/toolkit/analyze-core.js` (providerunabhängig: fetch/XHR-Sniffing zur Entdeckung interner JSON-APIs, DOM-Inventur über Tabellen/Linkmuster/wiederkehrende Strukturen, Feld-Profiling mit Wertestatistik, lauf-lokaler Store, Report-Export) wird pro Provider nur um einen **dünnen Adapter** `phase-a-adapter.js` ergänzt (Entry-URLs, Scope-Wurzel, Navigations-/Paginierungshinweise) — für eine neue Quelle ist ausschliesslich der Adapter neu, darum braucht Phase A kein LLM. Der Registry-Abgleich in Phase A ist rein **mechanisch** (Namens-/Strukturvergleich markiert Kandidaten als `known`), nie semantisch. Output ist der Report `analysis-<provider>-<YYYYMMDD-HHMM>.json` mit `meta` (kind, provider, runId, startedAt/finishedAt, registryVersion, scopeHint), `known` (mechanisch gemappte Typen/Props), `untyped` (Knoten-/Kanten-/Property-Kandidaten, je mit Quell-Evidenz: URL-Muster, Selektor bzw. JSON-Pfad; Statistik: rowsSeen, nonEmpty, uniqueValues, Teilungsgrad; Beispielwerten und `possibleTreatment`), `harvestSpecDraft` (entrypoints, apiEndpoints, selectors, idRules, mappingDraft) und `warnings` — maschinenprüfbar definiert in [`schema/analysis.schema.json`](schema/analysis.schema.json).

**FR-6.2 Identität.** Stabile IDs vom Quell-PK: In strukturierten Quellen ist jede Entität verlinkt, die ID steckt im Link-Ziel/der URL (sonst E-Mail oder Quell-OE-ID); Beziehungen referenzieren das verlinkte Ziel, nie den Anzeigenamen. Fehlt jede stabile Kennung: `slug(label)` mit `props.idSource='name'`.

**FR-6.3 Konsolidierung.** Die Konsolen-Skripte verwenden auf der Quell-Origin eine **eigene** IndexedDB `orggraph-harvest`, strikt getrennt von der Viewer-Datenbank. Stores: `runs` (Lauf-Marker: runId, Status, Provider, Registry-Version, Snapshot-Stempel), `analysisNodes`/`analysisEdges`/`analysisProps` (Phase-A-Kandidaten und -Statistiken), `nodes` (keyPath `id`) und `edges` (keyPath `key` = `type|source|target`, erweitert um die Werte deklarierter `identityProps` — serialisiert in der im Registry-Schema deklarierten Reihenfolge, damit der Key normativ stabil ist; E15) für Phase B sowie `logs` (Warnungen, Fehler, Fortschritt, ausgelassene Bereiche). Konsolidierung upsert-basiert, dedupliziert, resume-fähig, Re-Run derselben Seite idempotent. Auch Basisquellen (Personen-OE-Graph mit Hierarchie) werden in denselben Store gemerged.

**FR-6.3a Ein Lauf = ein Snapshot; der Crawl-Store ist lauf-lokal.** Der IndexedDB-Store auf der Quell-Origin ist Akkumulator **eines einzelnen Crawl-Laufs**, kein Cache über Läufe hinweg. Er führt einen Lauf-Marker (Snapshot-Stempel, Startzeit, `registryVersion`). Ein unterbrochener Lauf wird am Marker erkannt und **fortgesetzt** (resume); ein **neuer** Lauf startet zwingend mit leerem Store — liegen unexportierte Daten eines früheren Laufs vor, verlangt das Skript eine explizite Konsolen-Entscheidung: `OrgGraphHarvest.resume()` oder `OrgGraphHarvest.discardAndStart()`, niemals mischen (sonst würden zwischenzeitlich an der Quelle verschwundene Entitäten als vorhanden exportiert und die Vollstands-Semantik aus §5.1 verletzt). Nach bestätigtem Export wird der Store geleert; ab dann sind Quell-IndexedDB und Repository deckungsgleich — Snapshot-Dateien und Registry im Repo sind die einzige persistente Wahrheit zwischen Läufen.

**FR-6.4 Verhalten.** Nur lesen (keine Klicks auf Aktionen, keine Formulare); bevorzugt interne JSON-APIs (Network-Tab) vor DOM-Scraping; Folge-Seiten gechunkt (Batches ~5, randomisierte Pausen, Backoff bei 429/5xx); Labels normalisieren (De-Gendering nur für Anzeige-Labels, nie für API-Namen; Whitespace kollabieren).

**FR-6.5 Export.** Am Schluss ein einziger Blob-Download `crawl-<quelle>-<YYYYMMDD-HHMM>.json` mit `meta` (inkl. **`scope`**, §5.1), `schema` (verwendete Teilmenge) und den konsolidierten `nodes`/`edges`. Store erst nach bestätigtem Export leeren. Snapshots liegen historisiert unter `data/<tenant>/sources/`.

### 6.2 Scope-Ermittlung im Crawler

**FR-6.6** Der Crawler kennt seinen Auftrag und deklariert den Scope selbst: die im Gate bestätigten Typen als `nodeTypes`/`edgeTypes`, die Start-Wurzel(n) als `roots`, gescheiterte Teilbäume als `excluded` (§5.7). Ein Enrichment-Crawl (z. B. nur Trainings-Seiten) deklariert nur seine Typen und löscht damit nichts ausserhalb.

### 6.3 Import in die App

**FR-6.7 Eingang.** Snapshots gelangen per Drag&Drop (bestehende Dropzone, inkl. globalem dragenter/dragover/drop) oder Dateidialog in die App; Erkennung inhaltsbasiert (`meta.snapshot` + `schema` + `nodes`/`edges`). Akzeptierte Dateiklassen (E25): Snapshot, `env.json`, Pseudo-Daten sowie ZIP-Bündel daraus; Legacy-Formate (altes `data.json`, Attribut-TSV) werden mit Hinweis auf das Migrationsskript (§10) abgewiesen. Der heutige versteckte Footer-Status-Klick zum Datei-Laden entfällt — Import läuft ausschliesslich über Dropzone und Dateidialog.

**FR-6.8 Validierung.** Vor dem Diff: Schema ist Teilmenge der im Tenant bekannten Registry; Kanten-Endpunkte existieren (im Snapshot oder im Bestand) und respektieren `from`/`to`; Knoten-Referenz-Properties (FR-4.7) zeigen auf existierende Knoten des deklarierten Typs; fehlt auf einer Kante der Wert einer deklarierten `identityProp`, ist das ein **Importfehler** (die Kanten-Identität wäre sonst nicht bestimmbar, E15); `labelProp`-Auflösungsfehler werden als Warnung gemeldet (FR-4.2b); implizierte Kanten werden materialisiert und die Konsistenz-Invariante geprüft (FR-4.8); IDs eindeutig; Zyklen-Warnung pro definierter View: Bilden die transitiven Selbst-Hops ihres Pfads im neuen Bestand Zyklen, wird mit Details gewarnt (kein stiller Drop; die BFS bleibt robust, FR-7.2).

**FR-6.9 Fortschreibung.** Diff nach FR-5.6 gegen den Tenant-Store, Versionsfortschreibung, Plausibilitäts-Gate (FR-5.7), Toast-Zusammenfassung (FR-5.8). Eine Snapshots-Registry im Tenant-Store verzeichnet importierte Snapshot-Stempel; ein bereits importierter Snapshot wird erkannt und ist ein No-op (**Idempotenz**). Snapshots müssen chronologisch importiert werden; ein älterer Stempel als der jüngste importierte wird mit Hinweis abgewiesen.

---

## 7. Views und Projektionen

Eine View projiziert aus dem Gesamtgraphen einen darstellbaren, geordneten Teilgraphen. Views sind in `env.json` vordefiniert und maschinenprüfbar definiert in [`schema/view.schema.json`](schema/view.schema.json). **Hierarchie ist ausschliesslich ein View-Konzept (E18)**: Der Graph selbst ist nur gerichtet; erst der **Pfad-Ausdruck** einer View (E19, FR-7.1a) macht bestimmte Kantentypen zum Baum — die Hierarchie ergibt sich aus der Reihenfolge im Pfad. Fehlt `VIEWS`, gibt es folglich keine Hierarchie — aber **nie einen Full-Graph-Render** (das Prinzip «nie der ganze Graph», FR-8.1, gilt immer): Die App weist auf die fehlende View-Konfiguration hin und bietet nur eine begrenzte **Diagnose-Projektion** — alle Typen ohne Ordnung (reines Force-Layout), aber ausgehend von per Suche gesetzten Roots und begrenzt durch den Tiefen-Regler (Nachbarschafts-BFS über alle Kantentypen, beide Richtungen); ohne gesetzten Root wird nichts gerendert. Die ausgelieferte Start-View (FR-7.4) ist dagegen explizit definiert. `schema/view.schema.json` validiert nur ein **vorhandenes** `VIEWS`-Objekt: Fehlt `VIEWS` vollständig, greift die Diagnose-Projektion; ein leeres `VIEWS: {}` ist dagegen ungültig (`minProperties: 1`).

Beispiel (illustrativ, mit den Beispiel-Typen aus §4.1 — E14):

```json
"VIEWS": {
  "Personenhierarchie": {
    "path": "Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring])",
    "roots": ["__auto__"],
    "depth": 3
  },
  "Projekt-Sicht": {
    "path": "Projekt <--arbeitetAn-- Person (--hatRolle--> Rolle[ring], --mitgliedIn--> OE)",
    "roots": ["proj-zi"]
  },
  "Kolleg:innen-Sicht": {
    "path": "Person --mitgliedIn--> OE[hidden] <--mitgliedIn-- Person",
    "roots": ["__auto__"]
  }
}
```

**FR-7.1 View-Felder.** `path` (Pflichtfeld; der Pfad-Ausdruck, FR-7.1a), `roots` (Wurzel-IDs, Instanzen des Anker-Typs; `"__auto__"` = Knoten des Anker-Typs ohne **ausgehende** Kante eines am Anker beginnenden transitiven Selbst-Hops — bei «Person <--berichtetAn-- Person» also die obersten Vorgesetzten; ohne Selbst-Hop am Anker: alle Knoten des Anker-Typs. `"__auto__"` ist nur erlaubt, wenn am Anker **höchstens ein** transitiver Selbst-Hop beginnt — sonst muss die View explizite `roots` definieren, andernfalls meldet der Parser einen Konfigurationsfehler), `depth` (optionaler Start-Tiefenwert), `time` (optional `asOf`/`diff`, §5), `filters` (optionale deklarative Einschränkungen, FR-7.8).

**FR-7.1a Pfad-Ausdruck (E19).** Der Pfad definiert vollständig, welche Knoten- und Kantentypen die View zeigt, wie sie gerendert werden und was den Baum aufspannt — er ersetzt die früheren Felder `edgeTypes`/`hierarchyEdges`/`visibleNodeTypes`/`render`. Grammatik:

```
view      := node-expr
node-expr := Typ [ "[" render "]" ] [ zweige ]
zweige    := hop | "(" hop { "," hop } ")"
hop       := "<--" Kantentyp "--" node-expr     // gespeicherte Kante zeigt zum LINKEN Knoten
           | "--" Kantentyp "-->" node-expr     // gespeicherte Kante zeigt zum RECHTEN Knoten
render    := "node" | "cluster" | "hidden" | "ring" [ ":" ("prev" | "next") ]   // Default: node; [ring] = [ring:prev]
```

Semantik:

- **Anker:** Der linkeste Typ ist der Anker; dort greifen `roots` und die Laufzeit-Roots (FR-7.6).
- **Pfeile = gespeicherte Kantenrichtung.** Mit der Richtungs-Konvention (FR-7.2a) lesen sich Abstiege als `<--` (Untergebene einsammeln) und Zuordnungen als `-->` (Container/Objekte anhängen).
- **Selbst-Hops sind implizit transitiv:** Ein Hop, dessen Zieltyp gleich dem Starttyp ist, wendet den **gesamten umgebenden node-expr** auf das Ziel erneut an (Geschwister-Zweige gelten also auf jeder Stufe — jede Person im Org-Baum bekommt OE-Zone und Rollen-Ring), begrenzt durch die Tiefe (FR-7.7). Alle übrigen Hops werden genau einmal angewandt.
- **Verzweigungen:** Runde Klammern, kommagetrennt; alle Zweige starten am selben Knoten.
- **`[render]`** setzt den Render-Modus des Typs an dieser Pfadposition (FR-7.3); Default `node`.
- **Ring-Attachment (E21):** `ring:prev` heftet den Badge an die nächstliegende **vorhergehende** sichtbare `node`-Station des Pfads, `ring:next` an die nächstliegende **nachfolgende**; `[hidden]`-Stationen zählen nicht als Attachment-Ziel; `[ring]` ist Alias für `[ring:prev]`.
- **`[hidden]` = Kontraktion:** Der Knoten wird nicht gezeichnet; seine sichtbaren Pfad-Nachbarn werden durch eine **abgeleitete Kante** direkt verbunden (stilistisch als abgeleitet erkennbar), und die Ordnung zählt nur sichtbare Stationen — «Kolleg:innen derselben OE» wird so zur direkten Person–Person-Verbindung.

**FR-7.1b Normative Pfad-Beispiele.** Die Typnamen sind Illustration (E14); **normativ ist die jeweils beschriebene Projektions-Semantik** — sie definiert das erwartete Verhalten von Parser und Projektion:

| # | Pfad | Erwartete Projektion |
|---|------|----------------------|
| 1 | `Person <--berichtetAn-- Person` | Transitiver Selbst-Hop: Org-Baum abwärts ab den `roots`; jede sichtbare Stufe +1 Ordnung, begrenzt durch die Tiefe (FR-7.7). Nur Personen sichtbar. |
| 2 | `Person --mitgliedIn--> OE[cluster]` | Hop in gespeicherter Kantenrichtung ohne Selbst-Hop: genau **ein** Hop pro Root-Person; deren OEs als Cluster-Hüllen mit Ordnung 1. Keine Rekursion. |
| 3 | `Person (<--berichtetAn-- Person, --hatRolle--> Rolle[ring])` | Die Selbst-Hop-Transitivität wendet den **ganzen** node-expr rekursiv an: jede Person im Baum erhält ihre Rollen-Badges (`[ring]` = `[ring:prev]` → Badge an der Person selbst). |
| 4 | `Projekt <--arbeitetAn-- Person --mitgliedIn--> OE[cluster]` | Anker = Projekt (`roots` sind Projekt-IDs); Ordnung: Projekt 0, Person 1, OE 2; kein Selbst-Hop, keine Rekursion. |
| 5 | `Person --mitgliedIn--> OE[hidden] <--mitgliedIn-- Person` | Hidden-Kontraktion: OE wird nicht gezeichnet; Personen derselben OE sind durch **abgeleitete** Kanten direkt verbunden; Ordnung der Kolleg:innen = 1 (`[hidden]` zählt nicht); die OE bleibt filter- und suchbar. |
| 6 | `Firma <--arbeitetBei-- Person[hidden] --hatRolle--> Rolle[ring]` | Attachment überspringt `[hidden]`: Die Rollen-Badges hängen an der **Firma** — der Person-Knoten ist unsichtbar und zählt nicht als Attachment-Ziel (E21). |
| 7 | `OE <--unterstellt-- OE` bei einer Unter-OE mit zwei Ober-OEs im Bestand | Mehrfach-Eltern (E5): **eine** Knoteninstanz, beide `unterstellt`-Kanten werden vollwertig gezeichnet, die flachste Ordnung gewinnt. |

**FR-7.2 Ordnung.** Order 0 = `roots` (Anker); BFS entlang der vom Pfad definierten Hops; jede **sichtbare** Station erhöht die Ordnung um 1 (transitive Selbst-Hops pro Anwendung +1; `[hidden]`-Stationen zählen nicht, FR-7.1a); `order(n)` = kürzeste Distanz zur nächsten Wurzel. Mehrfach-Eltern: **eine** Knoteninstanz (Identität, Suche, Pseudonymisierung und Diff hängen an stabilen IDs), die flachste Ordnung gewinnt, **alle** Kanten werden als vollwertige Verbinder gezeichnet — die gerichteten Filter erzeugen möglichst baumnahe Subgraphen, die sichtbare Mehrfach-Kante ist die legitime Ausnahme (E5); Quer-Verbindungen ohne eigene Syntax: Erreichen mehrere Pfadstellen denselben Knoten, sind die Zusatz-Kanten automatisch Quer-Links ohne Ordnungseffekt. Zyklen: Über transitive Selbst-Hops sollen laut Datenvertrag keine auftreten (der Import warnt, FR-6.8); die BFS nimmt die flachste Distanz und ignoriert Rück-Kanten.

**FR-7.2a Kantenrichtung (normative Konvention, E17).** Kanten zeigen **vom Untergeordneten zum Übergeordneten** (`source` = Kind/Mitglied/Beteiligte:r, `target` = Eltern/Container/Bezugsobjekt) — die Kantennamen lesen sich als Satz («A berichtetAn B» = B ist Vorgesetzte:r). Diese Konvention gilt für **alle** Kantentypen; sie ist es, die Pfad-Ausdrücke lesbar macht (Abstiege `<--`, Zuordnungen `-->`, FR-7.1a) und dem Scope-Traversal (FR-5.5a) seine einheitliche Abstiegs-Richtung **gegen** die Kantenrichtung (`target` → `source`) gibt. Für die Beispiel-Typen (E14) und das Legacy-Mapping gilt:

| Kantentyp (Beispiel) | `source` (Rolle) | `target` (Rolle) | BFS-abwärts | Legacy-Mapping (FR-10.3) |
|---|---|---|---|---|
| `berichtetAn` | Mitarbeiter:in (untergeordnet) | Vorgesetzte:r | `target` → `source` | Legacy Person→Person ist **Manager→Mitarbeiter** → wird beim Migrieren **umgedreht** |
| `mitgliedIn` | Person (Mitglied) | OE (Container) | `target` → `source` | Legacy Person→OE zeigt bereits Person→OE → **unverändert** |
| `unterstellt` | Unter-OE | Ober-OE | `target` → `source` | Legacy OE→OE ist **Parent→Child** → wird beim Migrieren **umgedreht** |

**FR-7.3 Render-Modi (pro Pfadposition, FR-7.1a).** `node` = eigenständiger Graph-Knoten mit Kanten (Default); `cluster` = konvexe Hülle um die verbundenen Knoten (heutige OE-Darstellung, jetzt generischer Render-Modus); `hidden` = kontrahiert (FR-7.1a), aber für Filter/Suche verfügbar. **`ring` (formal, E21):** Ein `ring`-gerenderter Knoten erscheint als Ring/Badge an einer sichtbaren `node`-Station des Pfads (heutige Attribut-Darstellung): `ring:prev` an der nächstliegenden **vorhergehenden**, `ring:next` an der nächstliegenden **nachfolgenden** Station; `[hidden]`-Stationen sind nie Attachment-Ziel, `[ring]` ist Alias für `[ring:prev]`. Der Ring-Knoten ist kein eigenständiges Layout-Element, aber voll such-, filter- und legendenfähig — seine Sichtbarkeit steuert die Ring-Legende (FR-8.2), sein Farb-Hue der Typname (FR-4.2a).

**FR-7.4 Start-View.** Die erste definierte View bildet die heutige aktive Darstellung 1:1 ab — als Pfad: «Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring])» (die drei migrierten Legacy-Beziehungsarten als Hops; Namen sind Illustration, E14).

**FR-7.5 View-Wechsel.** Footer-Switcher analog zum bestehenden Profil-Switcher; View-Wechsel setzt Laufzeit-Übersteuerungen (FR-7.6/7.7) zurück.

**FR-7.6 Laufzeit-roots.** Die bestehende Such-Combo bleibt: Auswahl ersetzt die View-`roots` (`setSingleRoot`), Shift-Klick/Shift-Enter fügt den Treffer als weiteren Root hinzu (`addRoot`, max. 5). Die Suche läuft über alle **sichtbaren Typen des Pfads** (nicht-`hidden`) mit deren `identifiers`-Capability; als Root gesetzt werden Knoten des **Anker-Typs**, Treffer anderer Typen zentrieren die Ansicht auf den Knoten. Die View-Definition bleibt unverändert (temporäre Übersteuerung).

**FR-7.7 Laufzeit-Tiefe.** Der View-`depth` ist der Startwert; der bestehende Toolbar-Regler (0–6) übersteuert zur Laufzeit.

**FR-7.8 View-Filter (Properties und Referenz-Properties).** Eine View kann den projizierten Teilgraphen deklarativ einschränken, z. B. `"filters": { "nodes": [ { "type": "Person", "prop": "pensum", "op": "gte", "value": 80 } ], "edges": [ { "type": "hatRolle", "prop": "kontext", "op": "refEq", "value": "firma-akros" } ] }` (illustrativ, E14). Operatoren v1: `eq`, `neq`, `in`, `exists`, `gte`, `lte` für Skalare; `refEq`/`refIn` für Knoten-Referenz-Properties (Vergleich über die Ziel-**ID**; die UI zeigt und wählt über das aufgelöste Label). Node-Filter entfernen den Knoten samt seiner Kanten aus der Projektion, Edge-Filter nur die Kante. Filter wirken nach der Traversal-Projektion (roots/Tiefe/Typen/Zeitschnitt) und vor dem Layout.

---

## 8. Funktionale Anforderungen an die App

**FR-8.1 Rendering-Pipeline.** Nie der ganze Graph: View-Projektion (roots + Tiefe + Typen + Zeitschnitt) → Teilgraph → Layout → Render. Force-Layout läuft nur auf dem projizierten Teilgraphen (SEM-Referenzbestand: 62k Knoten- / 114k Kanten-**Identitäten** im Bestand sind unkritisch, solange die sichtbare Projektion begrenzt bleibt; Begriffsebenen §2).

**FR-8.2 Legenden, typgetrieben.** Die heutigen drei Legenden verallgemeinern sich: (a) Cluster-Legende = Baum aller `cluster`-gerenderten Knoten der View (heutige OE-Legende) inkl. Filterfeld, Toggle-All, Auge und dem einheitlichen Kontextmenü (FR-8.7, E24); (b) Ring-Legende = Gruppen der `ring`-gerenderten Typen mit Trefferzahlen und Farbchips (heutige Attribut-Legende) inkl. Fokus-Trichter; (c) Ausgeblendet-Legende unverändert. Legend-Row-Factories werden wiederverwendet.

**FR-8.3 Filter.** Blatt-Filter (heute «Management») über `leafProp`-Capability typunabhängig — die UI-Beschriftung wird generisch («Blätter ausblenden» statt des Personen-Begriffs «Management»); Sichtbarkeits-Toggles pro Knotentyp (verallgemeinert den OE-Sichtbarkeits-Toggle); Ring-Fokus-Pruning (heute Attribut-Fokus) läuft über die View-Kanten statt über hardcodierte Aufwärtskanten.

**FR-8.4 Suche.** Wort-Präfix-Matching und Dropdown unverändert; Suchraum = sichtbare Knotentypen der View, Felder aus `identifiers`.

**FR-8.5 Pseudonymisierung.** Pro Knotentyp über die `pseudonymize`-Capability (Pool, optional level-abhängig); Passwortschutz beim Deaktivieren bleibt (`TOOLBAR_PSEUDO_PASSWORD`).

**FR-8.6 Zeit-UI.** Neuer Zeit-Slider (asOf) und Diff-Auswahl (T1/T2) in der Toolbar oder im Footer, nur aktiv, wenn der Tenant mehr als einen Snapshot-Stand enthält.

**FR-8.7 Kontextmenü (einheitlich, E24).** Rechtsklick auf einen Knoten im Graph **oder** auf seine Legenden-Row öffnet dasselbe typunabhängige Kontextmenü — Legende und Graph zeigen dieselben Entitäten, es gibt eine Aktionsliste statt der heutigen zwei getrennten Menüs: **Ausblenden** (Subtree über die Abstiegs-Hops des View-Pfads), **Einblenden**, **Nur direkte Kinder anzeigen**, **Als Root definieren**, **Als Root entfernen**. Nicht anwendbare Einträge sind deaktiviert, nie versteckt. «Als Root entfernen» ist nur aktiv, wenn der Knoten Root ist **und** mehr als ein Root gesetzt ist — der letzte Root ist nicht entfernbar (eine leere Projektion ist ausgeschlossen). Ausgeblendete Subtrees werden über die Ausgeblendet-Legende wiederhergestellt (Klick auf den Eintrag; die bestehende temporäre Sichtbarkeit beim Hover bleibt). Der globale Browser-Kontextmenü-Override der heutigen App bleibt: Die App unterdrückt das native Menü und zeigt ausschliesslich eigene. Das Attribut-Editier-Submenü entfällt (Datenpflege geschieht an der Quelle bzw. im Crawl, nicht im Viewer).

**FR-8.8 Export.** SVG/PNG-Export-Dialog unverändert.

**FR-8.9 Persistenz.** IndexedDB-Profilarchitektur (ein Object-Store pro Tenant, `__meta__`-Store) unverändert; pro Tenant zusätzlich: Graph (Versionen), Snapshots-Registry, env/Views, Pseudo-Daten.

**FR-8.10 Konfiguration.** `env.json` bleibt der Konfigurationsträger: `VIEWS` (neu), bestehende `TOOLBAR_*`- und `LEGEND_*`-Schlüssel behalten ihre Funktion (Blatt-Filter-Default, Tiefe, Labels, Zoom, Pseudo, Debug, Simulation, Collapse-Zustände, Hidden-Roots, Start-IDs). `TOOLBAR_DIRECTION_DEFAULT` und der Richtungs-Toggle **entfallen** (E22): Die Richtungs-Semantik ist vollständig im View-Pfad kodiert; ein Laufzeit-Richtungs-Parameter hätte im Pfadmodell keine Funktion mehr. `ATTRIBUTE_TYPES`, `DATA_ATTRIBUTES_URL` und `DATA_ATTRIBUTES_DIR` entfallen (Legacy, §10); `DATA_URL` zeigt auf einen Graph-Snapshot. Zwei Toggle-Klärungen: Der **Label-Toggle** generalisiert die heutigen Modi `all`/`attributes`/`none` zu **alle Labels / nur `ring`-Badges / keine**. Der **Hierarchie-Toggle** bleibt als reiner **Layout-Modus** (hierarchische Anordnung der projizierten View-Ordnung vs. freies Force-Layout) — er macht keine Daten- oder Registry-Aussage; Hierarchie bleibt ein View-Konzept (E18).

**FR-8.11 Render-Auslösung (reaktiv, E23).** Es gibt keinen «Anzeigen»-Button mehr: Jede Parameter-Änderung — View-Wechsel, Root-Änderung (Combo, Kontextmenü), Tiefe, Zeitstand, Filter- und Sichtbarkeits-Toggles — löst das Rendering direkt aus. Der permanente «Animation fortsetzen»-Button bleibt unverändert erhalten.

**FR-8.12 Footer-Stats (typgetrieben).** Der Footer zeigt: den **Bestand** des Tenants (Knoten- und Kanten-Identitäten), die **sichtbare Projektion** (Knoten/Kanten), Zähler **pro Render-Modus der aktiven View** (Anzahl Cluster-Knoten, Anzahl Ring-Gruppen — ersetzt die fixen «OEs»- und «Attribute»-Zähler) und den Ausgeblendet-Zähler; sobald der Tenant mehr als einen Snapshot-Stand enthält, zusätzlich den aktiven Zeitstand (asOf-Datum bzw. Diff T1→T2); im `diff`-Modus zusätzlich die Zähler **neu / weggefallen / geändert** der sichtbaren Projektion. Begriffsebenen nach §2.

**FR-8.13 Knoten-Interaktionen (explizit).** Die heutigen Interaktionen am SVG-Knoten bleiben typgeneralisiert erhalten: **Drag** (Knoten ziehen; Verhalten mit laufender/pausierter Simulation wie heute), **Click** (auswählen/zentrieren; Root-Verhalten über Kontextmenü und Combo, FR-7.6/8.7), **Hover-Tooltip** typgetrieben: Typname aus der Registry, Label (pseudonymisiert, wo aktiv), `props` sowie aufgelöste Referenz-Properties (Label des Zielknotens, FR-4.7); im `diff`-Modus zeigt der Tooltip den Property-Diff (FR-5.3).

---

## 9. Übernahme aus der bestehenden App

Grundsatz (E12): Alle passenden UI-Elemente, Algorithmen und Eigenschaften werden übernommen. Drei Kategorien:

### 9.1 Unverändert übernommen (bereits generisch)

| Baustein | Ort heute |
|----------|-----------|
| Build-System (Single-File aus 20 Sections, `stripModuleSyntax`) | `build.js`, `index.template.html` |
| Icon-Registry (SVG, dependency-frei) | `02-icons.js` |
| Storage-/Profilschicht (IndexedDB-Tenants, Datei-Klassifikation, Persistenz-Request) | `04-storage.js` |
| ZIP-Reader (`DecompressionStream`) | `05-dropzone.js` |
| Dropzone/Overlay + globales Drag&Drop | `05-dropzone.js` |
| Export-Dialog (SVG/PNG, Presets, Canvas) | `03-export-dialog.js` |
| Adjazenzliste `buildAdjacency`, BFS-Levels `getNodesLevels` | `11`/`13` |
| Wort-Präfix-Matching `matchesWordPrefixes` | `10-combo.js` |
| Levenshtein/Fuzzy-Kern | `15-ui-apply-search.js` |
| Farb-Geometrie: `hashCode`, `quantizedHueFromCategory`, `colorForCategoryAttribute`, `colorToTransparent` | `08-color-geometry.js` |
| Level-animierte Graph-Transition | `14-render.js` |
| Toast, Statuszeile, Footer-Stats, Profil-Switcher, Reset | `01`/`08`/`18`/`20` |
| CSS-Custom-Properties als Simulations-/Geometrie-Parameter | `styles.css` + `cssNumber` |

### 9.2 Übernommen mit Generalisierung (Algorithmus bleibt, Typbezug wird deklarativ)

| Baustein | Heute hardcoded | Neu |
|----------|-----------------|-----|
| **Radiales Initial-Layout + BFS-Expansion** (`initializeRadialLayout`, `radialLayoutExpansion`, Hüllen-Platzierung sekundärer Roots) | nur Personen-Knoten, Parent-Map aus Person-Person-Links | **Algorithmus identisch**; arbeitet auf den `node`-gerenderten Knoten des projizierten Teilgraphen, Parent-Map aus den Abstiegs-Hops des View-Pfads |
| **Force-Simulation** (D3-Forces, Parameter aus CSS-Vars, Kollisionsradius inkl. Ringe) | Kanten-/Cluster-Logik Person/OE | **Kräfte und Parameter identisch**; Ringe = `ring`-gerenderte Nachbarn, Cluster = `cluster`-gerenderte Knoten |
| **Hierarchie-Layout** (`computeHierarchyLevels`, forceX/forceY-Gruppierung) | Manager→Mitarbeiter-Kanten, OE-Cluster-Zentren | Levels über die Pfad-Ordnung (FR-7.2); Gruppierung um Zentren der `cluster`-Knoten |
| BFS-Subgraph `computeSubgraph` (Tiefe, Richtung up/down/both) | typgesteuerte Kantenfilter (Person→Org-Unterdrückung etc.) | Traversal über die Hops des View-Pfads; Richtungs-Semantik pro Hop explizit statt aus Typpaaren; der Laufzeit-Richtungs-Parameter entfällt (E22) |
| Cluster-Hüllen (`refreshClusters`, `computeClusterPolygon`, Punkt-in-Polygon) | OE-Hierarchie fix | Render-Modus `cluster` für beliebige Typen; Hüllen-Hierarchie über die Kanten zwischen Cluster-Knoten |
| Blatt-Filter («Management») | `isBasis` an Personen | `leafProp`-Capability (FR-8.3) |
| Subtree-Ausblenden (`collectReportSubtree`) | nur Person→Person | Abstiegs-Hops des View-Pfads |
| Ring-Fokus (`recomputeAttributeFocusHidden`) | Aufwärtskanten fix | View-Kanten (FR-8.3) |
| Pseudonymisierung (`getPseudoName`/`getPseudoOrgLabel`) | Person/OE-Verzweigung | `pseudonymize`-Capability (FR-8.5) |
| Fuzzy-Suche (Domäne) | `raw.persons`, id/email/label | `identifiers`-Capability über sichtbare Typen |
| Farbstrategien (`getNodeFillByLevel`, `colorForOrg`, Kategorie-Hue) | Personen bzw. OEs bzw. Attribut-Kategorien fix | Strategie folgt dem Render-Modus der View: `node` → byLevel, `cluster` → hash, `ring` → categoryHue (FR-4.2a) |
| Legenden (OE-/Attribut-/Hidden) | Begriffe und Datenpfade fix | typgetrieben nach Render-Modus (FR-8.2) |
| Tooltips (Emojis, «OEs», «Attribute») | fix | Typnamen aus der Registry (FR-4.2a) |
| Knoten-Kontextmenü | Personen-spezifisch | typunabhängig (FR-8.7) |
| Toolbar-Toggles (Tiefe, Hierarchie, Labels, Fit, Simulation, Pseudo, Debug) | Verhalten generisch, Defaults env | unverändert, plus Zeit-UI (FR-8.6); der Richtungs-Toggle entfällt (E22), der «Anzeigen»-Button entfällt zugunsten reaktiven Renderings (E23, FR-8.11) |

### 9.3 Entfällt in der App (wandert ins Einmal-Migrationsskript, §10)

| Baustein | Grund |
|----------|-------|
| Attribut-TSV-Upload, `parseAttributeList`, Kategorie-Speichern/TSV-Export, File-Handles | Legacy-Attribut-Pfad; Attribute sind künftig Knoten/props im Snapshot |
| Fuzzy-Match-Dialog (`17-fuzzy-dialog.js`) + `KEY_ATTR_MATCHES`-Persistenz | Identifier-Zuordnung geschieht einmalig in der Migration (CLI-Report + Mapping-Datei) |
| Attribut-Editier-Submenü im Kontextmenü | Datenpflege an der Quelle, nicht im Viewer |
| `looksLikeData`-Erkennung des Alt-Formats, `processData` (persons/orgs/links) | App versteht nur noch Snapshots (§3) |
| `ATTRIBUTE_TYPES`, `DATA_ATTRIBUTES_URL`, `DATA_ATTRIBUTES_DIR` in env.json | Mapping-Konfiguration lebt im Migrationsskript |

### 9.4 UI-Feature-Migration

Explizites Feature-Mapping aller bedienrelevanten UI-Elemente (ergänzt §9.1–§9.3 um die Entscheidungs-Sicht):

| Bestehendes Feature | Entscheidung | Neue Semantik | Akzeptanz/Notiz |
|---------------------|--------------|----------------|-----------------|
| Richtungs-Toggle (`TOOLBAR_DIRECTION_DEFAULT`) | **Entfällt** (E22) | Richtungs-Semantik vollständig im View-Pfad kodiert | AK 8; FR-8.10 |
| «Anzeigen»-Button (`applyFromUI`) | **Entfällt** (E23) | Rendering reaktiv bei jeder Parameter-Änderung (View, Roots, Tiefe, Zeitstand, Filter) | FR-8.11 |
| «Animation fortsetzen»-Button (permanent) | **Bleibt** | unverändert | FR-8.11 |
| Knoten-Kontextmenü (Ausblenden, Als Root definieren/entfernen) | **Konsolidiert** (E24) | ein einheitliches typunabhängiges Menü für Graph-Knoten und Legenden-Rows; «Als Root entfernen» nur bei Multi-Root | FR-8.7 |
| OE-Legenden-Row-Kontextmenü (Alle einblenden, Alle ausblenden, Nur direkte Kinder anzeigen) | **Konsolidiert** (E24) | Aktionen wandern in das einheitliche Kontextmenü; nicht anwendbare Einträge deaktiviert | FR-8.7 |
| Attribut-Editier-Submenü im Kontextmenü | **Entfällt** | Datenpflege an der Quelle bzw. im Crawl | FR-8.7, §9.3 |
| Globaler Browser-Kontextmenü-Override | **Bleibt** | App unterdrückt das native Menü und zeigt ausschliesslich eigene | FR-8.7 |
| Cluster-Legende: Filterfeld, Chevron-Collapse, Auge, Toggle-All | **Bleibt** (generalisiert) | wirkt auf alle `cluster`-gerenderten Knoten der View | FR-8.2 |
| Attribut-/Ring-Legende: Kategorie-Expand/Collapse, Auge, Shift-Klick-Fokus, Trefferzahlen, Farbchips | **Bleibt** (generalisiert) | wirkt auf die `ring`-gerenderten Typen der View; Fokus-Trichter über View-Kanten | FR-8.2, FR-8.3 |
| Attribut-Legende: Download- (TSV) und Speichern-Buttons | **Entfällt** | kein Attribut-Roundtrip mehr — Attribute sind Knoten/props im Snapshot | §9.3 |
| File-System-Handles für Attribut-Dateien | **Entfällt** | Nutzer-Konsequenz: Attribut-Änderungen im Viewer gibt es nicht mehr, damit auch kein lokales Speichern; IndexedDB ist die einzige lokale Persistenz (NFR-8) | §9.3 |
| Ausgeblendet-Legende | **Bleibt** | Wiederherstellung ausgeblendeter Subtrees per Klick; temporäre Sichtbarkeit beim Hover | FR-8.2, FR-8.7 |
| Footer-Stats («Knoten/Kanten/OEs/Attribute») | **Generalisiert** | typgetrieben: Bestand-Identitäten, sichtbare Projektion, Zähler pro Render-Modus, Ausgeblendet, Zeitstand | FR-8.12 |
| Such-Combo mit Shift-Add, Tiefen-Regler, Blatt-Filter, Pseudo-Toggle, Export-Dialog, Profil-Switcher | **Bleibt** | wie heute, typgetrieben über Capabilities | FR-7.6/7.7, FR-8.3–8.5, FR-8.8, AK 8 |

### 9.5 UI-Interaktionsmigration (Event-Inventar)

Ergänzend zu §9.4 auf Event-Ebene: Jede bestehende Interaktion ist entweder übernommen, typgeneralisiert, durch Snapshot/Crawl ersetzt oder bewusst entfernt — nichts fällt still weg. Diese Tabelle ist die Grundlage der Smoke-Suite in Akzeptanzkriterium 14.

| Event / Interaktion (heute) | v2-Entscheid | PRD-Referenz |
|-----------------------------|--------------|---------------|
| Globales dragenter/dragover/dragleave/drop (Datei/Ordner/ZIP) | Übernehmen; akzeptiert nur noch Snapshot/`env.json`/Pseudo/ZIP, Legacy-Formate abgewiesen mit Migrationshinweis | FR-6.7 (E25) |
| Dropzone-Button öffnet Dateiauswahl | Übernehmen (gleiche Dateiklassen) | FR-6.7 |
| Footer-Status-Klick lädt Datei | **Entfällt** — versteckte Aktion; Import nur Dropzone/Dateidialog | FR-6.7 (E25) |
| Profil-Switcher `change` | Übernehmen als Tenant-Switcher | FR-8.9 |
| Profil-«+» öffnet Dropzone für neues Profil | Übernehmen | FR-8.9 |
| Reset-Button | Übernehmen | §9.1 |
| Suchfeld `input` (Debounce), `focus`/`blur`/`change`, `keydown` (Enter, Shift+Enter, Pfeile), Resultat-`mousedown` (Auswahl/Shift-Add) | Übernehmen; Dropdown-UX identisch, Suchdomäne = sichtbare Typen × `identifiers` | FR-7.6, FR-8.4 |
| Tiefen-Stepper `click` / Hidden-Input `change`/`input` | Übernehmen; rendert reaktiv | FR-7.7, FR-8.11 |
| Richtungs-Toggle `click` | **Entfällt** | E22 |
| «Anzeigen»/Apply `click` | **Entfällt** — Rendering reaktiv | E23, FR-8.11 |
| «Animation fortsetzen» `click` | Übernehmen | FR-8.11 |
| Fit-to-Viewport `click` | Übernehmen | §9.2 |
| Simulation-Toggle `click` | Übernehmen | FR-8.10 |
| Hierarchie-Toggle `click` | Übernehmen als reiner Layout-Modus | FR-8.10 |
| Label-Toggle `click` (all/attributes/none) | Übernehmen, generalisiert: alle / nur `ring`-Badges / keine | FR-8.10 |
| Management-Toggle `click` | Übernehmen als Blatt-Filter (`leafProp`), Beschriftung generisch | FR-8.3 |
| Pseudonym-Toggle `click` + Passwortdialog (Enter/Cancel) | Übernehmen, typgeneralisiert | FR-8.5 |
| Debug-Toggle `click` | Übernehmen | FR-8.10 |
| Export-Dialog: öffnen/schliessen, ESC, Overlay-Klick, Format, Presets, Custom-Inputs, Download | Übernehmen | FR-8.8 |
| SVG-Knoten `drag` | Übernehmen (explizit) | FR-8.13 |
| SVG-Knoten `mousemove` Tooltip | Übernehmen, typ-/props-/diff-fähig | FR-8.13, FR-5.3 |
| SVG-Knoten `click` (auswählen/zentrieren) | Übernehmen, typgeneralisiert | FR-8.13 |
| SVG-Knoten `contextmenu` | Übernehmen ins einheitliche Menü | FR-8.7 (E24) |
| Globales `contextmenu.preventDefault` | Übernehmen, explizit | FR-8.7 |
| Legenden-Section-Header `click` expand/collapse | Übernehmen | FR-8.2, FR-8.10 |
| Hidden-Legende: Eintrag-Klick einblenden, Root-Visibility toggeln, Hover temporär sichtbar | Übernehmen | FR-8.2, FR-8.7 |
| Cluster-/OE-Legende: Row-Klick, Toggle-All, Auge, Filterfeld `input`, Row-Kontextmenü | Übernehmen als generische Cluster-Legende; Row-Menü konsolidiert | FR-8.2, FR-8.7 (E24) |
| Ring-/Attribut-Legende: Kategorie-Zeilen, Toggle-All, Auge, Shift-Klick-Fokus | Übernehmen ohne TSV-Speichern/Download | FR-8.2, FR-8.3, §9.4 |
| Attribut-Upload-Button, TSV-Live-Import per Drop, Kategorie-Speichern/Download/File-Handles, Attribut-Editier-Submenü, Fuzzy-Match-Dialog | **Entfällt** — Datenzufuhr via Snapshot/Crawl, Zuordnung im Migrationsskript | §9.3, §10 (FR-10.4) |
| View-Switcher im Footer | **Neu** | FR-7.5 |
| Zeit-Slider / Diff-Auswahl | **Neu** | FR-8.6 |

---

## 10. Einmalmigration Alt → Neu

**FR-10.1** Die Migration des alten Datenmodells ist **kein Bestandteil der App**, sondern ein separates, einmalig ausgeführtes Node-Skript `scripts/migrate-legacy.mjs`. Da die App nie distribuiert wurde, gibt es keine fremden Bestände — eine Einmalmigration der eigenen Datensätze (HRM, SBB-GD, SEM v1, Beispieldaten) genügt. **Voraussetzung ist ein einmaliges Registry-Bootstrap-Gate:** Vor der Migration wird der erste nicht-leere Commit von `schema/registry.json` erzeugt — Input sind die bekannten Legacy-Strukturen (`persons`, `orgs`, `links`, Attribut-Mapping) und die bisherigen SBB/SEM-Analysen, Output die für die Migration benötigten Typen, Kantentypen, Capabilities und `identityProps`. Dieses Gate ist der Grenzfall von Phase A mit bekannter Legacy-Quelle und leerer Registry (FR-6.1a); erst danach läuft das Migrationsskript — sonst könnte kein Migrations-Snapshot gegen die Registry validieren (FR-6.8), und Typen im Skript zu «erfinden» widerspräche dem Gate-Prinzip.

**FR-10.2 Input/Output.** Input: `data.json` (persons/orgs/links nach [DATA-FORMAT-SPEC.md](DATA-FORMAT-SPEC.md)), Attribut-TSVs, optional `pseudo.data.json`; Mapping-Konfiguration (das bisherige `ATTRIBUTE_TYPES`-Schema: `property` / `node` / `contextRole` pro Kategorie) liegt als Konfigblock im Skript bzw. daneben. Output: ein Snapshot (§3) pro Mandant, `meta.snapshot` aus dem Datum des Quellstands, `meta.scope` = alle migrierten Typen.

**FR-10.3 Abbildung.** `persons[]` → `type:"Person"` (`email`/`isBasis` → `props`); `orgs[]` → `type:"OE"`; Links P→P/P→OE/OE→OE → `berichtetAn`/`mitgliedIn`/`unterstellt`, wobei die Richtungen gemäss FR-7.2a **normalisiert** werden: Legacy Person→Person (Manager→Mitarbeiter) und Legacy OE→OE (Parent→Child) werden umgedreht, Legacy Person→OE bleibt; Attribut-Kategorien nach Mapping-Konfiguration (Heuristik als Default: numerisch oder unique pro Person → `props`; kategorisch/geteilt → Knoten + Kante; Kontext+Rolle → doppelt reifiziert nach FR-4.6). Die Ziel-Typnamen richten sich nach dem beim Migrationslauf gültigen Registry-Stand; die Nennungen hier sind Illustration (E14).

**FR-10.4 Identifier-Zuordnung.** Die bisher interaktive Fuzzy-Zuordnung (Attribut-Identifier → Person über ID/E-Mail/Name, Levenshtein ≤ 0.3) läuft im Skript: eindeutige Treffer automatisch, mehrdeutige und Nicht-Treffer als Report (`unmatched.csv` + Vorschlagsliste); ein manuell gepflegtes Mapping-File wird beim Re-Run berücksichtigt. Das Skript ist **idempotent** — gleicher Input + gleiches Mapping ⇒ identischer Output.

**FR-10.5 Verifikation.** Nach der Migration muss die Start-View «Personenhierarchie» mit den migrierten Daten dieselben Knoten- und Kantenzahlen liefern wie die alte App mit den Quelldaten (Brutto-Zahlen im Migrationsreport ausweisen).

---

## 11. Nicht-funktionale Anforderungen

| # | Anforderung |
|---|-------------|
| NFR-1 | Single-File-Auslieferung (`index.html`), offline via `file://`, keine Laufzeit-Dependencies ausser dem eingebetteten D3. |
| NFR-2 | Skalierung: Bestand bis mindestens **75k Knoten / 200k Kanten inkl. Versionsrecords** in IndexedDB (Referenzbestand: 62k Knoten / 114k Kanten an Identitäten); Projektion und Rendering bleiben flüssig, weil nie der Gesamtgraph gerendert wird (FR-8.1). Das Wachstum der Versionsrecords über viele Snapshots wird bewusst **ohne Vorab-Massnahmen** beobachtet (Entscheid 2026-07); Grenzwerte werden erst bei realem Bedarf nachgezogen. |
| NFR-3 | Import des SEM-Referenzbestands (62k Knoten- / 114k Kanten-Identitäten) dauert unter 30 s auf der Entwickler-Maschine, erzeugt keinen einzelnen Main-Thread-Block über 200 ms und zeigt innert 500 ms nach Import-Start eine Fortschrittsanzeige (Batch-Verarbeitung wie bei der heutigen Fuzzy-Suche). |
| NFR-4 | Idempotenz: Re-Import desselben Snapshots, Re-Run des Crawls auf derselben Seite und Re-Run des Migrationsskripts sind No-ops bzw. deterministisch. |
| NFR-5 | Typ-Agnostik ist prüfbar: kein kanonischer Typname als String-Literal im **Engine-Code** (Lint-Regel/Testsuche). Engine-Code = `src/sections/*.js` und die daraus gebaute `index.html`. **Nicht** Engine-Code und damit ausgenommen: Registry und Snapshots (Daten), `env.json`/`VIEWS` inkl. Start-View (Konfiguration), Test-Fixtures und Playwright-Szenarien, Migrationsskript, das Akquise-Tooling (`data/crawling/**` — Harvest-Skripte und -Specs dürfen Typnamen tragen, E26) sowie die Akzeptanzkriterien dieses PRD. |
| NFR-6 | Pseudonymisierung wirkt überall, wo Labels erscheinen (Graph, Legenden, Tooltips, Suche, Export). |
| NFR-7 | Die bestehende hohe Testabdeckung bleibt verbindliche Engineering-Leitplanke: neue Parser-, Import-, Diff-, View-Projektions- und Migrationslogik wird automatisiert getestet; die bestehende Coverage-Grenze wird nicht abgesenkt. |
| NFR-8 | Build-Prinzipien: OrgGraph bleibt eine dependency-arme Vanilla-JS/D3-App. Entwicklung erfolgt modular in `src/sections/*.js`; der Build erzeugt eine einzelne offline lauffähige `index.html`. Keine Frameworks, kein Server, keine Runtime-Bundles, keine Backend-Services; IndexedDB ist die einzige lokale Persistenz. Build und Tests laufen lokal über Node/NPM, die ausgelieferte App benötigt nur Browser + eingebettetes D3. |

---

## 12. Ausbaustufen (v2+)

- Speichern eigener Views (aktuelle Projektion als benannte View im Tenant-Store, erscheint im Footer-Switcher).
- Kleines GQL/openCypher-Subset für Ad-hoc-Abfragen (ISO/IEC 39075:2024) — nur falls deklarative Views nicht mehr reichen.
- Property-Verlaufs-Ansicht pro Knoten (Timeline aus der Versionsfolge).
- Persistente Laufzeit-Übersteuerungen (roots/Tiefe pro Profil merken).

---

## 13. Akzeptanzkriterien

Konkrete Typ- und Personennennungen in den Kriterien sind Fixture- und Datenebene (E14, NFR-5-Ausnahme), kein Engine-Code-Auftrag; Mengenangaben folgen den Begriffsebenen aus §2 (Identitäten / Versionsrecords / sichtbare Projektion).

1. **Zahlenmässige Äquivalenz (hart, automatisiert):** Die Start-View rendert den migrierten SEM-Referenzbestand mit exakt denselben Brutto-Zahlen wie die heutige App in der Referenz `PRD-Reference-Screenshot.png` (v1.27.14; geladen 62 144 Knoten- / 113 874 Kanten-Identitäten / 9 045 OEs; Wurzel «Vincenzo Mascioli», Tiefe 3: **487 sichtbare Knoten, 793 sichtbare Kanten**, 69/69 Ring-Gruppen, 7/2778 ausgeblendet). Geprüft per Playwright: Elementzählung pro SVG-Ebene (Knoten, Kanten, Cluster-Hüllen, Ringe) und Legenden-Einträge — exakter Match.
2. **Visuelle Äquivalenz (dokumentierte Sichtprüfung):** Playwright-Screenshot derselben Szene (gleicher Datenstand, gleiche Wurzel/Tiefe — die Abstiegsrichtung ist im View-Pfad kodiert, E22 —, Viewport wie Referenz) wird neben `PRD-Reference-Screenshot.png` abgelegt und verglichen; da das Force-Layout nicht deterministisch ist, gilt Kriterium 1 als harte Prüfung, der Screenshot-Vergleich dokumentiert Layout-Charakter, Farben, Ringe, Legenden und Footer.
3. Ein AdminDir-Crawl über die volle Pipeline (Phase A → Gate → Phase A.5 → Phase B, FR-6.1) liefert nach abgeschlossenem Gate und versionierter Harvest-Spezifikation einen validen Snapshot mit `meta.scope`, der **ohne manuelle Nachbearbeitung der Snapshot-Datei** importierbar ist. Phase A läuft ohne LLM (E27); Gate und Phase-A.5-Review dürfen manuell bzw. mit LLM-Unterstützung erfolgen, erzeugen aber versionierte Repo-Artefakte.
4. Zwei Snapshots desselben Scopes mit einer entfernten Identität, einer geänderten skalaren Property und einem neuen Knoten ergeben nach Import: geschlossene Version, zwei Versionen mit Property-Diff, neue Identität — und der `diff`-Modus zeigt alle drei Fälle an.
5. Ein Snapshot mit engem Scope (einzelner Knoten- und Kantentyp) lässt den restlichen Bestand unangetastet.
6. Ein Re-Import desselben Snapshots ändert nichts (Toast: «bereits importiert»).
7. Ein neuer Knotentyp, nur in Registry und View deklariert, erscheint mit Farbe, Legende, Suche und Rendering ohne jede Codeänderung.
8. Such-Combo mit Shift-Add, Tiefen-Toggle, Blatt-Filter, Pseudonymisierung, SVG/PNG-Export und Profil-Switcher funktionieren wie heute; der Richtungs-Toggle und der «Anzeigen»-Button existieren nicht mehr (E22/E23), Rendering reagiert direkt auf Parameter-Änderungen (FR-8.11).
9. NFR-5-Prüfung (kein Typname im Engine-Code) besteht.
10. Die NFR-3-Grenzwerte (Importdauer < 30 s, kein Main-Thread-Block > 200 ms, Fortschritt < 500 ms) werden mit dem SEM-Referenzbestand eingehalten und gemessen protokolliert.
11. **Schema-Validierung:** Registry, jeder erzeugte Snapshot (Crawl und Migration), jeder Analyse-Report (Source Contract) und die `VIEWS`-Konfiguration validieren gegen ihre JSON Schemas (`registry.schema.json`, `snapshot.schema.json`, `analysis.schema.json`, `view.schema.json`).
12. **Kantenrichtungs-Migrationstest:** Ein Legacy-Bestand mit Manager→Mitarbeiter- und Parent→Child-Links ergibt nach der Migration ausschliesslich Hierarchie-Kanten vom Untergeordneten zum Übergeordneten (FR-7.2a), und die BFS-Ordnung der Start-View reproduziert den heutigen Baum.
13. **Scope-Löschtest mit Root-Begrenzung:** Ein Snapshot mit `scope.roots` auf einen Teilbaum schliesst verschwundene Identitäten nur innerhalb dieses Teilbaums (FR-5.5a); identisch fehlende Identitäten ausserhalb bleiben offen.
14. **UI-Interaktionsinventar:** Eine Playwright-Smoke-Suite weist §9.5 nach — alle mit «Übernehmen»/«Neu» markierten Interaktionen sind vorhanden und reagieren; alle mit «Entfällt» markierten UI-Elemente existieren nicht mehr.

---

## 14. Offene Punkte

1. Zeit-UI-Detail: Platzierung und Form von asOf-Slider und Diff-Auswahl (Toolbar vs. Footer), Verhalten bei nur einem Snapshot-Stand.
2. Pseudonym-Pools für neue Knotentypen (Rolle, Projekt, Firma, …): eigene Pools oder generischer Fallback (`<Typ> N`)?
3. Speicher-Layout der Versionen in IndexedDB (ein Record pro Version vs. Versions-Array pro Identität) — Implementierungsentscheid, im PRD bewusst offen.

Gelöst seit der ersten Fassung: Das Registry-Format ist nicht mehr offen — es ist als JSON Schema in `schema/registry.schema.json` definiert (FR-4.1).
