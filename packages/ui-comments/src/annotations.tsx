import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Annotation, AnnotationTool, Point } from "./types";
import { useUiCommentsConfig } from "./config";

/** Палитра разметки: читается и на светлой, и на тёмной теме. */
export const ANNOTATION_COLORS = ["#e5252a", "#f59e0b", "#16a34a", "#2563eb"];

const MIN_SIZE = 8;

type ShapeAnnotation = Extract<Annotation, { tool: "arrow" | "underline" | "rect" }>;

/**
 * Слой разметки поверх интерфейса.
 *
 * Живёт вне панели замечания и попадает в снимок: capture клонирует корень
 * приложения вместе с этим SVG. Пока выбран инструмент, слой перехватывает
 * мышь и колесо, чтобы содержимое под разметкой не уезжало.
 */
export function AnnotationLayer({
  active,
  tool,
  color,
  annotations,
  onChange,
}: {
  active: boolean;
  tool: AnnotationTool;
  color: string;
  annotations: Annotation[];
  onChange: (next: Annotation[]) => void;
}) {
  const { labels } = useUiCommentsConfig();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<ShapeAnnotation | null>(null);
  const [label, setLabel] = useState<{ at: Point; value: string } | null>(null);
  const labelRef = useRef<{ at: Point; value: string } | null>(null);
  labelRef.current = label;

  // Колесо не должно прокручивать приложение под разметкой.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || !active) return;
    const onWheel = (event: WheelEvent) => event.preventDefault();
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [active]);

  const toPoint = (event: ReactPointerEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: Math.round(event.clientX - (rect?.left ?? 0)),
      y: Math.round(event.clientY - (rect?.top ?? 0)),
    };
  };

  // commitLabel читает значение из ref: Enter и blur могут прийти подряд, а
  // повторное добавление надписи недопустимо.
  const commitLabel = useCallback(() => {
    const current = labelRef.current;
    if (!current) return;
    labelRef.current = null;
    setLabel(null);
    const text = current.value.trim();
    if (!text) return;
    onChange([...annotations, { id: newId(), tool: "text", at: current.at, text, color }]);
  }, [annotations, color, onChange]);

  if (!active && annotations.length === 0) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0) return;
    if (tool === "pointer") return;
    const at = toPoint(event);
    if (tool === "text") {
      event.preventDefault();
      commitLabel();
      setLabel({ at, value: "" });
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ id: newId(), tool: tool as ShapeAnnotation["tool"], from: at, to: at, color });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const at = toPoint(event);
    setDraft((current) => (current ? { ...current, to: at } : current));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const at = toPoint(event);
    const done = { ...draft, to: at };
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const dx = Math.abs(done.to.x - done.from.x);
    const dy = Math.abs(done.to.y - done.from.y);
    if (dx < MIN_SIZE && dy < MIN_SIZE) return;
    onChange([...annotations, done]);
  };

  return (
    <div
      ref={containerRef}
      className={`uic-anno-layer${active && tool !== "pointer" ? " is-active" : ""}`}
      style={{ cursor: active && tool !== "pointer" ? "crosshair" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDraft(null)}
    >
      <svg className="uic-anno-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {annotations.map((item) => (
          <Shape key={item.id} item={item} />
        ))}
        {draft && <Shape item={draft} />}
      </svg>
      {label && (
        <textarea
          autoFocus
          className="uic-anno-input"
          style={{ left: label.at.x, top: label.at.y - 12, color }}
          rows={Math.min(6, Math.max(1, label.value.split("\n").length))}
          value={label.value}
          placeholder={labels.annotationTools.text}
          title="Ctrl+Enter — поставить надпись, Esc — отмена"
          onChange={(event) => setLabel({ ...label, value: event.target.value })}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setLabel(null);
              return;
            }
            // Enter переносит строку: надпись может быть многострочной.
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              commitLabel();
            }
          }}
        />
      )}
    </div>
  );
}

