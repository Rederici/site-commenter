/**
 * Минимальные типы Chrome API, которые использует расширение.
 * Отдельный @types/chrome не нужен: поверхность маленькая и стабильная.
 */

declare namespace chrome {
  namespace runtime {
    const id: string | undefined;
    const lastError: { message?: string } | undefined;
    interface MessageSender {
      tab?: { id?: number };
    }
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        callback: (
          message: { type?: string; count?: number },
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
    }
    function captureVisibleTab(
      windowId: number | undefined,
      options: { format: "png" | "jpeg"; quality?: number },
      callback: (dataUrl: string) => void
    ): void;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
    function query(queryInfo: { active?: boolean; currentWindow?: boolean }, callback: (tabs: Tab[]) => void): void;
  }

  namespace action {
    function setBadgeText(details: { tabId?: number; text: string }): void;
    function setBadgeBackgroundColor(details: { tabId?: number; color: string }): void;
    const onClicked: {
      addListener(callback: (tab: tabs.Tab) => void): void;
    };
  }

  namespace commands {
    const onCommand: {
      addListener(callback: (command: string) => void): void;
    };
  }
}
