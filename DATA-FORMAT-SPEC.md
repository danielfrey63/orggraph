# Datenformat-Spezifikation für OrgGraph (Legacy v1)

> **Legacy bis Big Bang (PRD §1.6, E10).** Dieses Dokument beschreibt das **Alt-Format v1** (persons/orgs/links + Attribut-TSV). Es hat für OrgGraph 2.0 keine normative Kraft und dient ausschliesslich als Referenz für das Einmal-Migrationsskript (PRD §10). Das aktuelle Snapshot-Format ist in [SNAPSHOT-FORMAT-SPEC.md](SNAPSHOT-FORMAT-SPEC.md) und [PRD.md §3](PRD.md) definiert.

Ziel: Ein Skript soll zwei Arten von Artefakten generieren:

1. **Den Basis-Graphen** — eine JSON-Datei mit Personen, Organisationseinheiten und Beziehungen.
2. **Attribut-Dateien** — eine oder mehrere Textdateien, die Personen zusätzliche Merkmale zuordnen.

Alle Dateien sind **UTF-8** (keine BOM nötig). Die App ist eine reine Browser-Anwendung; das Skript erzeugt nur statische Dateien.

---

## 1. Basis-Graph (Datensatz-JSON)

### Struktur

Ein einzelnes JSON-Objekt auf oberster Ebene mit drei Arrays. Alle drei sind technisch optional (fehlend = leeres Array), aber für einen sinnvollen Graphen werden alle drei benötigt:

```json
{
  "persons": [ ... ],
  "orgs":    [ ... ],
  "links":   [ ... ]
}
```

### `persons` — Personen-Knoten

Array von Objekten:

