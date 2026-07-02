# Crawling-Auftrag — OrgGraph

Ausführbarer Auftrag für das **Claude-Chrome-Plugin** auf der bereits offenen Seite.
**Quelle** = die aktuell offene Seite und ihre Folgeseiten. **Ergebnis** = Download einer
Graph-Snapshot-JSON. Zielmodell-Details: [GRAPH-MODEL-SPEC.md](GRAPH-MODEL-SPEC.md).

---

## Auftrag

Analysiere **alle Zusammenhänge** auf der offenen Seite und ihren Folgeseiten und crawle
sie **direkt ins Graph-Modell**. Zweistufig: **Phase A (Analyse)** → **Gate** → **Phase B
(Voll-Crawl)**. Nur lesen — keine Klicks auf Aktionen, keine Formulare, kein State-Change.

Der vollständige Graph entsteht aus **mehreren, ggf. unterschiedlich strukturierten
Seiten** (Übersichtstabellen, Detailseiten, Themen-/Trainings-/Projektseiten) — jede
trägt eine **Teilmenge** der Typen bei. Über alle hinweg wird **in IndexedDB
konsolidiert** (übersteht die Navigation, dedupliziert, resume-fähig); am Ende **einmal
exportiert** (§Konsolidierung & Export). Ein Snapshot enthält nur die tatsächlich
gecrawlten Typen (`schema` = Teilmenge).

---

## Kanonische Typen

Alles in diese Typen mappen. Neue Typen **nur** über das Gate.

**Knoten**

| Typ | Bedeutung | ID |
|-----|-----------|----|
| `Person` | Mensch | Quell-PK / E-Mail |
| `OE` | Organisationseinheit | Quell-OE-ID |
| `AufbauOrg` | Aufbauorg-Code | Code |
| `Rolle` | Funktion/Rolle | slug(Label) |
| `Team` | Team/Workstream | slug(Label) |
| `Gremium` | Board/Gremium | slug(Label) |
| `Training` | Training/Kohorte | slug(Label) |
| `Projekt` | Projekt/Thema | slug(Label) |
| `Firma` | externe Firma | slug(Label) |
| `Standort` | Adresse/Standort (Adressdetails als props) | slug(Label) |
| `Gebäude` | Gebäude | slug(Label) |

**Kanten**

| Typ | from → to | hierarchy |
|-----|-----------|-----------|
| `unterstellt` | OE → OE | ✓ |
| `mitgliedIn` | Person → OE | ✓ |
| `berichtetAn` | Person → Person | ✓ |
| `leitet` | Person → OE | |
| `vertritt` | Person → OE | |
| `amStandort` | Person/OE → Standort | |
| `imGebäude` | Person → Gebäude | |
| `gehoertZu` | Person → AufbauOrg | |
| `hatRolle` | Person → Rolle | |
| `imTeam` | Person → Team | |
| `imGremium` | Person → Gremium | |
| `besuchte` | Person → Training | |
| `arbeitetAn` | Person → Projekt | |
| `beauftragt` | Person → Firma (`props.rolle`) | |

**Attribute** (Reifizierungsregel, [GRAPH-MODEL-SPEC §3](GRAPH-MODEL-SPEC.md)):
- **geteilt/kategorisch** (Rolle, Team, Training, Projekt, …) → eigener **Knoten + Kante**.
- **skalar/unique** (E-Mail, Mobil, Pensum, …) → **`props` am Knoten** (kein eigener Store).

---

## Phase A — Analyse

1. Inventarisiere über **alle Folgeseiten** jede vorkommende Knoten- und Beziehungs-Art
   (Überschriften, Tabellenspalten, Attribut-Kategorien, Linkarten, wiederkehrende Werte);
   Zählung in IndexedDB akkumulieren.
2. Gleiche jede Art gegen die kanonischen Typen ab.
3. Gib einen Report aus und **stoppe**:

