/**
 * Service worker расширения.
 *
 * Умеет три вещи: отдать нативный снимок активной вкладки, открыть окно
 * замечания по кнопке/горячей клавише и показать счётчик на иконке.
 */

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

chrome.action.onClicked.addListener(openOnActiveTab);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-comments") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => openOnActiveTab(tabs[0]));
});
