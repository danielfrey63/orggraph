# OrgGraph

Minimaler statischer D3-Graph. Benutzer kann Startknoten wählen und Such-Tiefe konfigurieren.

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
- **Tiefe**: Anzahl BFS-Stufen ab Startknoten
- **Management-Checkbox**: Standardmäßig aktiviert - blendet Personen ohne Mitarbeiter (Blätter) aus
- **Button „Anzeigen"**: Rendert den Teilgraphen
- **OE-Legende**: Organisationseinheiten ein-/ausblenden (Rechtsklick für Subtree-Aktionen)

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
