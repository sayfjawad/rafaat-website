"use strict";
// Classificatiestap: dossier -> procestype + resultaat, uitsluitend binnen de
// voorgeschreven categorieën. Twee engines:
//   - "mock": deterministisch (trefwoorden) — snel en reproduceerbaar testen
//   - "llm" : private LLM (q38-27b.sdai.nl) met structured output + restrictie
// De formele waardering (B/V, termijn, datum) gebeurt NIET hier maar in de
// rules-engine. Dit is bewust gescheiden.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { loadSelectielijst } = require("./rules-engine");

function loadEnv(file) {
  const env = {};
  try {
    const txt = fs.readFileSync(file, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch (_) {}
  return env;
}

function textVanDossier(dossier) {
  return [
    dossier.naam || "",
    dossier.onderwerp || "",
    ...(dossier.documenten || []).flatMap((d) => [d.naam || "", d.onderwerp || "", d.tekst || ""]),
  ].join(" ");
}

function mockClassify(dossier) {
  const sl = loadSelectielijst();
  const tekst = textVanDossier(dossier).toLowerCase();

  // Weging op trefwoordlengte: langere (specifiekere) trefwoorden tellen zwaarder.
  const matchScore = (kw) =>
    (kw || []).reduce((s, w) => (tekst.includes(w) ? s + w.length : s), 0);

  let bestPt = null;
  let bestScore = -1;
  for (const pt of sl.procestypen) {
    const score = matchScore(pt.sleutelwoorden);
    if (score > bestScore) {
      bestScore = score;
      bestPt = pt;
    }
  }

  if (!bestPt || bestScore === 0) {
    return {
      status: "NIET_CLASSIFICEERBAAR",
      procestypeCode: null,
      resultaatCode: null,
      confidence: 0,
      evidence: [],
      engine: "mock",
    };
  }

  let bestR = bestPt.resultaten[0];
  let bestRScore = -1;
  for (const r of bestPt.resultaten) {
    const score = matchScore(r.signaalwoorden);
    if (score > bestRScore) {
      bestRScore = score;
      bestR = r;
    }
  }

  const evidence = [...(bestPt.sleutelwoorden || []), ...(bestR.signaalwoorden || [])]
    .filter((w) => tekst.includes(w));

  let confidence = Math.min(0.95, Math.max(0.3, 0.45 + 0.015 * bestScore));
  if (bestPt.resultaten.length > 1 && bestRScore === 0) {
    confidence = Math.min(confidence, 0.4);
  }

  return {
    status: confidence < 0.5 ? "ONZEKER" : "OK",
    procestypeCode: bestPt.code,
    resultaatCode: bestR.code,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    engine: "mock",
  };
}

function callQwen(messages) {
  return new Promise((resolve, reject) => {
    const env = loadEnv(path.join(__dirname, "..", ".env"));
    const key = process.env.QWEN_API_KEY || env.QWEN_API_KEY || "";
    const baseUrl = (
      process.env.QWEN_BASE_URL || env.QWEN_BASE_URL || "https://q38-27b.sdai.nl"
    ).replace(/\/+$/, "");
    const model =
      process.env.QWEN_MODEL || env.QWEN_MODEL || "/srv/llm/models/Qwen3.8-27B-UD-Q5_K_M.gguf";

    if (!key) {
      reject(new Error("QWEN_API_KEY ontbreekt"));
      return;
    }

    const upstream = new URL(baseUrl + "/v1/chat/completions");
    const payload = JSON.stringify({
      model,
      messages,
      max_tokens: 512,
      chat_template_kwargs: { enable_thinking: false },
    });

    const req = https.request(
      {
        hostname: upstream.hostname,
        port: upstream.port || 443,
        path: upstream.pathname + upstream.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: "Bearer " + key,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`LLM status ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const msg = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
            resolve((msg && msg.content) || "");
          } catch (_) {
            reject(new Error("LLM gaf onleesbare JSON terug"));
          }
        });
      }
    );
    req.on("error", (e) => reject(e));
    req.setTimeout(120_000, () => req.destroy(new Error("timeout")));
    req.write(payload);
    req.end();
  });
}

function parseLLMJson(raw) {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function llmClassify(dossier) {
  const sl = loadSelectielijst();
  const categorieen = sl.procestypen
    .map(
      (pt) =>
        `${pt.code} (${pt.naam}): ` +
        pt.resultaten.map((r) => `${r.code}=${r.naam}`).join(", ")
    )
    .join("\n");

  const system = [
    "Je bent een archiefclassificator. Je mag ALLEEN kiezen uit de onderstaande",
    "procestypen en resultaten. Verzin nooit nieuwe categorieën.",
    "",
    categorieen,
    "",
    "Geef uitsluitend geldige JSON terug in dit formaat:",
    '{"procestype":"CODE","resultaat":"CODE","confidence":0.85,"evidence":["reden 1","reden 2"]}',
    "Kies confidence tussen 0 en 1. Bij twijfel: confidence < 0.5 of procestype null.",
  ].join("\n");

  const user = [
    "Dossier: " + (dossier.naam || "(onbekend)"),
    "Onderwerp: " + (dossier.onderwerp || ""),
    "Documenten:",
    ...(dossier.documenten || []).map(
      (d) => `- ${d.naam || ""} (${d.datum || ""}): ${(d.onderwerp || "") + " " + (d.tekst || "")}`
    ),
  ].join("\n");

  const raw = await callQwen([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  const obj = parseLLMJson(raw);
  if (!obj || typeof obj !== "object") {
    return { status: "PARSE_FOUT", engine: "llm", raw: String(raw).slice(0, 300) };
  }

  const geldig =
    obj.procestype &&
    obj.resultaat &&
    sl.procestypen.some(
      (p) =>
        p.code === obj.procestype &&
        p.resultaten.some((r) => r.code === obj.resultaat)
    );

  if (!geldig) {
    return { status: "ONGELDIGE_CATEGORIE", engine: "llm", ...obj };
  }

  return {
    status:
      typeof obj.confidence === "number" && obj.confidence < 0.5 ? "ONZEKER" : "OK",
    procestypeCode: obj.procestype,
    resultaatCode: obj.resultaat,
    confidence: obj.confidence,
    evidence: Array.isArray(obj.evidence) ? obj.evidence : [],
    engine: "llm",
  };
}

function classifyDossier(dossier, mode) {
  if (mode === "llm") return llmClassify(dossier);
  return Promise.resolve(mockClassify(dossier));
}

module.exports = { classifyDossier, mockClassify, llmClassify };

