/** Типы модуля замечаний по интерфейсу. */

export type UiCommentStatus = "new" | "in_work" | "fixed" | "rejected";

export type UiComment = {
  id: string;
  author: string;
  authorUsername: string;
  role: string;
  text: string;
  status: UiCommentStatus;
  route: string;
  routeTitle: string;
  url: string;
  channelId: string;
  channelName: string;
  date: string;
  viewportWidth: number;
  viewportHeight: number;
  hasScreenshot: boolean;
  screenshotType?: string;
  resolution: string;
  resolvedBy: string;
  resolvedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type UiCommentInput = {
  text: string;
  route: string;
  routeTitle: string;
  url: string;
  channelId?: string;
  channelName?: string;
  date?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  /** data URL снимка с разметкой: image/jpeg. */
  screenshot?: string;
};

export type UiCommentFilter = {
  status?: string;
  route?: string;
  channel?: string;
  date?: string;
  q?: string;
};

/**
 * Контракт с сервером. Обязателен только `create` — его хватает плавающему
 * окну. Остальные методы нужны реестру; если их нет, реестр покажет список
 * без управления.
 */
export type UiCommentsApi = {
  create(input: UiCommentInput): Promise<UiComment>;
  list(filter?: UiCommentFilter, signal?: AbortSignal): Promise<UiComment[]>;
  update?(id: string, patch: { status?: UiCommentStatus; resolution?: string }): Promise<UiComment>;
  remove?(id: string): Promise<unknown>;
  screenshotUrl?(id: string): string;
};

/** Пользователь, от имени которого пишется замечание. */
export type UiCommentsUser = {
  username: string;
  name?: string;
  role?: string;
  /** Может менять статус, отвечать и удалять. */
  isAdmin?: boolean;
};

/** Где сделан снимок: путь экрана, адрес и прикладной контекст. */
export type UiCommentsContext = {
  route: string;
  routeTitle: string;
  url: string;
  channelId?: string;
  channelName?: string;
  /** ISO-дата (2026-11-16), если в проекте есть понятие дня. */
  date?: string;
  /** Подпись даты для окна; по умолчанию берётся `date`. */
  dateLabel?: string;
};

export type UiCommentsLabels = {
  fab: string;
  title: string;
  placeholder: string;
  submit: string;
  saving: string;
  capturing: string;
  sending: string;
  sent: string;
  listLink: string;
  shotToggle: string;
  annotationTitle: string;
  annotationHint: string;
  shotOnlyHint: string;
  annotationTools: Record<AnnotationTool, string>;
  registryTitle: string;
  registrySubtitle: string;
  emptyRegistry: string;
  noText: string;
  statuses: Record<UiCommentStatus, string>;
};

export type AnnotationTool = "pointer" | "arrow" | "underline" | "rect" | "text";

export type Annotation =
  | { id: string; tool: "arrow" | "underline" | "rect"; from: Point; to: Point; color: string }
  | { id: string; tool: "text"; at: Point; text: string; color: string };

export type Point = { x: number; y: number };
