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
      .then((values) => sendResponse({ values }))
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
