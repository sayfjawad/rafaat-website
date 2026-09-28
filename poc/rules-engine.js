"use strict";
// Deterministische rules engine: formele toepassing van de selectielijst.
// Het LLM levert alleen procestype + resultaat (en onderbouwing); dit bestand
// bepaalt waardering (B/V), termijn(trigger) en vernietigings-/overbrengingsmoment.
// Geen LLM-logica hier — dit is bewust gescheiden van de AI-classificatie.

const fs = require("fs");
const path = require("path");

const SELECTIELIJST = path.join(__dirname, "selectielijst.json");
let cache = null;

function loadSelectielijst() {
  if (!cache) cache = JSON.parse(fs.readFileSync(SELECTIELIJST, "utf8"));
  return cache;
}

function addYears(dateStr, years) {
  const d = new Date(String(dateStr) + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function findResultaat(procestypeCode, resultaatCode) {
  const sl = loadSelectielijst();
  const pt = sl.procestypen.find((p) => p.code === procestypeCode);
  if (!pt) return null;
  const r = pt.resultaten.find((x) => x.code === resultaatCode);
  return r ? { procestype: pt, resultaat: r } : null;
}

function resolveRegel(procestypeCode, resultaatCode) {
  const m = findResultaat(procestypeCode, resultaatCode);
  if (!m) return null;
  return {
    procestype: m.procestype,
    resultaat: m.resultaat,
    regelCode: m.resultaat.regel,
    selectielijstregel: m.resultaat.selectielijstregel,
  };
}

function waardeer(procestypeCode, resultaatCode) {
  const m = findResultaat(procestypeCode, resultaatCode);
  if (!m) return { gevonden: false, error: "Onbekend procestype/resultaat" };
  const r = m.resultaat;
  return {
    gevonden: true,
    waardering: r.waardering, // "B" of "V"
    bewaartermijnJaren: r.waardering === "V" ? r.bewaartermijnJaren : null,
    overbrengingstermijnJaren:
      r.waardering === "B" ? loadSelectielijst().overbrengingstermijnJaren : null,
    termijntrigger: r.termijntrigger,
    selectielijstregel: r.selectielijstregel,
    regelCode: r.regel,
  };
}

function berekenMoment(termijnstart, waardering, bewaartermijnJaren, overbrengingstermijnJaren) {
  if (!termijnstart) return { onzeker: true, reden: "Geen termijnstartdatum" };
  if (waardering === "B") {
    return {
      onzeker: false,
      type: "overbrenging",
      overbrengingsdatum: addYears(termijnstart, overbrengingstermijnJaren || 20),
      termijnstart,
    };
  }
  if (waardering === "V") {
    return {
      onzeker: false,
      type: "vernietiging",
      vernietigingsdatum: addYears(termijnstart, bewaartermijnJaren),
      termijnstart,
    };
  }
  return { onzeker: true, reden: "Waardering is noch B noch V" };
}

function checkHotspots(hotspotCodes) {
  const sl = loadSelectielijst();
  const codes = Array.isArray(hotspotCodes) ? hotspotCodes : [];
  const hotspots = sl.hotspotcriteria.filter((h) => codes.includes(h.code));
  return { geraakt: hotspots.length > 0, hotspots };
}

function runChain(input) {
  const regels = resolveRegel(input.procestypeCode, input.resultaatCode);
  if (!regels) {
    return {
      status: "ONBEKEND",
      error: "Onbekend procestype/resultaat",
      procestypeCode: input.procestypeCode,
      resultaatCode: input.resultaatCode,
    };
  }
  const w = waardeer(input.procestypeCode, input.resultaatCode);
  const moment = berekenMoment(
    input.termijnstartdatum,
    w.waardering,
    w.bewaartermijnJaren,
    w.overbrengingstermijnJaren
  );
  const hotspot = checkHotspots(input.hotspotCodes);

  return {
    status: "OK",
    selectielijstversie: loadSelectielijst().versie,
    procestype: regels.procestype.naam,
    resultaat: regels.resultaat.naam,
    procestypeCode: regels.procestype.code,
    resultaatCode: regels.resultaat.code,
    selectielijstregel: w.selectielijstregel,
    regelCode: w.regelCode,
    waardering: w.waardering,
    bewaartermijnJaren: w.bewaartermijnJaren,
    overbrengingstermijnJaren: w.overbrengingstermijnJaren,
    termijntrigger: w.termijntrigger,
    dossierafsluitdatum: input.dossierafsluitdatum || null,
    termijnstartdatum: input.termijnstartdatum || null,
    ...moment,
    uitzondering: hotspot.geraakt,
    hotspots: hotspot.hotspots,
  };
}

module.exports = {
  loadSelectielijst,
  resolveRegel,
  waardeer,
  berekenMoment,
  checkHotspots,
  runChain,
  addYears,
};
