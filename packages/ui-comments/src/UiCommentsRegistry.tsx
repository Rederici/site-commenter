import { useEffect, useMemo, useState } from "react";
import type { UiComment, UiCommentStatus } from "./types";
import { STATUS_ORDER, useUiCommentsConfig } from "./config";
import { useCommentsList } from "./useCommentsList";
import { notifyUiCommentsChanged, openUiCommentsWindow } from "./events";

/**
 * Реестр замечаний: сводка, фильтры, снимки и ответы.
 * Компонент самостоятельный — все стили в `styles.css` модуля.
 */
export function UiCommentsRegistry() {
  const { api, labels, user } = useUiCommentsConfig();
  const library = useCommentsList(api, {}, "ui-comments:registry");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("Все");
  const [screen, setScreen] = useState("Все");
  const [targetId, setTargetId] = useState("");

  // Ссылка вида #/comments?comment=<id> открывает карточку и подсвечивает её.
  // Слушаем hashchange: переход по ссылке с того же экрана не перемонтирует
  // компонент, поэтому одного эффекта на монтирование мало.
  useEffect(() => {
    const read = () => {
      const fromHash = new URLSearchParams(window.location.hash.split("?")[1] || "").get("comment");
      const fromSearch = new URLSearchParams(window.location.search).get("comment");
      setTargetId((fromHash || fromSearch || "").trim());
    };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);

  useEffect(() => {
    if (!targetId || library.loading) return;
    const node = document.querySelector(`[data-comment-id="${CSS.escape(targetId)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetId, library.loading, library.data.length]);

  const screens = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of library.data) {
      if (!item.route || seen.has(item.route)) continue;
      seen.set(item.route, item.routeTitle || item.route);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [library.data]);

  const summary = useMemo(() => {
    const count = (value: UiCommentStatus) => library.data.filter((item) => item.status === value).length;
    return {
      total: library.data.length,
      new: count("new"),
      inWork: count("in_work"),
      fixed: count("fixed"),
      rejected: count("rejected"),
      shots: library.data.filter((item) => item.hasScreenshot).length,
    };
  }, [library.data]);

  const rows = useMemo(
    () =>
      library.data.filter((item) => {
        if (status !== "Все" && item.status !== status) return false;
        if (screen !== "Все" && item.route !== screen) return false;
        if (q) {
          const haystack =
            `${item.text} ${item.author} ${item.routeTitle} ${item.channelName} ${item.resolution}`.toLowerCase();
          if (!haystack.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [library.data, status, screen, q]
  );

  return (
    <section className="uic-page">
      <header className="uic-page-head">
        <div>
          <div className="uic-breadcrumbs">Комментарии по интерфейсу</div>
          <h1 className="uic-page-title">
            {labels.registryTitle} <span className="uic-muted">· {labels.registrySubtitle}</span>
          </h1>
        </div>
        <div className="uic-page-actions">
          <button className="uic-btn" onClick={library.reload} disabled={library.loading}>
            {library.loading ? "Обновляем…" : "Обновить"}
          </button>
          <button className="uic-btn uic-btn-primary" onClick={openUiCommentsWindow}>
            Оставить замечание
          </button>
        </div>
      </header>

      <div className="uic-summary">
        <SummaryCard label="Всего" value={summary.total} />
        <SummaryCard label={labels.statuses.new} value={summary.new} tone="warn" />
        <SummaryCard label={labels.statuses.in_work} value={summary.inWork} tone="accent" />
        <SummaryCard label={labels.statuses.fixed} value={summary.fixed} tone="ok" />
        <SummaryCard label={labels.statuses.rejected} value={summary.rejected} tone="muted" />
        <SummaryCard label="Со снимком" value={summary.shots} />
      </div>

      <div className="uic-toolbar">
        <div className="uic-search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Поиск по тексту, автору, экрану"
          />
        </div>
        <label className="uic-field">
          <span>Статус</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>Все</option>
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {labels.statuses[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="uic-field">
          <span>Экран</span>
          <select value={screen} onChange={(event) => setScreen(event.target.value)}>
            <option>Все</option>
            {screens.map(([route, title]) => (
              <option key={route} value={route}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <span className="uic-toolbar-info">Найдено: {rows.length}</span>
      </div>

      <div className="uic-registry-scroll">
        <div className="uic-cards">
          {rows.map((item) => (
            <CommentCard
              key={item.id}
              item={item}
              onChanged={library.reload}
              canEdit={!!user.isAdmin}
              highlighted={item.id === targetId}
            />
          ))}
          {rows.length === 0 && (
            <div className="uic-empty">
              {library.loading
                ? "Загружаем замечания…"
                : library.error || (library.data.length === 0 ? labels.emptyRegistry : "По фильтрам ничего не найдено.")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "warn" | "accent" | "ok" | "muted" }) {
  return (
    <div className={`uic-summary-card${tone ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const formatStamp = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDate = (value: string) => {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
};

function CommentCard({
  item,
  onChanged,
  canEdit,
  highlighted,
}: {
  item: UiComment;
  onChanged: () => void;
  canEdit: boolean;
  highlighted?: boolean;
}) {
  const { api, labels, screenHref, commentHref } = useUiCommentsConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusDraft, setStatusDraft] = useState<UiCommentStatus>(item.status);
  const [resolution, setResolution] = useState(item.resolution || "");
  const [copied, setCopied] = useState(false);
  const shot = item.hasScreenshot && api.screenshotUrl ? api.screenshotUrl(item.id) : "";

  const copyLink = async () => {
    const url = new URL(commentHref(item), window.location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Скопируйте ссылку", url);
    }
  };

  const save = async () => {
    if (busy || !api.update) return;
    setBusy(true);
    setError("");
    try {
      await api.update(item.id, { status: statusDraft, resolution });
      onChanged();
      notifyUiCommentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить замечание");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !api.remove) return;
    if (!window.confirm("Удалить замечание безвозвратно?")) return;
    setBusy(true);
    setError("");
    try {
      await api.remove(item.id);
      onChanged();
      notifyUiCommentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить замечание");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`uic-card is-${item.status}${highlighted ? " is-target" : ""}`}
      data-comment-id={item.id}
    >
      <div className="uic-card-head">
        <span className={`uic-status is-${item.status}`}>{labels.statuses[item.status] || item.status}</span>
        <span className="uic-author">{item.author || item.authorUsername || "Пользователь"}</span>
        {item.role && <span className="uic-muted uic-small">{item.role}</span>}
        <span className="uic-muted uic-small">{formatStamp(item.createdAt)}</span>
        <span className="uic-grow" />
        <a className="uic-link" href={screenHref(item)} title="Открыть экран с этим замечанием">
          {item.routeTitle || item.route || "Экран"}
        </a>
        <span className="uic-mono uic-muted uic-small">{item.id}</span>
        <button
          type="button"
          className="uic-card-link"
          onClick={() => void copyLink()}
          title="Ссылка на замечание — для чата и агента"
        >
          {copied ? "Скопировано" : "Ссылка"}
        </button>
      </div>

      <div className={`uic-card-text${item.text ? "" : " uic-muted"}`}>
        {item.text || labels.noText}
      </div>

      <div className="uic-card-meta">
        {item.channelName && <span className="uic-tag">{item.channelName}</span>}
        {item.date && <span className="uic-tag uic-mono">{formatDate(item.date)}</span>}
        {item.route && <span className="uic-tag uic-mono">{item.route}</span>}
        {item.viewportWidth > 0 && (
          <span className="uic-muted uic-small">
            {item.viewportWidth}×{item.viewportHeight}
          </span>
        )}
      </div>

      {shot && (
        <figure className="uic-shot">
          <a href={shot} target="_blank" rel="noreferrer" title="Открыть снимок в полном размере">
            <img src={shot} alt={`Снимок экрана ${item.routeTitle || item.route}`} decoding="async" />
          </a>
        </figure>
      )}

      {item.resolution && (
        <div className="uic-resolution">
          <strong>Ответ{item.resolvedBy ? ` · ${item.resolvedBy}` : ""}</strong>
          <div>{item.resolution}</div>
        </div>
      )}
      {item.resolvedAt && <div className="uic-muted uic-small">Закрыто: {formatStamp(item.resolvedAt)}</div>}

      {canEdit && api.update && (
        <details className="uic-admin">
          <summary>Статус и ответ</summary>
          <div className="uic-admin-body">
            <label className="uic-field">
              <span>Статус</span>
              <select
                value={statusDraft}
                onChange={(event) => setStatusDraft(event.target.value as UiCommentStatus)}
              >
                {STATUS_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {labels.statuses[value]}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              className="uic-input uic-textarea"
              rows={3}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="Что сделали или почему отклонили — текст увидят операторы"
            />
            <div className="uic-admin-actions">
              {error && <span className="uic-error">{error}</span>}
              <span className="uic-grow" />
              {api.remove && (
                <button className="uic-btn" onClick={() => void remove()} disabled={busy}>
                  Удалить
                </button>
              )}
              <button className="uic-btn uic-btn-primary" onClick={() => void save()} disabled={busy}>
                {busy ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </div>
        </details>
      )}
    </article>
  );
}
