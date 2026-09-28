"use strict";
// CLI: draait de volledige keten via de gedeelde pipeline en print het resultaat.
// Gebruik:  node poc/run.js [--llm]

const fs = require("fs");
const path = require("path");
const { runPoc } = require("./pipeline");

const OUTPUT = path.join(__dirname, "output");

function pct(juist, totaal) {
  return totaal ? Math.round((juist / totaal) * 100) + "%" : "n.v.t.";
}

async function main() {
  const engine = process.argv.includes("--llm") ? "llm" : "mock";
  const r = await runPoc(engine);

  console.log(`=== POC-classificatie (engine: ${r.engine}, selectielijst: ${r.selectielijstversie}) ===\n`);

  for (const x of r.resultaten) {
    console.log(`📁 ${x.dossierId} — ${x.dossierNaam}`);
    console.log(
      `   classificatie: ${x.procestypeCode || "-"} / ${x.resultaatCode || "-"} ` +
      `(confidence ${x.confidence}) [${x.status}]`
    );
    if (x.chain) {
      const moment = x.chain.vernietigingsdatum
        ? `vernietiging ${x.chain.vernietigingsdatum}`
        : x.chain.overbrengingsdatum
          ? `overbrenging ${x.chain.overbrengingsdatum}`
          : "onbekend";
      console.log(
        `   waardering: ${x.chain.waardering}  |  regel: ${x.chain.regelCode}  |  ` +
        `termijn: ${x.chain.bewaartermijnJaren ?? "n.v.t."} jr`
      );
      console.log(`   termijnstart: ${x.chain.termijnstartdatum || "-"}  →  ${moment}`);
      if (x.chain.uitzondering) {
        console.log(`   ⚠ uitzondering/hotspot: ${x.chain.hotspots.map((h) => h.naam).join(", ")}`);
      }
    } else {
      console.log(`   (geen formele waardering — status ${x.status})`);
    }
    console.log("");
  }

  const s = r.summary;
  if (s.beoordeeld > 0) {
    console.log("=== Vergelijking met referentieset ===");
    console.log(`procestype correct:  ${s.correctPt}/${s.beoordeeld} (${pct(s.correctPt, s.beoordeeld)})`);
    console.log(`resultaat correct:   ${s.correctR}/${s.beoordeeld} (${pct(s.correctR, s.beoordeeld)})`);
    console.log(`B/V correct:         ${s.correctBV}/${s.beoordeeld} (${pct(s.correctBV, s.beoordeeld)})`);
  }
  if (r.twijfel.length) {
    console.log(`\n⚠ Twijfelgevallen voor menselijke beoordeling: ${r.twijfel.join(", ")}`);
  }

  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT, "audit.json"),
    JSON.stringify({ gegenereerdOp: new Date().toISOString(), ...r }, null, 2)
  );
  console.log(`\nVolledige audit weggeschreven naar: poc/output/audit.json`);
}

main().catch((e) => {
  console.error("Fout:", e.message);
  process.exit(1);
});
