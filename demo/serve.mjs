/**
 * Минимальный статический сервер для demo/dist (без зависимостей).
 *
 *   node demo/serve.mjs          # http://127.0.0.1:5173
 *   node demo/serve.mjs 4173     # другой порт
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const port = Number(process.argv[2] || 5173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

if (!existsSync(path.join(dist, "index.html"))) {
  console.error("нет demo/dist — сначала выполните: node demo/build.mjs");
  process.exit(1);
}

createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) {
    response.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(dist, "index.html");
  }
  response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`демо: http://127.0.0.1:${port}`);
});
