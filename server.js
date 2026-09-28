// Zero-dependency static file server for the workshop starter.
// Serves this directory on 0.0.0.0:3000 so the app shows up at
// https://rafaat.sdai.nl once the container is running.
// Replace this with your own app (React, Vite, Express, ...) — just keep
// binding to 0.0.0.0:3000 so nginx can reach it.
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { runPoc } = require("./poc/pipeline");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// --- Laad .env (zero-dependency) --------------------------------------------
// De Qwen-sleutel en het "brein" van de chatbot staan in .env (niet in git).
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
  } catch (_) {
    /* .env ontbreekt of is niet leesbaar */
  }
  return env;
}

const env = loadEnv(path.join(__dirname, ".env"));
const QWEN_API_KEY = process.env.QWEN_API_KEY || env.QWEN_API_KEY || "";
const QWEN_BASE_URL = (
  process.env.QWEN_BASE_URL || env.QWEN_BASE_URL || "https://q38-27b.sdai.nl"
).replace(/\/+$/, "");
// Het model dat q38-27b.sdai.nl serveert (Qwen3.8-27B, in de opdracht ook wel
// "qwen3.8-27b" genoemd). De /v1/models-endpoint van de host geeft dit gguf-pad
// terug als model-id; dat is dus de naam die we in het request meesturen.
const QWEN_MODEL =
  process.env.QWEN_MODEL ||
  env.QWEN_MODEL ||
  "/srv/llm/models/Qwen3.8-27B-UD-Q5_K_M.gguf";
const QWEN_MAX_TOKENS = Number(
  process.env.QWEN_MAX_TOKENS || env.QWEN_MAX_TOKENS || 512
);
const QWEN_ENABLE_THINKING =
  (process.env.QWEN_ENABLE_THINKING || env.QWEN_ENABLE_THINKING || "false").toLowerCase() ===
  "true";
const QWEN_SYSTEM_PROMPT =
  process.env.QWEN_SYSTEM_PROMPT ||
  env.QWEN_SYSTEM_PROMPT ||
  [
    "Je bent de chatbot van Ralebate Consultancy (www.ralebate.nl).",
    "Ralebate ondersteunt organisaties bij het duurzaam en toekomstbestendig",
    "inrichten van hun informatievoorziening en combineert inhoudelijke expertise",
    "in informatiebeheer met sterke projectmatige sturing.",
    "",
    "Diensten: adviseren, trainingen, implementeren en selecteren.",
    "Ralebate heeft veel ervaring met het beheren van gebouwen, digitale archivering,",
    "het e-Depot en de standaard MDTO, en werkte onder meer voor provincies,",
    "regionale historische centra en het Nationaal Archief in Den Haag.",
    "Contact: info@ralebate.nl.",
    "",
    "Beantwoord vragen van bezoekers vriendelijk, kort en duidelijk in het Nederlands.",
    "Verwijs bij specifieke inhoudelijke vragen gerust naar info@ralebate.nl of de contactpagina.",
  ].join("\n");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".map": "application/json",
};

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>404 — Not Found</h1>");
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function logLine(req, status, target) {
  console.log(`${new Date().toISOString()} ${status} ${req.method} ${req.url} -> ${target}`);
}

// --- Chatbot API ------------------------------------------------------------
// POST /api/chat   body: { "messages": [{role, content}, ...] }
// Stuurt de conversatie naar Qwen (q38-27b.sdai.nl) en geeft het antwoord terug.
function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1_000_000) req.destroy(new Error("body te groot"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function callQwen(messages) {
  return new Promise((resolve, reject) => {
    const upstream = new URL(QWEN_BASE_URL + "/v1/chat/completions");
    const payload = JSON.stringify({
      model: QWEN_MODEL,
      messages,
      max_tokens: QWEN_MAX_TOKENS,
      // Qwen3 is een "thinking"-model en denkt standaard lang na vóór het antwoord.
      // Dat is traag; zet denken uit voor een snelle, directe chatbot-reactie.
      ...(QWEN_ENABLE_THINKING
        ? {}
        : { chat_template_kwargs: { enable_thinking: false } }),
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
          Authorization: "Bearer " + QWEN_API_KEY,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(`Qwen status ${res.statusCode}: ${data.slice(0, 300)}`)
            );
            return;
          }
          let content = "";
          let reasoning = "";
          try {
            const parsed = JSON.parse(data);
            const msg =
              parsed.choices && parsed.choices[0] && parsed.choices[0].message;
            content = (msg && msg.content) || "";
            reasoning = (msg && msg.reasoning_content) || "";
          } catch (_) {
            reject(new Error("Qwen gaf onleesbare JSON terug"));
            return;
          }
          resolve({ content, reasoning });
        });
      }
    );
    req.on("error", (e) => reject(e));
    req.setTimeout(120_000, () => req.destroy(new Error("timeout")));
    req.write(payload);
    req.end();
  });
}

