/**
 * Сборка расширения: два бандла + манифест.
 *
 *   npm run build:extension
 */

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const dist = path.join(here, "dist");
const require = createRequire(import.meta.url);

function loadEsbuild() {
  try {
    return require("esbuild");
  } catch (error) {
    throw new Error(`esbuild не найден: выполните npm install в корне проекта\n${error.message}`);
  }
}

const esbuild = loadEsbuild();

const nodePaths = [
  path.join(root, "node_modules"),
  path.join(here, "node_modules"),
].filter((candidate) => existsSync(candidate));

const shared = {
  bundle: true,
  platform: "browser",
  target: ["chrome109"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  nodePaths,
  // Стили модуля импортируются строкой и вставляются в shadow root.
  loader: { ".css": "text" },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await esbuild.build({
  ...shared,
  entryPoints: [path.join(here, "src", "content.tsx")],
  outfile: path.join(dist, "content.js"),
  format: "iife",
});

await esbuild.build({
  ...shared,
  entryPoints: [path.join(here, "src", "background.ts")],
  outfile: path.join(dist, "background.js"),
  format: "esm",
});

await copyFile(path.join(here, "manifest.json"), path.join(dist, "manifest.json"));
await mkdir(path.join(dist, "icons"), { recursive: true });
for (const icon of await readdir(path.join(here, "icons"))) {
  if (!icon.endsWith(".png")) continue;
  await copyFile(path.join(here, "icons", icon), path.join(dist, "icons", icon));
}

for (const file of await readdir(dist)) {
  const info = await stat(path.join(dist, file));
  console.log(`  ${file} — ${(info.size / 1024).toFixed(1)} КБ`);
}
console.log(`готово: ${dist}`);
