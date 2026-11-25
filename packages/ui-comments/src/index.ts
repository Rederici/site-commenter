/**
 * Модуль «Комментарии по интерфейсу»: разметка поверх экрана, замечание и
 * отправка снимка на сервер.
 *
 * Подключение — см. README.md рядом. Кратко:
 *
 *   import { UiCommentsProvider, UiCommentsWidget, UiCommentsRegistry, createUiCommentsApi } from "./uicomments";
 *   import "./uicomments/styles.css";
 */

export { UiCommentsProvider, useUiCommentsConfig, DEFAULT_LABELS, STATUS_ORDER } from "./config";
export type { UiCommentsConfig, ResolvedUiCommentsConfig } from "./config";
export { UiCommentsWidget } from "./UiCommentsWidget";
export { UiCommentsRegistry } from "./UiCommentsRegistry";
export { createUiCommentsApi } from "./api";
export type { UiCommentsApiOptions } from "./api";
export { captureScreen, CAPTURE_SKIP_ATTR } from "./capture";
export type { ScreenShot, CaptureOptions } from "./capture";
export { ANNOTATION_COLORS } from "./annotations";
export {
  UI_COMMENTS_OPEN_EVENT,
  UI_COMMENTS_CHANGED_EVENT,
  openUiCommentsWindow,
  notifyUiCommentsChanged,
} from "./events";
export * from "./types";
