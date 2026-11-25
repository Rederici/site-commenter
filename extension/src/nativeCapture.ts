/**
 * Нативный снимок вкладки для расширения.
 *
 * В отличие от встроенного модуля, здесь не нужно клонировать DOM и рисовать
 * его через html-to-image: `chrome.tabs.captureVisibleTab` отдаёт готовую
 * картинку активной вкладки — с видео, canvas и iframe. Панель замечания на
 * момент съёмки скрывается, разметка остаётся.
 */

import type { ScreenShot } from "../../src";

export const HOST_ID = "ui-comments-extension-root";

const PANEL_SELECTOR = ".uic-root";

export async function nativeCapture(): Promise<ScreenShot | null> {
  const host = document.getElementById(HOST_ID);
  const panel = host?.shadowRoot?.querySelector<HTMLElement>(PANEL_SELECTOR) ?? null;
  const previous = panel?.style.visibility ?? "";
  if (panel) panel.style.visibility = "hidden";
  await nextFrame();
  await nextFrame();

  try {
    const response = (await chrome.runtime.sendMessage({ type: "ui-comments:capture" })) as
      | { dataUrl?: string; error?: string }
      | undefined;
    if (!response?.dataUrl) {
      console.warn("ui-comments: не удалось снять вкладку", response);
      return null;
    }
    const dataUrl = await toJpeg(response.dataUrl);
    return { dataUrl, width: window.innerWidth, height: window.innerHeight };
  } finally {
    if (panel) panel.style.visibility = previous;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** PNG из captureVisibleTab переводим в JPEG: снимок в 3–5 раз легче. */
async function toJpeg(dataUrl: string, quality = 0.82): Promise<string> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("не удалось прочитать снимок вкладки"));
    image.src = src;
  });
}
