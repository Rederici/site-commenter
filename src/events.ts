/**
 * События модуля: открыть окно и «данные изменились».
 *
 * Окно и реестр — независимые компоненты; события позволяют реестру открыть
 * форму, а окну — обновить счётчик после правки в реестре.
 */

export const UI_COMMENTS_OPEN_EVENT = "x3:ui-comments-open";
export const UI_COMMENTS_CHANGED_EVENT = "x3:ui-comments-changed";

export function openUiCommentsWindow() {
  window.dispatchEvent(new Event(UI_COMMENTS_OPEN_EVENT));
}

export function notifyUiCommentsChanged() {
  window.dispatchEvent(new Event(UI_COMMENTS_CHANGED_EVENT));
}
