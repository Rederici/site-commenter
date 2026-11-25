/**
 * Правит собранный манифест расширения так, чтобы content script работал
 * на локальном стенде (127.0.0.1 / localhost). Исходный манифест не меняется.
 *
 *   node tools/local-dev/patch-manifest.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const manifestPath = path.join(root, "apps", "extension", "dist", "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("нет apps/extension/dist/manifest.json — сначала: npm run build:extension");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const LOCAL_MATCHES = ["http://127.0.0.1/*", "http://localhost/*"];

for (const script of manifest.content_scripts || []) {
  script.matches = LOCAL_MATCHES;
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`  манифест: content_scripts.matches → ${LOCAL_MATCHES.join(", ")}`);