async function handleChat(req, res) {
  if (!QWEN_API_KEY) {
    return sendJson(res, 500, { error: "QWEN_API_KEY ontbreekt in .env" });
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch (_) {
    return sendJson(res, 400, { error: "Ongeldige JSON body" });
  }

  let messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length && body.message) {
    messages = [{ role: "user", content: String(body.message) }];
  }
  messages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content ?? "") }));

  if (!messages.length) {
    return sendJson(res, 400, {
      error: "Geen bericht gevonden (stuur {message} of {messages})",
    });
  }

  const full = [{ role: "system", content: QWEN_SYSTEM_PROMPT }, ...messages];

  try {
    const { content, reasoning } = await callQwen(full);
    sendJson(res, 200, { reply: content || "(geen antwoord)", reasoning });
  } catch (e) {
    logLine(req, 502, "qwen: " + e.message);
    sendJson(res, 502, { error: "Qwen is even niet bereikbaar: " + e.message });
  }
}

// The browser IDE proxies this server as https://ide-rafaat.sdai.nl/proxy/3000/.
// That proxy forwards the path with the prefix stripped, but strip it here too
// so the site keeps working if a request ever arrives with the prefix intact.
const PROXY_PREFIX = /^\/proxy\/\d+(?=\/|$)/;

http
  .createServer((req, res) => {
    const [rawPath, ...query] = req.url.split("?");
    const qs = query.length ? "?" + query.join("?") : "";
    let urlPath = decodeURIComponent(rawPath).replace(PROXY_PREFIX, "") || "/";
    if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;

    // --- Chatbot API ---
    if (urlPath === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        model: QWEN_MODEL,
        hasKey: !!QWEN_API_KEY,
      });
    }
    if (urlPath === "/api/chat") {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method Not Allowed");
      }
      logLine(req, 200, "api/chat");
      return handleChat(req, res);
    }
    // --- POC classificatietool ---
    if (urlPath === "/api/poc/run") {
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method Not Allowed");
      }
      const engine = qs.includes("engine=llm") ? "llm" : "mock";
      logLine(req, 200, "api/poc/run (" + engine + ")");
      return runPoc(engine)
        .then((result) => sendJson(res, 200, result))
        .catch((e) => {
          logLine(req, 500, "poc: " + e.message);
          sendJson(res, 500, { error: "POC fout: " + e.message });
        });
    }

    const file = path.join(ROOT, path.normalize(urlPath));
    if (!file.startsWith(ROOT)) {
      logLine(req, 403, file);
      res.writeHead(403);
      return res.end("Forbidden");
    }
    // 1) real file, 2) directory -> index.html, 3) pretty permalink (/diensten -> /diensten/index.html)
    fs.stat(file, (err, stat) => {
      if (!err && stat.isFile()) {
        logLine(req, 200, file);
        return sendFile(res, file);
      }
      const dirIndex = path.join(file, "index.html");
      fs.stat(dirIndex, (e2, s2) => {
        if (!e2 && s2.isFile()) {
          // Redirect /diensten -> /diensten/ first: the mirrored pages use
          // relative URLs, which only resolve correctly with the trailing slash.
          // The redirect target is relative on purpose: with an absolute path
          // ("/diensten/") the browser would leave the /proxy/<port>/ prefix of
          // the browser-IDE and land on the wrong URL.
          if (!urlPath.endsWith("/")) {
            const lastSegment = urlPath.slice(urlPath.lastIndexOf("/") + 1);
            const location = encodeURI(lastSegment) + "/" + qs;
            logLine(req, 301, location);
            res.writeHead(301, { Location: location });
            return res.end();
          }
          logLine(req, 200, dirIndex);
          return sendFile(res, dirIndex);
        }
        logLine(req, 404, urlPath);
        notFound(res);
      });
    });
  })
  .listen(PORT, "0.0.0.0", () =>
    console.log(`rafaat-website serving ${ROOT} on http://0.0.0.0:${PORT}`)
  );
