import { useCallback, useEffect, useRef, useState } from "react";
import type { UiComment, UiCommentFilter, UiCommentsApi } from "./types";

/**
 * Загружает список замечаний. `key` должен меняться при смене фильтра —
 * по нему перезапускается запрос.
 */
export function useCommentsList(
  api: UiCommentsApi,
  filter: UiCommentFilter,
  key: string
): { data: UiComment[]; loading: boolean; error: string; reload: () => void } {
  const [state, setState] = useState<{ data: UiComment[]; loading: boolean; error: string }>({
    data: [],
    loading: true,
    error: "",
  });
  const [attempt, setAttempt] = useState(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    api
      .list(filterRef.current, controller.signal)
      .then((data) => {
        if (alive) setState({ data, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setState({
          data: [],
          loading: false,
          error: error instanceof Error ? error.message : "Не удалось загрузить замечания",
        });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [api, key, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, reload };
}
