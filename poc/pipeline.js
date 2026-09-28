"use strict";
// Gedeelde kern van de POC: draait de hele keten (classificatie + rules engine)
// over de proefdataset en vergelijkt met de referentieset. Wordt gebruikt door
// zowel de CLI (run.js) als de web-API (server.js -> /api/poc/run).

const fs = require("fs");
const path = require("path");
const { runChain, loadSelectielijst } = require("./rules-engine");
const { classifyDossier } = require("./classify");

const DATA = path.join(__dirname, "data");

function loadData() {
  const dossiers = JSON.parse(fs.readFileSync(path.join(DATA, "dossiers.json"), "utf8"));
  const referentieset = JSON.parse(fs.readFileSync(path.join(DATA, "referentieset.json"), "utf8"));
  return { dossiers: dossiers.dossiers || [], referentieset: referentieset.dossiers || [] };
}

async function runPoc(engine) {
  const sl = loadSelectielijst();
  const { dossiers, referentieset } = loadData();
  const resultaten = [];
  const twijfel = [];
  let correctPt = 0;
  let correctR = 0;
  let correctBV = 0;
  let beoordeeld = 0;

  for (const dossier of dossiers) {
    const klass = await classifyDossier(dossier, engine || "mock");
    const ref = referentieset.find((d) => d.dossierId === dossier.id);

    let chain = null;
    if (klass.procestypeCode && klass.resultaatCode) {
      chain = runChain({
        procestypeCode: klass.procestypeCode,
        resultaatCode: klass.resultaatCode,
        dossierafsluitdatum: dossier.dossierafsluitdatum || null,
        termijnstartdatum: dossier.termijnstartdatum || null,
        hotspotCodes: dossier.hotspotCodes || [],
      });
    }

    resultaten.push({
      dossierId: dossier.id,
      dossierNaam: dossier.naam,
      status: klass.status,
      engine: klass.engine,
      procestypeCode: klass.procestypeCode,
      resultaatCode: klass.resultaatCode,
      confidence: klass.confidence,
      evidence: klass.evidence || [],
      chain,
      verwacht: ref || null,
    });

    if (klass.status !== "OK") twijfel.push(dossier.id);

    if (ref) {
      beoordeeld++;
      if (ref.procestypeCode === klass.procestypeCode) correctPt++;
      if (ref.resultaatCode === klass.resultaatCode) correctR++;
      if (chain && ref.waardering === chain.waardering) correctBV++;
    }
  }

  return {
    engine: engine || "mock",
    selectielijstversie: sl.versie,
    resultaten,
    twijfel,
    summary: {
      totaal: resultaten.length,
      beoordeeld,
      correctPt,
      correctR,
      correctBV,
    },
  };
}

module.exports = { runPoc, loadData };
