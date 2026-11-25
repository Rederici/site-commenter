import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ScreenShot } from "./capture";
import type {
  UiComment,
  UiCommentStatus,
  UiCommentsApi,
  UiCommentsContext,
  UiCommentsLabels,
  UiCommentsUser,
} from "./types";

/** Настройки модуля, которые передаёт приложение-хост. */
export type UiCommentsConfig = {
  /** Реализация API (готовый клиент — `createUiCommentsApi`). */
  api: UiCommentsApi;
  user: UiCommentsUser;
  /** Текущий экран и прикладной контекст; хост пересчитывает при навигации. */
  context: UiCommentsContext;
  /** Переопределение русских подписей. */
  labels?: Partial<UiCommentsLabels>;
  /** Префикс ключей localStorage. По умолчанию `ui-comments`. */
  storageKey?: string;
  /** Корень, который попадает на снимок. По умолчанию `body`. */
  captureRoot?: string;
  /**
   * Свой захват экрана. Нужен расширению браузера: `captureVisibleTab` даёт
   * нативный снимок вкладки. По умолчанию — рендер DOM через html-to-image.
   */
  capture?: () => Promise<ScreenShot | null>;
  /** Разрешить разметку поверх экрана. По умолчанию включена. */
  annotations?: boolean;
  /** Показывать плавающее окно. По умолчанию включено. */
  enabled?: boolean;
  /** Куда ведёт ссылка «Все замечания». По умолчанию `#/comments`. */
  registryHref?: string;
  /** Ссылка на экран из замечания. По умолчанию — сохранённый адрес. */
  screenHref?: (comment: UiComment) => string;
  /** Ссылка на конкретное замечание для чата/агента. */
  commentHref?: (comment: UiComment) => string;
  /** Вызывается после успешной отправки — для уведомления хоста. */
  onSent?: (comment: UiComment) => void;
};

export type ResolvedUiCommentsConfig = {
  api: UiCommentsApi;
  user: UiCommentsUser;
  context: UiCommentsContext;
  storageKey: string;
  captureRoot: string;
  annotations: boolean;
  enabled: boolean;
  registryHref: string;
  screenHref: (comment: UiComment) => string;
  commentHref: (comment: UiComment) => string;
  labels: UiCommentsLabels;
  capture?: () => Promise<ScreenShot | null>;
  onSent?: (comment: UiComment) => void;
};

export const DEFAULT_STATUS_LABELS: Record<UiCommentStatus, string> = {
  new: "Новое",
  in_work: "В работе",
  fixed: "Исправлено",
  rejected: "Отклонено",
};

export const STATUS_ORDER: UiCommentStatus[] = ["new", "in_work", "fixed", "rejected"];

export const DEFAULT_LABELS: UiCommentsLabels = {
  fab: "Замечание",
  title: "Замечание по экрану",
  placeholder: "Что не так на этом экране? Что ожидали увидеть?",
  submit: "Отправить",
  saving: "Сохраняем…",
  capturing: "Снимаем экран…",
  sending: "Отправляем…",
  sent: "Замечание сохранено — спасибо!",
  listLink: "Все замечания",
  shotToggle: "Снимок экрана",
  annotationTitle: "Разметка",
  annotationHint: "Обведите или подчеркните проблемное место — разметка попадёт на снимок",
  shotOnlyHint: "Можно не писать — достаточно снимка с разметкой",
  annotationTools: {
    pointer: "Без разметки",
    arrow: "Стрелка",
    underline: "Подчёркивание",
    rect: "Обводка",
    text: "Надпись",
  },
  registryTitle: "Замечания по интерфейсу",
  registrySubtitle: "со ссылками на экраны и снимками",
  emptyRegistry: "Пока нет замечаний.",
  noText: "Без текста — смотрите снимок",
  statuses: DEFAULT_STATUS_LABELS,
};

const ConfigContext = createContext<ResolvedUiCommentsConfig | null>(null);

export function UiCommentsProvider({ config, children }: { config: UiCommentsConfig; children: ReactNode }) {
  const value = useMemo<ResolvedUiCommentsConfig>(
    () => ({
      api: config.api,
      user: config.user,
      context: config.context,
      storageKey: config.storageKey || "ui-comments",
      captureRoot: config.captureRoot || "body",
      annotations: config.annotations !== false,
      enabled: config.enabled !== false,
      registryHref: config.registryHref || "#/comments",
      screenHref: config.screenHref || ((comment) => comment.url || comment.route || "#"),
      commentHref: config.commentHref || ((comment) => `#/comments?comment=${encodeURIComponent(comment.id)}`),
      labels: {
        ...DEFAULT_LABELS,
        ...config.labels,
        statuses: { ...DEFAULT_STATUS_LABELS, ...(config.labels?.statuses || {}) },
        annotationTools: {
          ...DEFAULT_LABELS.annotationTools,
          ...(config.labels?.annotationTools || {}),
        },
      },
      capture: config.capture,
      onSent: config.onSent,
    }),
    [config]
  );
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useUiCommentsConfig(): ResolvedUiCommentsConfig {
  const value = useContext(ConfigContext);
  if (!value) {
    throw new Error("UiComments: оберните компоненты в <UiCommentsProvider config={...}>");
  }
  return value;
}
