/**
 * Сборка витрины компонентов: tools/local-dev/showcase/dist.
 *
 *   npm run showcase
 */

import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const dist = path.join(here, "showcase", "dist");
const require = createRequire(import.meta.url);

function loadEsbuild() {
  try {
    return require("esbuild");
  } catch (error) {
    throw new Error(`esbuild не найден: выполните npm install в корне проекта\n${error.message}`);
  }
}

const esbuild = loadEsbuild();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(here, "showcase", "app.tsx")],
  outdir: dist,
  entryNames: "main",
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

await copyFile(path.join(here, "showcase", "index.html"), path.join(dist, "index.html"));

for (const file of ["index.html", "main.js", "main.css"]) {
  if (!existsSync(path.join(dist, file))) throw new Error(`не собран ${file}`);
  const info = await stat(path.join(dist, file));
  console.log(`  ${file} — ${(info.size / 1024).toFixed(1)} КБ`);
}
console.log(`готово: ${dist}`);
