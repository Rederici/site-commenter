import { useMemo, type ReactNode } from "react";
import {
  UiCommentsProvider,
  UiCommentsWidget,
  UiCommentsRegistry,
  createUiCommentsApi,
  type UiComment,
  type UiCommentsApi,
} from "../src";
import "../src/styles.css";

/**
 * Пример без привязки к роутеру: контекст берётся из location, API — из
 * конверта {"data": ...}. В своём проекте замените это на свои сессию,
 * навигацию и канал/дату.
 */

type Props = {
  user: { username: string; name?: string; role?: string; isAdmin?: boolean };
  day?: string;
  children: ReactNode;
};

// Ссылка из реестра на экран: путь плюс query из сохранённого адреса.
function screenHref(comment: UiComment): string {
  if (!comment.route) return comment.url || "#";
  try {
    return `${comment.route}${new URL(comment.url, window.location.origin).search}`;
  } catch {
    return comment.route;
  }
}

export function UiCommentsExample({ user, day, children }: Props) {
  const api: UiCommentsApi = useMemo(() => createUiCommentsApi(), []);
  const context = useMemo(
    () => ({
      route: window.location.pathname,
      routeTitle: document.title || window.location.pathname,
      url: window.location.href,
      date: day,
    }),
    [day]
  );

  return (
    <UiCommentsProvider config={{ api, user, context, captureRoot: "#root", screenHref }}>
      {children}
      <UiCommentsWidget />
    </UiCommentsProvider>
  );
}

export function CommentsPage() {
  return <UiCommentsRegistry />;
}
