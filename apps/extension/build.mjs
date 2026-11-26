/**
 * Сборка расширения: два бандла + манифест.
 *
 *   npm run build:extension
 */

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const dist = path.join(here, "dist");
const require = createRequire(import.meta.url);

/**
 * Значения по умолчанию вшиваются в бандлы на этапе сборки.
 * Берутся из .env в корне репозитория, переменные окружения важнее файла.
 */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const env = { ...readEnvFile(path.join(root, ".env")), ...process.env };

function readUrl(name, fallback) {
  const raw = String(env[name] || "").trim();
  if (!raw) {
    console.warn(`  ${name} не задан, используется ${fallback}`);
    return fallback;
  }
  return raw.replace(/\/+$/, "");
}

function readText(name, fallback) {
  const raw = String(env[name] || "").trim();
  if (!raw) {
    console.warn(`  ${name} не задан, используется ${fallback}`);
    return fallback;
  }
  return raw;
}

function readSiteList(name, fallback) {
  const raw = String(env[name] || "").trim();
  const sites = raw
    .split(",")
    .map((site) => site.trim())
    .filter(Boolean);
  if (sites.length === 0) {
    console.warn(`  ${name} не задан, используется ${fallback.join(", ")}`);
    return fallback;
  }
  return sites;
}

const youtrackUrl = readUrl("SITECOMMENTER_YOUTRACK_URL", "https://yt.example.com");
const youtrackClientId = readText("SITECOMMENTER_YOUTRACK_CLIENT_ID", "site-commenter");
const youtrackScope = readText("SITECOMMENTER_YOUTRACK_SCOPE", "YouTrack");
const defaultSites = readSiteList("SITECOMMENTER_DEFAULT_SITES", ["todo.example.com"]);

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
  define: {
    "process.env.NODE_ENV": '"production"',
    __SITECOMMENTER_YOUTRACK_URL__: JSON.stringify(youtrackUrl),
    __SITECOMMENTER_YOUTRACK_CLIENT_ID__: JSON.stringify(youtrackClientId),
    __SITECOMMENTER_YOUTRACK_SCOPE__: JSON.stringify(youtrackScope),
    __SITECOMMENTER_DEFAULT_SITES__: JSON.stringify(defaultSites),
  },
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

await esbuild.build({
  ...shared,
  entryPoints: [path.join(here, "src", "popup.ts")],
  outfile: path.join(dist, "popup.js"),
  format: "iife",
});

await copyFile(path.join(here, "manifest.json"), path.join(dist, "manifest.json"));
await copyFile(path.join(here, "popup.html"), path.join(dist, "popup.html"));
await copyFile(path.join(here, "popup.css"), path.join(dist, "popup.css"));
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
