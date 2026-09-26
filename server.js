// Zero-dependency static file server for the workshop starter.
// Serves this directory on 0.0.0.0:3000 so the app shows up at
// https://rafaat.sdai.nl once the container is running.
// Replace this with your own app (React, Vite, Express, ...) — just keep
// binding to 0.0.0.0:3000 so nginx can reach it.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
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