| Feld      | Typ     | Pflicht | Bedeutung |
|-----------|---------|---------|-----------|
| `id`      | string  | ja      | Eindeutige ID. Wird intern zu String gecastet — Zahlen funktionieren, werden aber als String behandelt. Muss eindeutig über **alle** Personen **und** Orgs sein (gemeinsamer ID-Raum). Objekte ohne wahrheitswertes `id` werden verworfen. |
| `label`   | string  | ja      | Anzeigename (z. B. „Max Mustermann"). |
| `email`   | string  | nein    | E-Mail-Adresse. Dient als zweiter Identifier beim Zuordnen von Attributen. |
| `isBasis` | boolean | nein    | `true` = Person ohne unterstellte Mitarbeiter (Blatt-Knoten). Wird bei aktivem Management-Filter ausgeblendet. Fehlend oder `false` = Manager (hat Mitarbeiter). |

Zusätzliche Felder bleiben erhalten (werden durchgereicht), beeinflussen die Kern-Logik aber nicht.

### `orgs` — Organisationseinheiten-Knoten

Array von Objekten:

| Feld    | Typ    | Pflicht | Bedeutung |
|---------|--------|---------|-----------|
| `id`    | string | ja      | Eindeutige ID im **gemeinsamen** ID-Raum mit den Personen. Objekte ohne `id` werden verworfen. |
| `label` | string | ja      | Name der Organisationseinheit (z. B. „Bundeskanzlei"). |

### `links` — Beziehungen (gerichtete Kanten)

Array von Objekten:

| Feld     | Typ            | Pflicht | Bedeutung |
|----------|----------------|---------|-----------|
| `source` | string\|object | ja      | Quell-ID. Entweder direkt die ID-String oder ein Objekt mit `.id`. |
| `target` | string\|object | ja      | Ziel-ID, gleiche Konvention. |

**Drei semantische Kantentypen** (unterschieden allein über die Knotentypen der Endpunkte — es gibt kein `type`-Feld):

| Von → Nach      | Richtung / Bedeutung |
|-----------------|----------------------|
| Person → Person | **Vorgesetzter → Mitarbeiter** (`source` = Manager, `target` = unterstellte Person). |
| Person → Org    | **Mitgliedschaft** (`source` = Person, `target` = ihre OE). |
| Org → Org       | **Hierarchie**: `source` = **übergeordnete** OE, `target` = **untergeordnete** OE (Parent → Child). Die OE-Wurzeln sind die Orgs, die nie als `target` einer Org→Org-Kante auftreten. |

### Validierungsregeln / Edge-Cases (vom Parser erzwungen)

Das Skript sollte bereits sauber generieren, damit nichts stillschweigend verworfen wird:

- **Dangling Links**: Eine Kante, deren `source` oder `target` auf keine existierende Person/Org zeigt, wird **kommentarlos entfernt**.
- **Self-Loops**: `source === target` wird entfernt.
- **Duplikate**: Mehrfach identische gerichtete Kanten (`source>target`) werden dedupliziert. `A→B` und `B→A` sind verschieden und bleiben beide erhalten.
- **ID-Kollision**: Personen- und Org-IDs teilen sich einen Namensraum — eine Person und eine Org dürfen **nicht** dieselbe `id` haben.
- IDs werden überall als String verglichen (`"123"` und `123` sind gleich).

### Minimalbeispiel

```json
{
  "persons": [
    { "id": "p-123", "label": "Max Mustermann", "email": "max@example.ch", "isBasis": true },
    { "id": "p-456", "label": "Anna Müller",    "email": "anna@example.ch" }
  ],
  "orgs": [
    { "id": "10000025", "label": "Bundeskanzlei" }
  ],
  "links": [
    { "source": "p-456", "target": "p-123" },
    { "source": "p-123", "target": "10000025" },
    { "source": "p-456", "target": "10000025" }
  ]
}
```

Lesart: Anna (Managerin) führt Max (Blatt-Knoten, keine Mitarbeiter); beide sind Mitglieder der Bundeskanzlei.

---

## 2. Attribut-Dateien

### Format

Reine Textdateien mit Endung **`.tsv`**, **`.csv`** oder **`.txt`**. Eine Zeile pro Zuordnung:

```
<identifier><Trennzeichen><attributname>[<Trennzeichen><wert>]
```

- **`identifier`** (Spalte 1, Pflicht): Entweder die **Personen-`id`** oder die **`email`** der Person aus dem Basis-Graphen. Das Matching ist **case-insensitive** und **exakt** (kein Fuzzy beim Generieren nötig — exakte IDs/E-Mails verwenden).
- **`attributname`** (Spalte 2, Pflicht): Name des Attributs (z. B. „Pensioniert 2025", „Kaderstufe 3").
- **`wert`** (Spalte 3, optional): Beliebiger Attributwert. Fehlt er, wird intern `"1"` angenommen. Laden/Speichern ist verlustfrei.

### Trennzeichen

**Pro Zeile** automatisch erkannt: Enthält die Zeile ein **Tab**, wird Tab als Trennzeichen genutzt, sonst **Komma**. Empfehlung fürs Skript: durchgängig **Tab** verwenden (TSV) — dann sind Kommas in Werten/Namen unproblematisch.

### Kategorie = Dateiname

Der **Dateiname ohne Endung** wird zur **Kategorie**. Die Legende gruppiert hierarchisch `Kategorie → Attribut`. Pro Sachgebiet also eine eigene Datei, z. B.:

- `Pensionierung.tsv`
- `Kaderstufe.tsv`
- `Sprachregion.csv`

### Zeilen-/Datei-Regeln

- Leerzeilen werden ignoriert.
- Zeilen mit weniger als 2 Spalten werden übersprungen.
- Alle Felder werden getrimmt (führende/folgende Leerzeichen entfernt).
- Mehrere Zeilen mit demselben Identifier akkumulieren mehrere Attribute für dieselbe Person.
- Eine **komplett leere Datei** ist gültig und registriert die Kategorie als Platzhalter (ohne Attribute).
- Ein Identifier, der auf keine Person im Datensatz passt, wird ignoriert (in der App via Fuzzy-Dialog behandelt) — das Skript sollte aber nur existierende IDs/E-Mails ausgeben.

### Beispiel `Kaderstufe.tsv` (Tab-getrennt)

```
p-456	Kaderstufe	GL
max@example.ch	Kaderstufe	Fachkader
p-456	Funktion	Direktorin
```

Lesart: Person `p-456` erhält in der Kategorie „Kaderstufe" zwei Attribute (`Kaderstufe=GL`, `Funktion=Direktorin`); Max wird hier über seine E-Mail adressiert.

---

## 3. Optional: env.json (Auto-Laden)

Nur relevant, wenn die Dateien über einen Server automatisch geladen werden sollen (beim reinen Drag&Drop nicht nötig). Eine `env.json` referenziert die anderen Dateien:

```json
{
  "DATA_URL": "./data.json",
  "DATA_ATTRIBUTES_URL": ["./Kaderstufe.tsv", "./Pensionierung.tsv"],
  "DATA_ATTRIBUTES_DIR": "./attributes/"
}
```

- `DATA_URL`: Pfad zur Datensatz-JSON.
- `DATA_ATTRIBUTES_URL`: einzelne Datei (String) oder Liste von Attribut-Dateien.
- `DATA_ATTRIBUTES_DIR`: Verzeichnis(se), aus denen alle Attribut-Dateien per Directory-Listing gezogen werden.

(Weitere `TOOLBAR_*`-Schlüssel steuern nur UI-Defaults und sind für die Datengenerierung irrelevant.)

---

## Zusammenfassung der Liefergegenstände des Skripts

1. **`data.json`** — Objekt mit `persons[]`, `orgs[]`, `links[]` nach obigen Regeln (konsistente IDs, keine Dangling Links, korrekte Kantenrichtungen).
2. **Eine oder mehrere Attribut-Dateien** (`.tsv`/`.csv`/`.txt`) — je Sachgebiet eine Datei, Zeilen `identifier⇥attribut⇥wert`, Identifier = exakte Personen-`id` oder `email`.
3. *(optional)* **`env.json`**, falls die Artefakte serverseitig automatisch geladen werden sollen.