function Shape({ item }: { item: Annotation }) {
  const common = {
    stroke: item.color,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  if (item.tool === "text") {
    const lines = item.text.split("\n");
    return (
      <text
        x={item.at.x}
        y={item.at.y}
        fill={item.color}
        stroke="#ffffff"
        strokeWidth={3}
        paintOrder="stroke"
        strokeLinejoin="round"
        fontSize={16}
        fontWeight={600}
      >
        {lines.map((line, index) => (
          <tspan key={index} x={item.at.x} dy={index === 0 ? 0 : 20}>
            {line || " "}
          </tspan>
        ))}
      </text>
    );
  }
  if (item.tool === "underline") {
    return (
      <line
        {...common}
        x1={item.from.x}
        y1={item.from.y}
        x2={item.to.x}
        y2={item.to.y}
        strokeWidth={4}
      />
    );
  }
  if (item.tool === "rect") {
    const x = Math.min(item.from.x, item.to.x);
    const y = Math.min(item.from.y, item.to.y);
    const width = Math.abs(item.to.x - item.from.x);
    const height = Math.abs(item.to.y - item.from.y);
    return (
      <rect
        {...common}
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        strokeWidth={3}
      />
    );
  }
  return (
    <g>
      <line
        {...common}
        x1={item.from.x}
        y1={item.from.y}
        x2={item.to.x}
        y2={item.to.y}
        strokeWidth={3}
      />
      <polygon points={arrowHead(item.from, item.to)} fill={item.color} stroke="none" />
    </g>
  );
}

function arrowHead(from: Point, to: Point, size = 15) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const left = {
    x: to.x - size * Math.cos(angle - 0.42),
    y: to.y - size * Math.sin(angle - 0.42),
  };
  const right = {
    x: to.x - size * Math.cos(angle + 0.42),
    y: to.y - size * Math.sin(angle + 0.42),
  };
  return `${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

let seq = 0;
function newId() {
  seq += 1;
  return `a-${Date.now().toString(36)}-${seq}`;
}

const TOOL_ICONS: Record<AnnotationTool, JSX.Element> = {
  pointer: <path d="M4 3l8 6-3.6.6L10 14l-1.8.7L6 10.2 4 13V3z" />,
  arrow: <><path d="M3 13 13 4" /><path d="M7 4h6v6" /></>,
  underline: <><path d="M3 12h10" /><path d="M5 4h6" /></>,
  rect: <rect x="3" y="4.5" width="10" height="7" rx="1.5" />,
  text: <><path d="M4 4h8" /><path d="M8 4v8" /></>,
};

/** Панель инструментов разметки — рендерится внутри окна замечания. */
export function AnnotationToolbar({
  tool,
  onTool,
  color,
  onColor,
  count,
  onUndo,
  onClear,
}: {
  tool: AnnotationTool;
  onTool: (tool: AnnotationTool) => void;
  color: string;
  onColor: (color: string) => void;
  count: number;
  onUndo: () => void;
  onClear: () => void;
}) {
  const { labels } = useUiCommentsConfig();
  const tools: AnnotationTool[] = ["pointer", "arrow", "underline", "rect", "text"];
  return (
    <div className="uic-anno-toolbar">
      <div className="uic-anno-tools" role="group" aria-label={labels.annotationTitle}>
        {tools.map((value) => (
          <button
            key={value}
            type="button"
            className={`uic-anno-tool${tool === value ? " is-active" : ""}`}
            title={labels.annotationTools[value]}
            aria-label={labels.annotationTools[value]}
            aria-pressed={tool === value}
            onClick={() => onTool(value)}
          >
            <svg viewBox="0 0 16 16">{TOOL_ICONS[value]}</svg>
          </button>
        ))}
      </div>
      <div className="uic-anno-colors">
        {ANNOTATION_COLORS.map((value) => (
          <button
            key={value}
            type="button"
            className={`uic-anno-color${color === value ? " is-active" : ""}`}
            style={{ background: value }}
            title={value}
            aria-label={`Цвет ${value}`}
            onClick={() => onColor(value)}
          />
        ))}
      </div>
      <button
        type="button"
        className="uic-anno-action"
        title="Отменить последнюю фигуру"
        aria-label="Отменить последнюю фигуру"
        onClick={onUndo}
        disabled={count === 0}
      >
        ↶
      </button>
      <button
        type="button"
        className="uic-anno-action"
        title="Очистить разметку"
        aria-label="Очистить разметку"
        onClick={onClear}
        disabled={count === 0}
      >
        ✕
      </button>
    </div>
  );
}
