#!/usr/bin/env node
/*
 * Checks that every page and every asset the browser really loads returns 200.
 *
 * Usage:
 *   node tools/check-links.js                                    # http://127.0.0.1:3000/
 *   node tools/check-links.js https://rafaat.sdai.nl             # publiek
 *   node tools/check-links.js http://127.0.0.1:3000 /proxy/3000  # via de browser-IDE proxy
 *
 * Gecontroleerd (alles wat de browser nodig heeft):
 *   - de pagina's zelf;
 *   - src / srcset / poster van img, source, script, video, iframe, ...
 *   - stylesheets, favicons en preload/manifest-links;
 *   - url(...) in <style>, style="" en in de CSS-bestanden zelf (recursief);
 *   - interne navigatielinks (<a href>).
 * Overgeslagen als "plumbing" (onzichtbaar, wordt nooit geladen):
 *   xmlrpc.php, wp-json/, oembed/feed-links, imunify-bot-check en externe hosts.
 *
 * Exit code 1 als er iets ontbreekt, zodat het als check te gebruiken is.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const PREFIX = (process.argv[3] || "").replace(/\/$/, "");

const RESOURCE_ATTRS = "src|srcset|poster|data-src|data-bg|data-background|data-image|data-lazy-src|data-original";
const RESOURCE_TAGS = "img|source|script|video|audio|iframe|embed|object|track|input|picture";
const PLUMBING = /(^|\/)(xmlrpc\.php|wp-json\/|wp-login\.php|imunify-bot-check|feed\/?$)/i;

const problems = [];
const skipped = [];
let checkedPages = 0;
let checkedAssets = 0;
let external = 0;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "tools", "tmp-mirror"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}

function pageUrlFor(file) {
  let rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (rel === "index.html") rel = "";
  else rel = rel.replace(/index\.html$/, "");
  return `${BASE}${PREFIX}/${rel}`;
}

function addRef(value, target) {
  const v = (value || "").trim();
  if (!v || v.startsWith("#") || /^(mailto:|tel:|javascript:|data:|about:)/i.test(v)) return;
  target.push(v);
}

function refsFromHtml(html) {
  const resources = [];
  const navigation = [];

  for (const tag of html.matchAll(new RegExp(`<(${RESOURCE_TAGS})\\b[^>]*>`, "gi"))) {
    for (const a of tag[0].matchAll(new RegExp(`\\s(${RESOURCE_ATTRS})\\s*=\\s*(["'])(.*?)\\2`, "gi"))) {
      if (/^srcset$/i.test(a[1])) {
        for (const cand of a[3].split(",")) addRef(cand.trim().split(/\s+/)[0], resources);
      } else addRef(a[3], resources);
    }
  }

  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (tag[0].match(/\srel\s*=\s*(["'])(.*?)\1/i) || [])[2] || "";
    if (!/stylesheet|icon|preload|manifest|mask-icon/i.test(rel)) continue;
    addRef((tag[0].match(/\shref\s*=\s*(["'])(.*?)\1/i) || [])[2], resources);
  }

  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) addRef(m[2], resources);

  for (const tag of html.matchAll(/<a\b[^>]*>/gi)) {
    addRef((tag[0].match(/\shref\s*=\s*(["'])(.*?)\1/i) || [])[2], navigation);
  }

  return { resources, navigation };
}

function refsFromCss(css) {
  const out = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) addRef(m[2], out);
  for (const m of css.matchAll(/@import\s+(?:url\()?\s*(['"])([^'"]+)\1/gi)) addRef(m[2], out);
  return out;
}


const cssChecked = new Set();

async function checkCss(url, from) {
  if (cssChecked.has(url) || cssChecked.size > 40) return;
  cssChecked.add(url);
  const res = await fetch(url);
  if (!res.ok) {
    problems.push(`${from} -> stylesheet ${url} -> HTTP ${res.status}`);
    return;
  }
  for (const ref of refsFromCss(await res.text())) {
    const abs = new URL(ref, url).href;
    if (!abs.startsWith(BASE)) {
      external++;
      continue;
    }
    checkedAssets++;
    const r = await fetch(abs);
    if (r.status !== 200) problems.push(`${url} -> url(${ref}) -> HTTP ${r.status}`);
    r.body?.cancel?.();
  }
}

async function check(ref, pageUrl, kind) {
  let abs;
  try {
    abs = new URL(ref, pageUrl);
  } catch {
    return problems.push(`${pageUrl} -> ongeldige URL "${ref}"`);
  }
  if (!abs.href.startsWith(BASE)) {
    external++;
    return;
  }
  if (PLUMBING.test(abs.pathname)) {
    skipped.push(abs.pathname);
    return;
  }
  abs.hash = "";
  checkedAssets++;
  const res = await fetch(abs.href);
  if (res.status !== 200) problems.push(`${pageUrl} -> ${ref} [${kind}] -> HTTP ${res.status}`);
  res.body?.cancel?.();
  if (/\.css(\?|$)/i.test(abs.pathname)) await checkCss(abs.href, pageUrl);
}

(async () => {
  const pages = walk(ROOT);
  for (const file of pages) {
    const pageUrl = pageUrlFor(file);
    const res = await fetch(pageUrl);
    if (res.status !== 200) {
      problems.push(`${pageUrl} (pagina zelf) -> HTTP ${res.status}`);
      continue;
    }
    checkedPages++;
    const { resources, navigation } = refsFromHtml(await res.text());
    for (const ref of resources) await check(ref, pageUrl, "asset");
    for (const ref of navigation) await check(ref, pageUrl, "navigatie");
  }

  const plumbing = [...new Set(skipped)];
  console.log(`Basis:          ${BASE}${PREFIX}/`);
  console.log(`Pagina's:       ${checkedPages}/${pages.length} OK`);
  console.log(`Gecontroleerd:  ${checkedAssets} interne links/assets, ${external} extern overgeslagen`);
  console.log(
    `Plumbing:       ${plumbing.length} overgeslagen (${plumbing.slice(0, 3).join(", ")}${plumbing.length > 3 ? ", ..." : ""})`
  );
  if (!problems.length) {
    console.log("Resultaat:      OK — alles wat de browser laadt geeft HTTP 200");
    process.exit(0);
  }
  console.log(`Resultaat:      ${problems.length} probleem(en):`);
  for (const p of problems) console.log("  ✗", p);
  process.exit(1);
})();
