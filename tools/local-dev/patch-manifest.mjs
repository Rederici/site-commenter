/**
 * Раньше правил статический манифест под локальный стенд. Теперь content
 * script регистрируется динамически из списка сайтов в настройках расширения,
 * поэтому скрипт только проверяет, что старых статических matches нет.
 *
 *   node tools/local-dev/patch-manifest.mjs
 */

import { readFile } from "node:fs/promises";
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
if (manifest.content_scripts?.length) {
  console.log("  манифест: найден статический content_scripts — он будет дублировать динамический");
} else {
  console.log("  манифест: сайты задаются в настройках расширения (popup), статических matches нет");
}
