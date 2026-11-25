/**
 * Service worker расширения.
 *
 * Отдаёт нативный снимок вкладки, открывает окно замечания по горячей
 * клавише, создаёт задачи в YouTrack и обслуживает popup настроек.
 */

import type { UiCommentInput } from "@sitecommenter/ui-comments";
import { logout } from "./oauth";
import {
  createTask,
  fetchIssueTypes,
  fetchProjects,
  getCurrentUser,
  loginUser,
} from "./youtrack";
import { loadSettings } from "./youtrack-config";

const SCRIPT_ID = "site-commenter";

function sitePatterns(site: string): string[] {
  let text = site.trim().toLowerCase();
  if (!text) return [];

  if (text.includes("://")) {
    try {
      text = new URL(text).hostname;
    } catch {
      return [];
    }
  } else {
    text = text.split("/")[0].replace(/:\d+$/, "");
  }

  if (!/^(\*\.)?[a-z0-9.-]+$/.test(text)) return [];
  return [`http://${text}/*`, `https://${text}/*`];
}

async function syncContentScripts(): Promise<void> {
  const settings = await loadSettings();
  const matches = [...new Set(settings.sites.flatMap(sitePatterns))];

  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    // скрипт ещё не был зарегистрирован
  }

  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches,
      js: ["content.js"],
      runAt: "document_idle",
    },
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  void syncContentScripts().catch((error) => console.warn("sync content scripts:", error));
});
chrome.runtime.onStartup.addListener(() => {
  void syncContentScripts().catch((error) => console.warn("sync content scripts:", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ui-comments:capture") {
    chrome.tabs.captureVisibleTab(undefined, { format: "png" }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error || !dataUrl) {
        sendResponse({ error: error?.message || "не удалось снять вкладку" });
        return;
      }
      sendResponse({ dataUrl });
    });
    return true; // ответ асинхронный
  }

  if (message?.type === "youtrack:create") {
    const input = message.payload as UiCommentInput;
    createTask(input)
      .then((issue) => sendResponse({ ok: true, issue }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type === "youtrack:status") {
    getCurrentUser()
      .then((user) => sendResponse({ user }))
      .catch(() => sendResponse({ user: null }));
    return true;
  }

  if (message?.type === "youtrack:login") {
    loginUser()
      .then((user) => sendResponse({ user }))
      .catch((error: unknown) =>
        sendResponse({ error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type === "youtrack:logout") {
    logout()
      .then(() => chrome.storage.local.remove("youtrack.settings"))
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type === "youtrack:projects") {
    fetchProjects()
      .then((projects) => sendResponse({ projects }))
      .catch((error: unknown) =>
        sendResponse({ error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type === "youtrack:issue-types") {
    const payload = message.payload as { projectId?: string } | undefined;
    if (!payload?.projectId) {
      sendResponse({ error: "Проект не выбран" });
      return false;
    }
    fetchIssueTypes(payload.projectId)
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({ error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type === "youtrack:sync-sites") {
    syncContentScripts()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type === "youtrack:open-url") {
    const payload = message.payload as { url?: string } | undefined;
    const url = payload?.url || "";
    if (!/^https?:\/\//.test(url)) {
      sendResponse({ error: "Некорректный URL" });
      return false;
    }
    chrome.tabs
      .create({ url })
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message?.type === "ui-comments:badge") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      const count = Number(message.count) || 0;
      chrome.action.setBadgeText({ tabId, text: count > 0 ? String(Math.min(count, 99)) : "" });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#2f6fed" });
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function openOnActiveTab(tab: chrome.tabs.Tab | undefined) {
  if (tab?.id !== undefined) {
    chrome.tabs.sendMessage(tab.id, { type: "ui-comments:open" }).catch(() => {
      // На странице нет content script — это нормально (чужой сайт).
    });
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-comments") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => openOnActiveTab(tabs[0]));
});
