import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  UiCommentsProvider,
  UiCommentsWidget,
  UiCommentsRegistry,
  type UiComment,
  type UiCommentInput,
  type UiCommentsApi,
  type UiCommentsContext,
} from "../src";
import "../src/styles.css";
import "./styles.css";

/**
 * Демо-страница для документации и скриншотов.
 *
 * Данные вымышленные: «Канал 1», отчёты за условные периоды. API — в памяти,
 * снимки живут в Map, сервер не нужен. Ровно то же самое подключается в
 * реальном приложении, разница только в `create`/`list`.
 */

const store: UiComment[] = [];
const shots = new Map<string, string>();
let seq = 0;

const demoApi: UiCommentsApi = {
  async create(input: UiCommentInput) {
    seq += 1;
    const item: UiComment = {
      id: `demo-${seq}`,
      author: "Демо-пользователь",
      authorUsername: "demo",
      role: "Редактор",
      text: input.text,
      status: "new",
      route: input.route,
      routeTitle: input.routeTitle,
      url: input.url,
      channelId: input.channelId || "",
      channelName: input.channelName || "",
      date: input.date || "",
      viewportWidth: input.viewportWidth || 0,
      viewportHeight: input.viewportHeight || 0,
      hasScreenshot: !!input.screenshot,
      screenshotType: input.screenshot ? "image/jpeg" : "",
      resolution: "",
      resolvedBy: "",
      resolvedAt: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (input.screenshot) shots.set(item.id, input.screenshot);
    store.unshift(item);
    return item;
  },
  async list() {
    return [...store];
  },
  async update(id, patch) {
    const item = store.find((entry) => entry.id === id);
    if (!item) throw new Error("Замечание не найдено");
    if (patch.status) item.status = patch.status;
    if (patch.resolution !== undefined) item.resolution = patch.resolution;
    return item;
  },
  async remove(id) {
    const index = store.findIndex((entry) => entry.id === id);
    if (index >= 0) store.splice(index, 1);
    return { ok: true };
  },
  screenshotUrl(id) {
    return shots.get(id) || "";
  },
};

const REPORTS = [
  { title: "Недельный отчёт", period: "Неделя 47", status: "Готов", size: "48 КБ" },
  { title: "Квартальный отчёт", period: "Q3 2026", status: "Готов", size: "112 КБ" },
  { title: "Годовой отчёт", period: "2026", status: "В очереди", size: "—" },
  { title: "Отчёт по правам", period: "Ноябрь 2026", status: "Готов", size: "76 КБ" },
  { title: "Отчёт по рекламе", period: "Ноябрь 2026", status: "В очереди", size: "—" },
  { title: "Сводка по эфиру", period: "Неделя 47", status: "Готов", size: "54 КБ" },
];

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || "#/reports");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/reports");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function DemoApp() {
  const hash = useHashRoute();
  const registry = hash.startsWith("#/comments");
  const context = useMemo<UiCommentsContext>(
    () => ({
      route: registry ? "/reports" : "/reports",
      routeTitle: "Отчёты",
      url: window.location.href,
      channelName: "Канал 1",
      date: "2026-11-23",
      dateLabel: "23.11.2026",
    }),
    [registry]
  );

  return (
    <UiCommentsProvider
      config={{
        api: demoApi,
        user: { username: "demo", name: "Демо-пользователь", role: "Редактор", isAdmin: true },
        context,
        captureRoot: ".demo-app",
        registryHref: "#/comments",
      }}
    >
      <div className="demo-app">
        <header className="demo-top">
          <span className="demo-mark">SC</span>
          <strong>Демо-портал</strong>
          <span className="demo-version">v1.0.0</span>
          <nav className="demo-tabs">
            <a className={`demo-tab${registry ? "" : " is-active"}`} href="#/reports">Отчёты</a>
            <a className={`demo-tab${registry ? " is-active" : ""}`} href="#/comments">Замечания</a>
          </nav>
        </header>
        <div className="demo-body">
          <aside className="demo-side">
            <h3>Рабочее пространство</h3>
            <a className="is-active" href="#/reports">Отчёты</a>
            <a href="#/reports">Справочники</a>
            <a href="#/reports">Настройки</a>
          </aside>
          <main className="demo-main">
            {registry ? (
              <UiCommentsRegistry />
            ) : (
              <>
                <div className="demo-head">
                  <div>
                    <h1>Отчёты</h1>
                    <p>Канал 1 · 23.11.2026 · вымышленные данные для демонстрации</p>
                  </div>
                </div>
                <div className="demo-scroll">
                  <table className="demo-table">
                    <thead>
                      <tr>
                        <th>Отчёт</th>
                        <th>Период</th>
                        <th>Статус</th>
                        <th>Размер</th>
                      </tr>
                    </thead>
                    <tbody>
                      {REPORTS.map((report) => (
                        <tr key={report.title + report.period}>
                          <td>{report.title}</td>
                          <td>{report.period}</td>
                          <td>
                            <span className={`demo-status${report.status === "Готов" ? "" : " is-wait"}`}>
                              {report.status}
                            </span>
                          </td>
                          <td>{report.size}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="demo-hint">
                    Нажмите «Замечание» в правом нижнем углу, обведите проблемное место и отправьте.
                  </p>
                </div>
              </>
            )}
          </main>
        </div>
        <UiCommentsWidget />
      </div>
    </UiCommentsProvider>
  );
}

createRoot(document.getElementById("root")!).render(<DemoApp />);
