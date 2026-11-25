/**
 * Content script: монтирует окно замечаний в shadow root страницы.
 *
 * Модуль замечаний берётся из клиента — тот же код, что и во встроенной
 * версии. Отличия две: снимок нативный (nativeCapture) и контекст экрана
 * читается из URL, а не из роутера приложения.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  UiCommentsProvider,
  UiCommentsWidget,
  createUiCommentsApi,
  UI_COMMENTS_CHANGED_EVENT,
  UI_COMMENTS_OPEN_EVENT,
  type UiComment,
  type UiCommentsContext,
  type UiCommentsUser,
} from "../../src";
import styles from "../../src/styles.css";
import { HOST_ID, nativeCapture } from "./nativeCapture";

const API_BASE = "/api/v1/ui-comments";
const INLINE_MARKER = "data-ui-comments-inline";
const LOCATION_EVENT = "ui-comments:location";

if (!document.getElementById(HOST_ID) && !document.documentElement.hasAttribute(INLINE_MARKER)) {
  mount();
}

function mount() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const container = document.createElement("div");
  shadow.appendChild(container);
  createRoot(container).render(<ExtensionApp />);
}

function ExtensionApp() {
  const [me, setMe] = useState<UiCommentsUser | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  const api = useMemo(() => createUiCommentsApi({ basePath: API_BASE }), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: { user?: Record<string, unknown> } } | null) => {
        if (!alive) return;
        const user = payload?.data?.user;
        if (user) {
          const permissions = Array.isArray(user.permissions) ? (user.permissions as string[]) : [];
          setMe({
            username: String(user.username || ""),
            name: String(user.full_name || user.username || ""),
            role: String(user.role_name || user.role || ""),
            isAdmin: permissions.includes("*") || permissions.includes("admin.write"),
          });
        }
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    window.addEventListener("hashchange", bump);
    window.addEventListener("popstate", bump);
    window.addEventListener(LOCATION_EVENT, bump);
    return () => {
      window.removeEventListener("hashchange", bump);
      window.removeEventListener("popstate", bump);
      window.removeEventListener(LOCATION_EVENT, bump);
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    const update = () => {
      api
        .list()
        .then((items) => {
          if (!alive) return;
          const count = items.filter((item) => item.status === "new" || item.status === "in_work").length;
          void chrome.runtime.sendMessage({ type: "ui-comments:badge", count });
        })
        .catch(() => {});
    };
    update();
    window.addEventListener(UI_COMMENTS_CHANGED_EVENT, update);
    return () => {
      alive = false;
      window.removeEventListener(UI_COMMENTS_CHANGED_EVENT, update);
    };
  }, [me, api]);

  useEffect(() => {
    const open = () => window.dispatchEvent(new Event(UI_COMMENTS_OPEN_EVENT));
    const listener = (message: { type?: string }) => {
      if (message?.type === "ui-comments:open") open();
    };
    chrome.runtime.onMessage.addListener(listener);
  }, []);

  const context = useMemo<UiCommentsContext>(() => buildContext(), [version]);

  if (!ready || !me) return null;

  return (
    <UiCommentsProvider
      config={{
        api,
        user: me,
        context,
        capture: nativeCapture,
        storageKey: "x3.ui-comments",
        registryHref: buildRegistryHref(),
        onSent: (comment: UiComment) => {
          // Счётчик обновится по событию из модуля; здесь только журнал.
          console.debug("ui-comments: отправлено", comment.id);
        },
      }}
    >
      <UiCommentsWidget />
    </UiCommentsProvider>
  );
}

// Приложение на hash-роутере: путь берём из #/planner, канал и дату — из query.
// В проекте с обычными путями используется location.pathname.
function buildContext(): UiCommentsContext {
  const hash = window.location.hash.replace(/^#/, "");
  const [hashPath = ""] = hash.split("?");
  const route = hashPath.startsWith("/") ? hashPath : window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const date = params.get("date") || "";
  return {
    route: route || "/",
    routeTitle: document.title || route,
    url: window.location.href,
    channelId: params.get("channel") || "",
    date: date || undefined,
    dateLabel: date ? date.split("-").reverse().join(".") : undefined,
  };
}

function buildRegistryHref(): string {
  const query = window.location.search || "";
  return `${window.location.origin}/${query}#/comments`;
}

// SPA меняет адрес через history.pushState — hashchange при этом не срабатывает.
for (const method of ["pushState", "replaceState"] as const) {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History["pushState"]>) => {
    original(...args);
    window.dispatchEvent(new Event(LOCATION_EVENT));
  };
}
