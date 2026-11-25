/**
 * Одна команда для локального стенда:
 *   1) собирает расширение;
 *   2) правит его манифест под 127.0.0.1/localhost;
 *   3) поднимает страницу-трекер и API в памяти.
 *
 *   node local-dev/start.mjs          # http://127.0.0.1:4400
 *   node local-dev/start.mjs 4500
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

console.log("Сборка расширения…");
const build = spawnSync(process.execPath, [path.join(root, "extension", "build.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const patch = spawnSync(process.execPath, [path.join(here, "patch-manifest.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (patch.status !== 0) process.exit(patch.status ?? 1);

await import("./server.mjs");
