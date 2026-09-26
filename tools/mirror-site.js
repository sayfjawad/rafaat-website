#!/usr/bin/env node
/*
 * ralebate.nl -> static mirror
 * ------------------------------------------------------------------
 * Downloads the WordPress site as plain HTML/CSS/JS/images (no PHP needed)
 * and rewrites every URL to a *relative* path, so the copy works both on
 * https://rafaat.sdai.nl/ and behind the IDE proxy (/proxy/3000/).
 *
 * Usage:
 *   node tools/mirror-site.js ./tmp-mirror      # safe: writes to that folder
 *   node tools/mirror-site.js . --force         # refresh the site in place
 *
 * Notes:
 *  - the target folder is wiped first, hence the --force guard;
 *  - requests are throttled because the host runs Imunify360 bot protection;
 *  - dynamic WordPress endpoints (/wp-json/, feed/, xmlrpc.php) are skipped;
 *  - the Gravity Forms contact form will render but cannot be submitted
 *    (that needs PHP on the server).
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const OUT = path.resolve(process.argv[2] || ".");
const FORCE = process.argv.includes("--force");
const ORIGIN = "https://www.ralebate.nl";
const HOSTS = new Set(["www.ralebate.nl", "ralebate.nl"]);
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BLOCK = ["/wp-json/", "/feed/", "/xmlrpc.php", "/imunify-bot-check", "/wp-admin/", "/wp-login.php"];

const SEEDS = [
  "/",
  "/diensten/",
  "/diensten/implementeren/",
  "/diensten/selecteren/",
  "/diensten/adviseren/",
  "/diensten/trainingen/",
  "/over-ons/",
  "/contact/",
  "/algemene-voorwaarden/",
  "/privacybeleid/",
];

const ASSET_EXT = new Set([
  ".css", ".js", ".mjs", ".map", ".jpg", ".jpeg", ".png", ".gif", ".svg",
  ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".mp4", ".webm", ".mp3", ".json", ".xml", ".txt", ".zip",
]);

const queue = [];
const seen = new Set();
let saved = 0;

// ---- helpers --------------------------------------------------------------
function absUrl(raw, base) {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

function relPathFor(u) {
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith("/")) p += "index.html";
  if (p === "" || p === "/") p = "/index.html";
  return p.replace(/^\/+/, "");
}

function enqueue(raw, base) {
  const u = absUrl(raw, base);
  if (!u) return;
  if (u.protocol !== "http:" && u.protocol !== "https:") return;
  if (!HOSTS.has(u.hostname)) return; // external CDNs / links stay as they are
  u.hash = "";
  u.search = "";
  if (!/\.[a-z0-9]{2,5}$/i.test(u.pathname) && !u.pathname.endsWith("/")) u.pathname += "/";
  const p = u.pathname.toLowerCase();
  if (BLOCK.some((b) => p.includes(b))) return;
  const key = u.origin + u.pathname;
  if (seen.has(key)) return;
  seen.add(key);
  queue.push(u);
}


// ---- link extraction / URL rewriting -------------------------------------
function extractRefs(text, base, isCss) {
  const refs = [];
  const push = (v) => v && refs.push(v.trim());

  if (isCss) {
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) push(m[2]);
    for (const m of text.matchAll(/@import\s+(?:url\()?\s*(['"])([^'"]+)\1/gi)) push(m[2]);
    return refs;
  }

  for (const m of text.matchAll(/\s(?:href|src|poster|data-src|data-bg|data-background|data-image|data-lazy-src|data-original)\s*=\s*(["'])(.*?)\1/gi))
    push(m[2]);
  for (const m of text.matchAll(/\s(?:srcset|data-srcset)\s*=\s*(["'])(.*?)\1/gi)) {
    for (const cand of m[2].split(",")) push(cand.trim().split(/\s+/)[0]);
  }
  for (const m of text.matchAll(/\scontent\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi)) push(m[2]);
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) push(m[2]);
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?ralebate\.nl\/[^\s"'<>)]+/gi)) push(m[0]);
  return refs;
}

function rewrite(text) {
  return (
    text
      .replace(/(?:https?:)?\/\/(?:www\.)?ralebate\.nl/gi, "")
      .replace(/https?:\\\/\\\/(?:www\\.)?ralebate\\.nl/gi, "")
      // Imunify360 injects a hidden "protected by" link (display:none, off-screen).
      // It is bot-protection plumbing, not part of the site, and would 404 locally.
      .replace(/<a\b[^>]*href=["'][^"']*imunify-bot-check[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "")
  );
}

// ---- fetch (cookie jar + throttle + retry on bot-protection) --------------
const jar = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function storeCookies(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function fetchUrl(u, attempt = 1) {
  const res = await fetch(u.toString(), {
    redirect: "follow",
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
      "upgrade-insecure-requests": "1",
      ...(jar.size ? { cookie: cookieHeader() } : {}),
    },
  });
  storeCookies(res);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  const body = buf.toString("utf8");
  const challenged =
    /<title>\s*(One moment, please|Even geduld|Just a moment)/i.test(body) ||
    /id="outer-container"\s*>?\s*<div class="spinner"/i.test(body);
  if ((challenged || res.status === 429 || res.status === 503) && attempt <= 6) {
    console.log(`  … rate limited on ${u.pathname}, waiting (attempt ${attempt})`);
    await sleep(6000 * attempt);
    return fetchUrl(u, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { buf, type };
}

async function handle(u) {
  const rel = relPathFor(u);
  const ext = path.extname(rel).toLowerCase();
  const isCss = ext === ".css";
  const { buf, type } = await fetchUrl(u);
  if (/<title>\s*(One moment, please|Even geduld|Just a moment)/i.test(buf.toString("utf8", 0, 3000))) {
    throw new Error("still blocked by bot protection (challenge page)");
  }
  const isHtml = ext === ".html" || (!ASSET_EXT.has(ext) && /text\/html/i.test(type));
  const isAsset = ASSET_EXT.has(ext);

  let out = buf;
  if (isHtml || isCss || (isAsset && /text\/css/i.test(type))) {
    const raw = buf.toString("utf8");
    for (const ref of extractRefs(raw, u.toString(), isCss)) enqueue(ref, u.toString());
    out = Buffer.from(rewrite(raw), "utf8");
  }

  const dest = path.join(OUT, rel);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, out);
  saved++;
  console.log("  ✓", rel);
}

// ---- phase 2: root-relative -> document-relative (works behind /proxy/) ---
// NB: .js files are deliberately skipped; relative URLs inside JS resolve
// against the *page* URL, not the script URL.
function relUrl(ref, baseDir) {
  const i = ref.search(/[?#]/);
  const pathPart = i < 0 ? ref : ref.slice(0, i);
  const suffix = i < 0 ? "" : ref.slice(i);
  if (!pathPart.startsWith("/") || pathPart.startsWith("//")) return ref;
  const isDir = pathPart.endsWith("/");
  const clean = pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  const base = baseDir === "." ? "" : baseDir;
  let rel = base ? path.posix.relative(base, clean || ".") : clean || ".";
  if (!rel) rel = ".";
  if (isDir && !rel.endsWith("/")) rel += "/";
  return rel + suffix;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ATTRS = "href|src|poster|data-src|data-bg|data-background|data-image|data-lazy-src|data-original";

function relativize(root) {
  let changed = 0;
  for (const file of walk(root)) {
    if (!/\.(html?|css)$/i.test(file)) continue;
    const baseDir = path.posix.dirname(path.posix.relative(root, file));
    const before = fs.readFileSync(file, "utf8");
    let text = before;

    text = text.replace(new RegExp(`\\s(${ATTRS})=(["'])([^"']*)\\2`, "gi"), (m, attr, q, val) => {
      const v = val.trim();
      if (!v.startsWith("/") || v.startsWith("//")) return m;
      return ` ${attr}=${q}${relUrl(v, baseDir)}${q}`;
    });

    text = text.replace(/\s(srcset|data-srcset)=(["'])([^"']*)\2/gi, (m, attr, q, val) => {
      const out = val
        .split(",")
        .map((part) => {
          const t = part.trim();
          if (!t) return t;
          const [u, ...desc] = t.split(/\s+/);
          const nu = u.startsWith("/") && !u.startsWith("//") ? relUrl(u, baseDir) : u;
          return [nu, ...desc].join(" ");
        })
        .join(", ");
      return ` ${attr}=${q}${out}${q}`;
    });

    text = text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
      const t = u.trim();
      if (!t.startsWith("/") || t.startsWith("//")) return m;
      return `url(${q}${relUrl(t, baseDir)}${q})`;
    });

    if (text !== before) {
      fs.writeFileSync(file, text);
      changed++;
    }
  }
  return changed;
}

// ---- run ------------------------------------------------------------------
(async () => {
  const danger = ["server.js", "package.json", ".git"].filter((f) => fs.existsSync(path.join(OUT, f)));
  if (danger.length && !FORCE) {
    console.error(
      `Refusing to wipe ${OUT}: it contains ${danger.join(", ")}.\n` +
        `Run with --force to refresh the site in place, e.g. "node tools/mirror-site.js . --force".`
    );
    process.exit(1);
  }

  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(OUT, { recursive: true });
  for (const s of SEEDS) enqueue(s, ORIGIN);

  let errors = 0;
  while (queue.length) {
    const u = queue.shift();
    try {
      await handle(u);
    } catch (e) {
      errors++;
      console.log("  ✗", u.pathname, "-", e.message);
    }
    await sleep(1200); // throttle: the host runs Imunify360 bot protection
  }

  const changed = relativize(OUT);
  console.log(
    `\nDone: ${saved} files downloaded, ${errors} errors, ${changed} files made proxy-safe -> ${OUT}`
  );
})();