```json
{
  "known":   [ { "candidate": "Rollen-Spalte", "mappedTo": "Rolle/hatRolle", "count": 122 } ],
  "untyped": [ { "candidate": "QRM-Board", "samples": ["Anna M.", "…"], "count": 12, "vermutung": "Gremium?" } ]
}
```

---

## Gate

Pro `untyped`-Eintrag entscheiden: **bekanntem Typ zuordnen** / **neuen Typ aufnehmen** /
**als `property` führen** / **ignorieren**. Danach Phase B.

---

## Phase B — Voll-Crawl

1. Extrahiere vollständig über **alle Folgeseiten**, ausschliesslich über bekannte Typen.
2. Bevorzugt interne JSON-API (Network-Tab); sonst DOM.
3. **Identität:** stabile ID vom Quell-PK — in strukturierten Quellen (Telefonbuch,
   Organigramm, Verzeichnis) ist jede Entität direkt **verlinkt**; die ID steckt im
   **Link-Ziel / der URL** (sonst E-Mail oder Quell-OE-ID). Beziehungen referenzieren das
   verlinkte Ziel, nicht den Anzeigenamen. Fehlt jede stabile Kennung, `slug(Label)` mit
   `props.idSource='name'`.
4. **In IndexedDB upserten** → dedupliziert über Seiten hinweg; Re-Run derselben Seite ändert nichts.
5. **Labels normalisieren:** De-Gendering (`Mitarbeiter:innen`→`Mitarbeiter`), Doppelpunkte/`(innen)` weg, Whitespace kollabieren.
6. **Nichts ungetypt:** Unklares als `props.unclassified` markieren, nicht weglassen.
7. Folge-IDs bzw. -Seiten gechunkt abarbeiten (Batches ~5, randomisierte Pausen); bei Drosselung (429/5xx) mit Backoff wiederholen.

---

## Konsolidierung & Export

**1. IndexedDB anlegen** (auf der Quell-Origin) — überlebt Seitennavigation, dient als
Konsolidierungs-Speicher über alle Seiten/Quellen hinweg:

```js
// DB orggraph-crawl, Version 1
db.createObjectStore('nodes', { keyPath: 'id' });               // dedup über Knoten-id
db.createObjectStore('edges', { keyPath: 'key' });             // key = `${type}|${source}|${target}`
```

**2. Konsolidieren** — jede Seite **upsertet** in dieselbe DB: Knoten nach `id`, Kanten nach
`key`. Dedupliziert; Re-Run idempotent; resume-fähig.
Auch **Basisquellen** (z. B. der Personen-OE-Graph mit der Hierarchie `berichtetAn`/`unterstellt`)
werden in **denselben** Store gemerged, nicht nur die Enrichment-Seiten.

**3. Exportieren** — am Schluss `nodes` + `edges` auslesen, `meta` + `schema` (= verwendete Typen)
ergänzen und **eine Datei** `crawl-<quelle>-<YYYYMMDD-HHMM>.json` **als Download** ausgeben (nicht
Console). Den Store erst **nach bestätigtem Export** leeren.

```json
{
  "meta":   { "source": "<URL>", "crawledAt": "<ISO>", "snapshot": "YYYYMMDD-HHMM" },
  "schema": { "nodeTypes": { "…": {} }, "edgeTypes": { "…": {} } },
  "nodes":  [ { "id": "p-…", "type": "Person", "label": "…", "props": { "email": "…" } } ],
  "edges":  [ { "type": "hatRolle", "source": "p-…", "target": "rolle-…" } ]
}
```

`schema` = nur die tatsächlich verwendeten Typen. `meta.snapshot` im Format `YYYYMMDD-HHMM`.

```js
const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
const a = Object.assign(document.createElement('a'),
  { href: URL.createObjectURL(blob), download: `crawl-${SOURCE}-${stamp}.json` });
document.body.appendChild(a); a.click(); a.remove();
```
