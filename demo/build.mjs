/**
 * Сборка демо-страницы для скриншотов и ручной проверки модуля.
 *
 *   node demo/build.mjs
 *
 * Результат — demo/dist: index.html, main.js, main.css. Сервер не нужен,
 * данные вымышленные, API живёт в памяти.
 */

import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const dist = path.join(here, "dist");
const require = createRequire(import.meta.url);

function loadEsbuild() {
  const candidates = ["esbuild", path.join(root, "node_modules", "esbuild")];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // пробуем следующий вариант
    }
  }
  throw new Error("esbuild не найден: выполните npm install");
}

const esbuild = loadEsbuild();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(here, "main.tsx")],
  outdir: dist,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome109"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  nodePaths: [path.join(root, "node_modules")],
  loader: { ".css": "css" },
  logLevel: "warning",
});

await copyFile(path.join(here, "index.html"), path.join(dist, "index.html"));
const info = await stat(path.join(dist, "main.js"));
console.log(`готово: ${dist} (main.js ${(info.size / 1024).toFixed(0)} КБ)`);
