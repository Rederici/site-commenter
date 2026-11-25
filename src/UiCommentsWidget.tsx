import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, AnnotationTool, UiComment } from "./types";
import { useUiCommentsConfig } from "./config";
import { useCommentsList } from "./useCommentsList";
import { captureScreen } from "./capture";
import {
  UI_COMMENTS_CHANGED_EVENT,
  UI_COMMENTS_OPEN_EVENT,
  notifyUiCommentsChanged,
} from "./events";
import { AnnotationLayer, AnnotationToolbar, ANNOTATION_COLORS } from "./annotations";

const OPEN_STATUSES = new Set(["new", "in_work"]);

// Держим кнопку в пределах окна: позиция хранится в пикселях и могла быть
// сохранена на большом мониторе, а открыться — на маленьком.
function clampFabPosition(x: number, y: number, width = 160, height = 40) {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
  };
}

/**
 * Плавающее окно замечаний.
 *
 * Оператор смотрит экран, при необходимости обводит проблемное место
 * (стрелка, подчёркивание, обводка, надпись), пишет текст и отправляет всё
 * вместе со снимком на сервер. Свёрнутое состояние — кнопка со счётчиком.
 */
export function UiCommentsWidget() {
  const {
    api,
    context,
    labels,
    storageKey,
    captureRoot,
    capture,
    annotations: annotationsEnabled,
    enabled,
    registryHref,
    onSent,
  } = useUiCommentsConfig();
  const openKey = `${storageKey}.open`;
  const fabKey = `${storageKey}.fab`;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(openKey) === "1";
  });
  // Позиция перетаскиваемой кнопки: {x, y} в пикселях от левого верхнего угла.
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(fabKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
        return clampFabPosition(parsed.x, parsed.y);
      }
    } catch {
      // повреждённое значение — используем позицию по умолчанию
    }
    return null;
  });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState("");
  const [withShot, setWithShot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [shotWarning, setShotWarning] = useState("");
  const [tool, setTool] = useState<AnnotationTool>("pointer");
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const list = useCommentsList(api, {}, `${storageKey}:list`);
  const { reload } = list;
  const fabPosRef = useRef(fabPos);
  fabPosRef.current = fabPos;

  const clampFab = useCallback((x: number, y: number, el?: HTMLElement | null) => {
    return clampFabPosition(x, y, el?.offsetWidth, el?.offsetHeight);
  }, []);

  // Перетаскиваем кнопку: она не должна закрывать часть интерфейса.
  const onFabPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onFabPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    setDragging(true);
    setFabPos(clampFab(drag.originX + dx, drag.originY + dy, event.currentTarget));
  };
  const onFabPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag?.moved) return;
    suppressClick.current = true;
    const pos = fabPosRef.current;
    if (pos) {
      try {
        window.localStorage.setItem(fabKey, JSON.stringify(pos));
      } catch {
        // приватный режим — позиция просто не запомнится
      }
    }
  };
  const onFabClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setOpenState(true);
  };

  useEffect(() => {
    if (!enabled || open) return;
    // Кнопка появляется только после проверки сессии: в момент монтирования её
    // ещё нет в DOM, поэтому дожимаем позицию, когда она отрисовалась.
    const frame = window.requestAnimationFrame(() => {
      const pos = fabPosRef.current;
      if (!pos) return;
      const el = document.querySelector<HTMLElement>(".uic-fab");
      const next = clampFabPosition(pos.x, pos.y, el?.offsetWidth, el?.offsetHeight);
      if (next.x === pos.x && next.y === pos.y) return;
      setFabPos(next);
      try {
        window.localStorage.setItem(fabKey, JSON.stringify(next));
      } catch {
        // приватный режим
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, open, fabKey]);

  useEffect(() => {
    const onResize = () => {
      const pos = fabPosRef.current;
      if (!pos) return;
      const el = document.querySelector<HTMLElement>(".uic-fab");
      const next = clampFabPosition(pos.x, pos.y, el?.offsetWidth, el?.offsetHeight);
      setFabPos(next);
      try {
        window.localStorage.setItem(fabKey, JSON.stringify(next));
      } catch {
        // приватный режим
      }
    };
    // Сразу после загрузки: позиция могла быть сохранена на большом мониторе.
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fabKey]);

  const openCount = useMemo(
    () => list.data.filter((item) => OPEN_STATUSES.has(item.status)).length,
    [list.data]
  );
  const screenCount = useMemo(
    () => list.data.filter((item) => item.route === context.route && OPEN_STATUSES.has(item.status)).length,
    [list.data, context.route]
  );

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      window.localStorage.setItem(openKey, next ? "1" : "0");
    },
    [openKey]
  );

  useEffect(() => {
    const onOpen = () => setOpenState(true);
    window.addEventListener(UI_COMMENTS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(UI_COMMENTS_OPEN_EVENT, onOpen);
  }, [setOpenState]);

  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener(UI_COMMENTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(UI_COMMENTS_CHANGED_EVENT, onChanged);
  }, [reload]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  // Esc возвращает указатель и не даёт «застрять» в инструменте.
  useEffect(() => {
    if (tool === "pointer") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTool("pointer");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  // Разметка живёт на конкретном экране: при переходе очищаем, иначе
  // стрелки останутся поверх чужого экрана.
  useEffect(() => {
    setAnnotations([]);
    setTool("pointer");
  }, [context.route]);

  // Метка для расширения браузера: если модуль уже встроен в приложение,
  // расширение не ставит второй виджет на ту же страницу.
  useEffect(() => {
    if (!enabled) return;
    document.documentElement.setAttribute("data-ui-comments-inline", "");
    return () => document.documentElement.removeAttribute("data-ui-comments-inline");
  }, [enabled]);

  // Разметка имеет смысл только в снимке.
  useEffect(() => {
    if (annotations.length > 0 && !withShot) setWithShot(true);
  }, [annotations.length, withShot]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), 4000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  if (!enabled) return null;

  const submit = async () => {
    if (busy) return;
    const willCapture = withShot || annotations.length > 0;
    if (!text.trim() && !willCapture) {
      setError("Опишите замечание или приложите снимок экрана");
      return;
    }
    setBusy(true);
    setError("");
    setFlash("");
    setShotWarning("");
    let screenshot: string | undefined;
    let viewportWidth = 0;
    let viewportHeight = 0;
    if (withShot) {
      setStage(labels.capturing);
      try {
        const shot = capture
          ? await capture()
          : await captureScreen({ rootSelector: captureRoot });
        if (shot) {
          screenshot = shot.dataUrl;
          viewportWidth = shot.width;
          viewportHeight = shot.height;
        } else {
          setShotWarning("Снимок не получился — замечание сохраним без картинки.");
        }
      } catch {
        setShotWarning("Снимок не получился — замечание сохраним без картинки.");
      }
    }
    setStage(labels.sending);
    try {
      const created = await api.create({
        text: text.trim(),
        route: context.route,
        routeTitle: context.routeTitle,
        url: context.url,
        channelId: context.channelId,
        channelName: context.channelName,
        date: context.date,
        viewportWidth,
        viewportHeight,
        screenshot,
      });
      setText("");
      setStage("");
      setAnnotations([]);
      setTool("pointer");
      setFlash(labels.sent);
      reload();
      notifyUiCommentsChanged();
      onSent?.(created);
    } catch (err) {
      setStage("");
      setError(err instanceof Error ? err.message : "Не удалось сохранить замечание");
    } finally {
      setBusy(false);
    }
  };

  const contextLine = [
    context.routeTitle || context.route,
    context.channelName,
    context.dateLabel || context.date,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!open) {
    return (
      <div
        className="uic-root"
        data-ui-comment-skip=""
        style={fabPos ? { left: fabPos.x, top: fabPos.y, right: "auto", bottom: "auto" } : undefined}
      >
        <button
          className={`uic-fab${dragging ? " is-dragging" : ""}`}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onPointerCancel={onFabPointerUp}
          onClick={onFabClick}
          title="Перетащите, чтобы не перекрывать экран; нажмите, чтобы оставить замечание"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
            <path d="M5 6h6M5 8.2h4" />
          </svg>
          <span>{labels.fab}</span>
          {openCount > 0 && <span className="uic-fab-count">{openCount}</span>}
        </button>
      </div>
    );
  }

  const annotating = annotationsEnabled && tool !== "pointer";

  return (
    <>
      {annotationsEnabled && (
        <AnnotationLayer
          active={annotating}
          tool={tool}
          color={color}
          annotations={annotations}
          onChange={setAnnotations}
        />
      )}

      <div className="uic-root" data-ui-comment-skip="">
        <section className="uic-panel" aria-label={labels.title}>
          <header className="uic-head">
            <div>
              <strong>{labels.title}</strong>
              {contextLine && <div className="uic-context">{contextLine}</div>}
            </div>
            <button
              className="uic-icon"
              onClick={() => setOpenState(false)}
              title="Свернуть окно замечаний"
              aria-label="Свернуть окно замечаний"
            >
              –
            </button>
          </header>

          {annotationsEnabled && (
            <div className="uic-anno-block">
              <div className="uic-anno-title">
                <span>{labels.annotationTitle}</span>
                {annotating && <span className="uic-anno-hint">{labels.annotationHint}</span>}
              </div>
              <AnnotationToolbar
                tool={tool}
                onTool={setTool}
                color={color}
                onColor={setColor}
                count={annotations.length}
                onUndo={() => setAnnotations((prev) => prev.slice(0, -1))}
                onClear={() => setAnnotations([])}
              />
            </div>
          )}

          <div className="uic-body">
            <textarea
              className="uic-input uic-textarea"
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={labels.placeholder}
              autoFocus={!annotating}
            />
            {shotWarning && <div className="uic-note">{shotWarning}</div>}
            {!text.trim() && (withShot || annotations.length > 0) && (
              <div className="uic-hint">{labels.shotOnlyHint}</div>
            )}
            {flash && <div className="uic-flash">{flash}</div>}
            {error && <div className="uic-error">{error}</div>}
            <div className="uic-context-line">
              <span>
                Экран: <span className="uic-mono">{context.route || "/"}</span>
              </span>
              {screenCount > 0 && <span className="uic-tag">на экране уже {screenCount}</span>}
            </div>
          </div>

          <footer className="uic-foot">
            <label className="uic-check" title="Снимок видимой области сохраняется вместе с замечанием">
              <input
                type="checkbox"
                checked={withShot || annotations.length > 0}
                disabled={busy || annotations.length > 0}
                onChange={(event) => setWithShot(event.target.checked)}
              />
              {labels.shotToggle}
            </label>
            <a className="uic-link" href={registryHref}>
              {labels.listLink}
              {openCount > 0 ? ` (${openCount})` : ""}
            </a>
            <button
              className="uic-btn uic-btn-primary"
              onClick={() => void submit()}
              disabled={busy || (!text.trim() && !withShot && annotations.length === 0)}
            >
              {busy ? stage || labels.saving : labels.submit}
            </button>
          </footer>
        </section>
      </div>
    </>
  );
}
