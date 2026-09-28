"use strict";
// Unit tests voor de rules engine en de mock-classifier. Geen LLM nodig.
// Run:  node poc/test.js

const assert = require("assert");
const {
  loadSelectielijst,
  resolveRegel,
  waardeer,
  berekenMoment,
  checkHotspots,
  runChain,
  addYears,
} = require("./rules-engine");
const { mockClassify } = require("./classify");

let n = 0;
function ok(name, fn) {
  fn();
  n++;
  console.log("  \u2713 " + name);
}

console.log("POC tests\n");

console.log("rules-engine:");
ok("selectielijst laadt en bevat procestypen", () => {
  const sl = loadSelectielijst();
  assert.ok(sl.procestypen.length >= 4);
  assert.ok(sl.versie);
});

ok("resolveRegel vindt VERGUNNING/VERLEEND", () => {
  assert.strictEqual(resolveRegel("VERGUNNING", "VERLEEND").regelCode, "V1");
});

ok("waardeer VERGUNNING/VERLEEND = V, 10 jaar", () => {
  const w = waardeer("VERGUNNING", "VERLEEND");
  assert.strictEqual(w.waardering, "V");
  assert.strictEqual(w.bewaartermijnJaren, 10);
});

ok("waardeer BOUW/VERGUND = B (blijvend)", () => {
  const w = waardeer("BOUW", "VERGUND");
  assert.strictEqual(w.waardering, "B");
  assert.strictEqual(w.bewaartermijnJaren, null);
  assert.ok(w.overbrengingstermijnJaren > 0);
});

ok("onbekend procestype/resultaat geeft null", () => {
  assert.strictEqual(resolveRegel("BESTAAT-NIET", "X"), null);
});

ok("addYears rekent correct (incl. schrikkeldag)", () => {
  assert.strictEqual(addYears("2020-02-29", 1), "2021-03-01");
  assert.strictEqual(addYears("2024-01-15", 10), "2034-01-15");
});

ok("berekenMoment V: vernietigingsdatum = start + termijn", () => {
  const m = berekenMoment("2024-01-01", "V", 10, null);
  assert.strictEqual(m.type, "vernietiging");
  assert.strictEqual(m.vernietigingsdatum, "2034-01-01");
});

ok("berekenMoment B: overbrengingsdatum = start + 20", () => {
  const m = berekenMoment("2024-01-01", "B", null, 20);
  assert.strictEqual(m.type, "overbrenging");
  assert.strictEqual(m.overbrengingsdatum, "2044-01-01");
});

ok("checkHotspots detecteert geraakte hotspot", () => {
  const h = checkHotspots(["MILIEU"]);
  assert.strictEqual(h.geraakt, true);
  assert.strictEqual(h.hotspots[0].code, "MILIEU");
});

ok("runChain produceert volledige audit", () => {
  const c = runChain({
    procestypeCode: "VERGUNNING",
    resultaatCode: "VERLEEND",
    termijnstartdatum: "2024-01-01",
    dossierafsluitdatum: "2023-12-31",
    hotspotCodes: [],
  });
  assert.strictEqual(c.waardering, "V");
  assert.strictEqual(c.vernietigingsdatum, "2034-01-01");
  assert.strictEqual(c.selectielijstversie, loadSelectielijst().versie);
  assert.ok(c.termijntrigger.length > 0);
});

console.log("\nclassify (mock):");
ok("classificeert vergunning-dossier correct", () => {
  const k = mockClassify({
    naam: "Horecavergunning",
    documenten: [
      { naam: "besluit.pdf", tekst: "De vergunning wordt verleend voor de exploitatie van een horecagelegenheid." },
    ],
  });
  assert.strictEqual(k.procestypeCode, "VERGUNNING");
  assert.strictEqual(k.resultaatCode, "VERLEEND");
});

ok("classificeert bouwdossier als blijvend (B)", () => {
  const k = mockClassify({
    naam: "Bouwdossier",
    documenten: [
      { naam: "bouwtekening.pdf", tekst: "Bouwaanvraag voor een aanbouw; de omgevingsvergunning is vergund en het bouwwerk is opgeleverd." },
    ],
  });
  assert.strictEqual(k.procestypeCode, "BOUW");
  assert.strictEqual(k.resultaatCode, "VERGUND");
});

ok("geen trefwoorden -> NIET_CLASSIFICEERBAAR", () => {
  const k = mockClassify({ naam: "onbekend", documenten: [{ naam: "x.pdf", tekst: "lorem ipsum dolor" }] });
  assert.strictEqual(k.status, "NIET_CLASSIFICEERBAAR");
  assert.strictEqual(k.procestypeCode, null);
});

console.log(`\nAlle ${n} tests geslaagd \u2705`);
