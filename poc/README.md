# POC — classificatie van DMS-informatie met een private LLM

Eerste toetsbare stap van de POC: het **datamodel** (voorbeeld-selectielijst) en de
**deterministische rules engine**, met een eenvoudige classifier (mock + optioneel LLM).

## Waarom deze opzet?

De keten is bewust gesplitst:

- **LLM (`classify.js`)** — begrijpt en classificeert een dossier naar een
  **procestype + resultaat** binnen voorgeschreven categorieën. Het LLM bepaalt
  **nooit** zelf een bewaartermijn of vernietigingsdatum.
- **Rules engine (`rules-engine.js`)** — vertaalt procestype + resultaat
  deterministisch naar selectielijstregel → **B/V** → termijn(trigger) →
  termijnstart → vernietigings-/overbrengingsmoment.

```
Document → Dossier → Procestype → Resultaat → Selectielijstregel
         → Waardering → Termijnregel → Termijnstart → Vernietigings-/overbrengingsmoment
```

## Bestanden

| Bestand | Inhoud |
|---|---|
| `selectielijst.json` | Voorbeeld-selectielijst (procestypen, resultaten, regels, B/V, termijnen, triggers, hotspots) |
| `rules-engine.js` | Deterministische engine (waardering + datums) |
| `classify.js` | Classifier: `mock` (trefwoorden) of `llm` (private LLM, structured output) |
| `data/dossiers.json` | Fictieve proefdataset |
| `data/referentieset.json` | Menselijke referentieset (ground truth) |
| `run.js` | CLI: draait de keten en vergelijkt met de referentieset |
| `test.js` | Unit tests voor de rules engine + mock-classifier |

## Draaien en testen

```bash
node poc/test.js          # unit tests (geen LLM nodig, direct resultaat)
node poc/run.js           # keten over de proefdataset met mock-classifier
node poc/run.js --llm     # idem, maar met de echte private LLM (kan traag zijn)
```

Of via npm:

```bash
npm run poc:test
npm run poc
npm run poc:llm
```

De volledige audit (per dossier: classificatie, confidence, evidence, waardering,
termijn, datums, uitzonderingen) staat na elke run in `poc/output/audit.json`.

## Belangrijk

- De selectielijst in `selectielijst.json` is **fictief** en alleen bedoeld om de
  keten te demonstreren; gebruik deze niet als formele selectielijst.
- `--llm` leest de key uit `.env` (alleen server-side) en kan door de trage
  endpoint lang duren of een timeout geven. Gebruik voor snel testen de mock-engine.
- Een aanpassing van de selectielijst (een JSON-bestand) vereist **geen** hertraining
  van het LLM — alleen de rules engine leest dit bestand.
