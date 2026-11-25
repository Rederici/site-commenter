/**
 * Витрина именно компонентов библиотеки, без демо-приложения.
 *
 * Здесь нет фейкового портала: только два компонента из src/
 * (UiCommentsWidget и UiCommentsRegistry) и нейтральная страница-мишень,
 * чтобы было что обводить. API — локальный стенд по реальному контракту.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  UiCommentsProvider,
  UiCommentsWidget,
  UiCommentsRegistry,
  createUiCommentsApi,
  type UiCommentsContext,
  type UiCommentsUser,
} from "../../src";
import "../../src/styles.css";
import "./styles.css";

const api = createUiCommentsApi({ basePath: "/api/v1/ui-comments" });

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || "#/page");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/page");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function App() {
  const [user, setUser] = useState<UiCommentsUser | null>(null);
  const [error, setError] = useState("");
  const hash = useHashRoute();
  const registry = hash.startsWith("#/registry");

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/auth/me", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((payload: { data?: { user?: Record<string, unknown> } }) => {
        if (!alive) return;
        const value = payload?.data?.user;
        setUser({
          username: String(value?.username || "tester"),
          name: String(value?.full_name || value?.username || "Тестировщик"),
          role: String(value?.role_name || "Тестировщик"),
          // На стенде показываем админские контролы реестра.
          isAdmin: true,
        });
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  const context = useMemo<UiCommentsContext>(
    () => ({
      route: registry ? "/registry" : "/page",
      routeTitle: registry ? "Реестр замечаний" : "Страница для замечаний",
      url: window.location.href,
      channelName: "Стенд",
      date: "2026-11-24",
      dateLabel: "24.11.2026",
    }),
    [registry]
  );

  if (error) return <div className="sc-boot">Не удалось получить пользователя: {error}</div>;
  if (!user) return <div className="sc-boot">Загружаем пользователя…</div>;

  return (
    <UiCommentsProvider
      config={{
        api,
        user,
        context,
        registryHref: "#/registry",
        commentHref: (comment) => `#/registry?comment=${encodeURIComponent(comment.id)}`,
      }}
    >
      <div className="sc-shell">
        <header className="sc-top">
          <div className="sc-brand">
            <span className="sc-mark">SC</span>
            <div>
              <strong>Site Commenter</strong>
              <small>только компоненты библиотеки</small>
            </div>
          </div>
          <nav className="sc-tabs">
            <a className={registry ? "" : "is-active"} href="#/page">
              Popup
            </a>
            <a className={registry ? "is-active" : ""} href="#/registry">
              Реестр
            </a>
          </nav>
          <div className="sc-user">
            {user.name} · {user.role} · админ
          </div>
        </header>

        <main className="sc-main">
          {registry ? <UiCommentsRegistry /> : <TargetPage />}
        </main>

        <UiCommentsWidget />
      </div>
    </UiCommentsProvider>
  );
}

function TargetPage() {
  return (
    <div className="sc-page">
      <div className="sc-note">
        Это не демо-приложение. На странице только два компонента из <code>src/</code>: popup
        «Замечание» и реестр. Сама страница — нейтральная мишень, чтобы было что обводить.
      </div>

      <div className="sc-page-head">
        <div>
          <h1>Страница для замечаний</h1>
          <p>Нажмите «Замечание» справа внизу, обведите любой элемент и отправьте.</p>
        </div>
        <button className="sc-btn">Сохранить</button>
      </div>

      <div className="sc-grid">
        <section className="sc-card">
          <h2>Карточка</h2>
          <p className="sc-muted">Произвольный интерфейс, к которому можно оставить замечание.</p>
          <label className="sc-field">
            <span>Название</span>
            <input defaultValue="Демонстрационный блок" />
          </label>
          <label className="sc-field">
            <span>Описание</span>
            <textarea rows={3} defaultValue="Сюда можно что-нибудь написать." />
          </label>
          <div className="sc-actions">
            <button className="sc-btn">Применить</button>
            <button className="sc-btn sc-btn-ghost">Отмена</button>
          </div>
        </section>

        <section className="sc-card">
          <h2>Таблица</h2>
          <table className="sc-table">
            <thead>
              <tr>
                <th>Элемент</th>
                <th>Статус</th>
                <th>Значение</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Первый элемент</td>
                <td><span className="sc-chip">Активен</span></td>
                <td>128</td>
              </tr>
              <tr>
                <td>Второй элемент</td>
                <td><span className="sc-chip sc-chip-warn">В очереди</span></td>
                <td>64</td>
              </tr>
              <tr>
                <td>Третий элемент</td>
                <td><span className="sc-chip sc-chip-muted">Выключен</span></td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className="sc-card">
        <h2>Текст</h2>
        <p>
          Этот блок существует только как поверхность для аннотации. В реальном проекте на его
          месте была бы страница оператора, отчёта или любая другая.
        </p>
        <p className="sc-muted">
          Ограничение инструмента: снимается видимая область, прокрутка на время рисования блокируется,
          разметка запекается в картинку.
        </p>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
