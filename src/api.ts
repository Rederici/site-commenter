import type {
  UiComment,
  UiCommentFilter,
  UiCommentsApi,
  UiCommentStatus,
} from "./types";

/**
 * Готовая реализация клиента для сервера, который отдаёт данные в конверте
 * `{"data": ...}`. Другому бэкенду достаточно реализовать интерфейс
 * `UiCommentsApi` вручную.
 */
export type UiCommentsApiOptions = {
  /** Базовый путь API. По умолчанию `/api/v1/ui-comments`. */
  basePath?: string;
  fetchImpl?: typeof fetch;
  credentials?: RequestCredentials;
  /** Таймаут одного запроса, мс. */
  timeoutMs?: number;
};

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const result = search.toString();
  return result ? `?${result}` : "";
};

export function createUiCommentsApi(options: UiCommentsApiOptions = {}): UiCommentsApi {
  const base = (options.basePath || "/api/v1/ui-comments").replace(/\/+$/, "");
  const doFetch = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
  const credentials = options.credentials ?? "same-origin";
  const timeoutMs = options.timeoutMs ?? 30_000;

  const request = async <T>(path: string, init: RequestInit = {}, timeout = timeoutMs): Promise<T> => {
    if (!doFetch) throw new Error("fetch недоступен: передайте fetchImpl в createUiCommentsApi");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    if (init.signal) {
      const outer = init.signal as AbortSignal;
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const response = await doFetch(`${base}${path}`, {
        ...init,
        credentials,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        const error = (payload as { error?: { message?: string } } | null)?.error;
        throw new Error(error?.message || `Запрос завершился с HTTP ${response.status}`);
      }
      if (payload && typeof payload === "object" && "data" in payload) {
        return (payload as { data: T }).data;
      }
      return payload as T;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    create: (input) =>
      request<UiComment>("", { method: "POST", body: JSON.stringify(input) }),
    list: (filter: UiCommentFilter = {}, signal) =>
      request<UiComment[]>(
        query({ status: filter.status, route: filter.route, channel: filter.channel, date: filter.date, q: filter.q }),
        { signal },
        15_000
      ),
    update: (id, patch) =>
      request<UiComment>(`/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    remove: (id) =>
      request<unknown>(`/${encodeURIComponent(id)}`, { method: "DELETE" }),
    screenshotUrl: (id) => `${base}/${encodeURIComponent(id)}/screenshot`,
  };
}
