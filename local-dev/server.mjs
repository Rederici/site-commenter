/**
 * Локальный стенд для Site Commenter.
 *
 * Отдаёт страницу-«трекер задач» и реализует контракт API из src/README.md
 * в памяти процесса. Ничего не пишет на диск, кроме сгенерированных файлов
 * рядом (extension/dist, local-dev/dist при необходимости).
 *
 *   node local-dev/server.mjs          # http://127.0.0.1:4400
 *   node local-dev/server.mjs 4500     # другой порт
 *
 * Данные живут до остановки сервера.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 4400);
const BASE = "/api/v1/ui-comments";

const now = () => new Date().toISOString();
const comments = [];
const screenshots = new Map();
let seq = 0;

const STATUSES = new Set(["new", "in_work", "fixed", "rejected"]);

const user = {
  username: "tester",
  full_name: "Тестер Тестерович",
  role_name: "Тестировщик",
  permissions: ["admin.write"],
};

function parseDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(value || ""));
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 6 * 1024 * 1024) return null;
  return { type: match[1].toLowerCase(), bytes };
}

function publicComment(comment) {
  const { screenshot, ...rest } = comment;
  return { ...rest, hasScreenshot: !!screenshot, screenshotType: screenshot?.type || "" };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message, details: null } });
}

async function readJson(request, limit = 9 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

function filtered(url) {
  const status = url.searchParams.get("status") || "";
  const route = url.searchParams.get("route") || "";
  const channel = url.searchParams.get("channel") || "";
  const date = url.searchParams.get("date") || "";
  const q = (url.searchParams.get("q") || "").toLowerCase();
  return comments
    .filter((item) => !status || item.status === status)
    .filter((item) => !route || item.route === route)
    .filter((item) => !channel || item.channelName === channel)
    .filter((item) => !date || item.date === date)
    .filter((item) => !q || `${item.text} ${item.routeTitle} ${item.author}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/v1/auth/me") {
    sendJson(response, 200, { data: { user } });
    return true;
  }

  if (url.pathname === BASE) {
    if (request.method === "GET") {
      sendJson(response, 200, { data: filtered(url).map(publicComment) });
      return true;
    }
    if (request.method === "POST") {
      let input;
      try {
        input = await readJson(request);
      } catch {
        sendError(response, 413, "body_too_large", "Тело запроса слишком большое");
        return true;
      }
      if (!input || typeof input !== "object") {
        sendError(response, 400, "validation_failed", "Некорректный JSON");
        return true;
      }
      const text = String(input.text || "").trim();
      if (text.length > 4000) {
        sendError(response, 400, "validation_failed", "Текст длиннее 4000 символов");
        return true;
      }
      const route = String(input.route || "/");
      if (!route.startsWith("/")) {
        sendError(response, 400, "validation_failed", "route должен начинаться с /");
        return true;
      }
      const shot = input.screenshot ? parseDataUrl(input.screenshot) : null;
      if (input.screenshot && !shot) {
        sendError(response, 400, "validation_failed", "Снимок должен быть JPEG/PNG/WebP до 6 МиБ");
        return true;
      }
      if (!text && !shot) {
        sendError(response, 400, "validation_failed", "Нужен текст или снимок");
        return true;
      }
      seq += 1;
      const comment = {
        id: `local-${seq}`,
        author: user.full_name,
        authorUsername: user.username,
        role: user.role_name,
        text,
        status: "new",
        route,
        routeTitle: String(input.routeTitle || route),
        url: String(input.url || ""),
        channelId: String(input.channelId || ""),
        channelName: String(input.channelName || ""),
        date: String(input.date || ""),
        viewportWidth: Number(input.viewportWidth) || 0,
        viewportHeight: Number(input.viewportHeight) || 0,
        screenshot: shot,
        resolution: "",
        resolvedBy: "",
        resolvedAt: "",
        createdAt: now(),
        updatedAt: now(),
      };
      if (shot) screenshots.set(comment.id, shot);
      comments.unshift(comment);
      console.log(`  + ${comment.id}  ${comment.route}  ${text ? text.slice(0, 60) : "(только снимок)"}`);
      sendJson(response, 201, { data: publicComment(comment) });
      return true;
    }
    sendError(response, 405, "method_not_allowed", "Метод не поддерживается");
    return true;
  }

  const match = new RegExp(`^${BASE}/([^/]+)(/screenshot)?$`).exec(url.pathname);
  if (!match) return false;

  const id = decodeURIComponent(match[1]);
  const comment = comments.find((item) => item.id === id);
  if (!comment) {
    sendError(response, 404, "not_found", "Замечание не найдено");
    return true;
  }

  if (match[2]) {
    const shot = screenshots.get(id);
    if (!shot) {
      sendError(response, 404, "not_found", "Снимка нет");
      return true;
    }
    response.writeHead(200, {
      "Content-Type": shot.type,
      "Content-Length": shot.bytes.length,
      "Cache-Control": "no-store",
    });
    response.end(shot.bytes);
    return true;
  }

  if (request.method === "PATCH") {
    let patch;
    try {
      patch = await readJson(request, 1024 * 1024);
    } catch {
      sendError(response, 400, "validation_failed", "Некорректный JSON");
      return true;
    }
    if (patch.status !== undefined) {
      if (!STATUSES.has(patch.status)) {
        sendError(response, 400, "validation_failed", "Неизвестный статус");
        return true;
      }
      comment.status = patch.status;
      if (patch.status === "fixed" || patch.status === "rejected") {
        comment.resolvedBy = user.full_name;
        comment.resolvedAt = now();
      }
    }
    if (patch.resolution !== undefined) {
      const resolution = String(patch.resolution);
      if (resolution.length > 8000) {
        sendError(response, 400, "validation_failed", "Ответ длиннее 8000 символов");
        return true;
      }
      comment.resolution = resolution;
    }
    comment.updatedAt = now();
    sendJson(response, 200, { data: publicComment(comment) });
    return true;
  }

  if (request.method === "DELETE") {
    const index = comments.findIndex((item) => item.id === id);
    if (index >= 0) comments.splice(index, 1);
    screenshots.delete(id);
    sendJson(response, 200, { data: { ok: true } });
    return true;
  }

  sendError(response, 405, "method_not_allowed", "Метод не поддерживается");
  return true;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (handled) return;
      sendError(response, 404, "not_found", "Маршрут не найден");
      return;
    }

    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }

    const showcaseDir = path.join(here, "showcase", "dist");
    let file;
    if (url.pathname === "/showcase" || url.pathname === "/showcase/") {
      file = path.join(showcaseDir, "index.html");
    } else if (url.pathname.startsWith("/showcase/")) {
      file = path.join(showcaseDir, decodeURIComponent(url.pathname.slice("/showcase/".length)));
      if (!file.startsWith(showcaseDir) || !existsSync(file) || statSync(file).isDirectory()) {
        file = path.join(showcaseDir, "index.html");
      }
    } else {
      file = url.pathname === "/" ? path.join(here, "page.html") : path.join(here, decodeURIComponent(url.pathname));
      if (!file.startsWith(here) || !existsSync(file) || statSync(file).isDirectory()) {
        file = path.join(here, "page.html");
      }
    }
    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(response);
  } catch (error) {
    console.error("server error:", error);
    if (!response.headersSent) sendError(response, 500, "internal", "Внутренняя ошибка стенда");
    else response.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("");
  console.log(`  Стенд Site Commenter: http://127.0.0.1:${port}`);
  console.log("");
  console.log("  Страница-трекер — корень, реестр — #/comments.");
  console.log("  Компоненты библиотеки без демо — /showcase/.");
  console.log("  Расширение: chrome://extensions → «Загрузить распакованное» →");
  console.log("  sitecommenter/extension/dist (после node local-dev/start.mjs).");
  console.log("  Остановить: Ctrl+C. Замечания живут в памяти процесса.");
  console.log("");
});
