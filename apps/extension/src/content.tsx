/**
 * Content script: монтирует окно замечаний в shadow root страницы.
 *
 * Модуль замечаний берётся из @sitecommenter/ui-comments. Отличия от встроенной
 * версии: снимок нативный (nativeCapture), контекст читается из URL, а
 * отправка создаёт задачу в YouTrack через background.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  UiCommentsProvider,
  UiCommentsWidget,
  UI_COMMENTS_OPEN_EVENT,
  type UiComment,
  type UiCommentInput,
  type UiCommentsApi,
  type UiCommentsContext,
  type UiCommentsUser,
} from "@sitecommenter/ui-comments";
import styles from "@sitecommenter/ui-comments/styles.css";
import { HOST_ID, nativeCapture } from "./nativeCapture";
import { DEFAULT_SETTINGS, issuesUrl } from "./youtrack-config";

const INLINE_MARKER = "data-ui-comments-inline";
const LOCATION_EVENT = "ui-comments:location";

const user: UiCommentsUser = {
  username: "youtrack",
  name: "Тестировщик",
  role: "YouTrack",
};

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

type CreateResponse = {
  ok?: boolean;
  issue?: { id?: string; idReadable?: string; url?: string };
  error?: string;
};

function ExtensionApp() {
  const [version, setVersion] = useState(0);

  const api = useMemo<UiCommentsApi>(
    () => ({
      async create(input: UiCommentInput): Promise<UiComment> {
        const payload: UiCommentInput = {
          ...input,
          routeTitle: document.title.trim() || input.routeTitle,
        };
        const response = (await chrome.runtime.sendMessage({
          type: "youtrack:create",
          payload,
        })) as CreateResponse;

        if (!response?.ok || !response.issue) {
          throw new Error(response?.error || "Не удалось создать задачу в YouTrack");
        }

        const issue = response.issue;
        return {
          id: issue.idReadable || issue.id || "issue",
          author: user.name || user.username,
          authorUsername: user.username,
          role: user.role || "",
          text: input.text,
          status: "new",
          route: input.route,
          routeTitle: input.routeTitle,
          url: input.url,
          channelId: input.channelId || "",
          channelName: input.channelName || "",
          date: input.date || "",
          viewportWidth: input.viewportWidth || 0,
          viewportHeight: input.viewportHeight || 0,
          hasScreenshot: Boolean(input.screenshot),
          screenshotType: input.screenshot ? "image/jpeg" : "",
          resolution: "",
          resolvedBy: "",
          resolvedAt: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
      async list(): Promise<UiComment[]> {
        return [];
      },
    }),
    []
  );

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
    const listener = (message: { type?: string }) => {
      if (message?.type === "ui-comments:open") {
        window.dispatchEvent(new Event(UI_COMMENTS_OPEN_EVENT));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  }, []);

  const context = useMemo<UiCommentsContext>(() => buildContext(), [version]);

  return (
    <UiCommentsProvider
      config={{
        api,
        user,
        context,
        capture: nativeCapture,
        storageKey: "youtrack.ui-comments",
        registryHref: issuesUrl(DEFAULT_SETTINGS),
        labels: {
          title: "Замечание → задача YouTrack",
          placeholder: "Что не так? Это станет описанием задачи",
          submit: "Создать задачу",
          sending: "Создаём задачу…",
          sent: "Задача создана",
          listLink: "Задачи в YouTrack",
          shotOnlyHint: "Можно не писать — снимок попадёт в задачу",
        },
        submitNote: (
          <>
            Задача будет создана в проекте{" "}
            <strong>
              {DEFAULT_SETTINGS.projectName} ({DEFAULT_SETTINGS.projectShortName})
            </strong>
            , тип <strong>{DEFAULT_SETTINGS.issueType}</strong>.
          </>
        ),
        onSent: (comment) => {
          console.debug("youtrack: создана задача", comment.id);
        },
      }}
    >
      <UiCommentsWidget />
    </UiCommentsProvider>
  );
}

// Приложение на обычных путях: маршрут — pathname. Hash оставлен для стенда.
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

// SPA меняет адрес через history.pushState — hashchange при этом не срабатывает.
for (const method of ["pushState", "replaceState"] as const) {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History["pushState"]>) => {
    original(...args);
    window.dispatchEvent(new Event(LOCATION_EVENT));
  };
}
