/**
 * Снимок видимой области вместе с разметкой.
 *
 * html-to-image рисует DOM в SVG/foreignObject силами браузера, поэтому
 * повторять раскладку вручную не нужно. Две вещи библиотека не умеет сама:
 *
 * 1. Позиции прокрутки внутренних контейнеров: страницы обычно не
 *    прокручиваются (прокручиваются панели). Поэтому снимаем не живой DOM, а
 *    его копию, вставленную в документ: копия реально раскладывается, и ей
 *    можно выставить `scrollTop`/`scrollLeft`.
 * 2. Значения полей ввода: `cloneNode` не копирует `value`/`checked`.
 *
 * Копия висит с `opacity: 0` и `pointer-events: none`, а при съёмке
 * прозрачность возвращается через опции html-to-image.
 */

export type ScreenShot = {
  dataUrl: string;
  width: number;
  height: number;
};

/** Узлы с этим атрибутом не попадают на снимок (панель, кнопки модуля). */
export const CAPTURE_SKIP_ATTR = "data-ui-comment-skip";

export type CaptureOptions = {
  /** Селектор корня, который попадает на снимок. По умолчанию `body`. */
  rootSelector?: string;
  /** Качество JPEG, 0..1. По умолчанию 0.82. */
  quality?: number;
};

export async function captureScreen(options: CaptureOptions = {}): Promise<ScreenShot | null> {
  const root = document.querySelector<HTMLElement>(options.rootSelector || "body");
  if (!root) return null;

  const width = Math.round(document.documentElement.clientWidth);
  const height = Math.round(document.documentElement.clientHeight);
  if (width <= 0 || height <= 0) return null;

  const clone = root.cloneNode(true) as HTMLElement;
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  clone.style.position = "fixed";
  clone.style.left = "0";
  clone.style.top = "0";
  clone.style.margin = "0";
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.opacity = "0";
  clone.style.pointerEvents = "none";
  clone.style.overflow = "hidden";
  document.body.appendChild(clone);

  try {
    syncFormState(root, clone);
    bakeScroll(root, clone);
    clone.querySelectorAll(`[${CAPTURE_SKIP_ATTR}]`).forEach((node) => node.remove());

    // Библиотека нужна только при сохранении со снимком: держим её отдельным
    // чанком, чтобы не утяжелять основной бандл.
    const { toJpeg } = await import("html-to-image");
    const dataUrl = await toJpeg(clone, {
      width,
      height,
      pixelRatio: 1,
      quality: options.quality ?? 0.82,
      skipAutoScale: true,
      backgroundColor: pageBackground(),
      style: { opacity: "1" },
    });
    return { dataUrl, width, height };
  } finally {
    clone.remove();
  }
}

/** Копирует значения полей: cloneNode их не переносит. */
function syncFormState(source: Element, target: Element) {
  const from = source.querySelectorAll("input, textarea, select");
  const to = target.querySelectorAll("input, textarea, select");
  const limit = Math.min(from.length, to.length);
  for (let i = 0; i < limit; i += 1) {
    const a = from[i];
    const b = to[i];
    if (a instanceof HTMLInputElement && b instanceof HTMLInputElement) {
      b.value = a.value;
      b.checked = a.checked;
    } else if (a instanceof HTMLTextAreaElement && b instanceof HTMLTextAreaElement) {
      b.value = a.value;
    } else if (a instanceof HTMLSelectElement && b instanceof HTMLSelectElement) {
      b.selectedIndex = a.selectedIndex;
    }
  }
}

/**
 * Запекает прокрутку контейнеров в копию.
 *
 * html-to-image клонирует переданный узел ещё раз и не переносит `scrollTop`,
 * поэтому в кадре панели оказываются прокрученными в начало. Сдвигаем
 * содержимое контейнеров трансформом: он попадает в вычисленные стили копии
 * и переживает повторное клонирование. Липкие и фиксированные элементы не
 * двигаем — они и так стоят на месте.
 */
function bakeScroll(source: Element, target: Element) {
  if (source instanceof HTMLElement && target instanceof HTMLElement) {
    const left = source.scrollLeft;
    const top = source.scrollTop;
    if (left || top) {
      for (const child of Array.from(target.children)) {
        const style = getComputedStyle(child);
        if (style.position === "sticky" || style.position === "fixed") continue;
        const existing = (child as HTMLElement).style.transform;
        (child as HTMLElement).style.transform =
          `${existing} translate(${-left}px, ${-top}px)`.trim();
      }
      target.scrollTop = 0;
      target.scrollLeft = 0;
    }
  }
  const from = source.children;
  const to = target.children;
  const limit = Math.min(from.length, to.length);
  for (let i = 0; i < limit; i += 1) bakeScroll(from[i], to[i]);
}

function pageBackground(): string {
  const value = getComputedStyle(document.body).backgroundColor;
  return value && value !== "rgba(0, 0, 0, 0)" ? value : "#ffffff";
}
