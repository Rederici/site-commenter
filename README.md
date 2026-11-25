# Site Commenter

Комментарии по интерфейсу: оператор обводит проблемное место прямо на экране
(стрелка, подчёркивание, обводка, надпись), пишет замечание — и всё вместе со
снимком уходит на сервер. Замечания собираются в реестре со ссылками на экраны.

```
packages/ui-comments/   React-модуль: окно, разметка, снимок, реестр, API-клиент
apps/extension/         расширение Chrome, тонкая обёртка над модулем
apps/demo/              демо-страница с вымышленными данными
server/                 эталонный сервер: HTTP API + таблица (Go, database/sql)
tools/local-dev/        локальный стенд для расширения и витрины компонентов
docs/                   скриншоты
```

Модуль и расширение — один продукт с двумя точками входа: расширение
импортирует `@sitecommenter/ui-comments`, а не копию кода.

![Окно замечания с разметкой](docs/widget.png)
![Реестр замечаний](docs/registry.png)

## Возможности

- Плавающая кнопка «Замечание» со счётчиком открытых замечаний; её можно
  перетащить в любое место экрана — позиция запоминается.
- Разметка поверх экрана: **стрелка, подчёркивание, обводка, надпись**, четыре
  цвета, отмена и очистка; надпись многострочная (`Enter` — перенос,
  `Ctrl+Enter` — поставить).
- Снимок видимой области **вместе с разметкой** (JPEG): во встроенном модуле —
  рендер DOM, в расширении — нативный снимок вкладки.
- Позиции прокрутки панелей сохраняются.
- Отправка текста, снимка и контекста (экран, канал, дата) одним запросом;
  текст может быть пустым, если приложен снимок.
- Реестр (необязательный): фильтры, снимки, статусы «Новое / В работе /
  Исправлено / Отклонено», ответ модератора и ссылка на конкретное замечание
  `/#/comments?comment=<id>` для чата и агента.

## Быстрый старт

```bash
npm install
```

```tsx
import {
  UiCommentsProvider,
  UiCommentsWidget,
  UiCommentsRegistry,
  createUiCommentsApi,
} from "@sitecommenter/ui-comments";
import "@sitecommenter/ui-comments/styles.css";

const api = createUiCommentsApi({ basePath: "/api/v1/ui-comments" });

export function App() {
  return (
    <UiCommentsProvider
      config={{
        api,
        user: currentUser, // { username, name?, role?, isAdmin? }
        context: {
          route: location.pathname,
          routeTitle: screenTitle(location.pathname),
          url: window.location.href,
          channelName: currentChannel?.name,
          date: currentDay,
        },
        captureRoot: "#root",
      }}
    >
      <Routes />
      <UiCommentsWidget />
    </UiCommentsProvider>
  );
}
```

Реестр — отдельным маршрутом: `<UiCommentsRegistry />`.

Подробности — [`packages/ui-comments/README.md`](packages/ui-comments/README.md):
настройки провайдера, контракт API, разметка, темы и ограничения.

## Расширение Chrome

```bash
npm run build:extension     # → apps/extension/dist
```

Затем `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное»
→ выбрать `apps/extension/dist`. Подробности — [`apps/extension/README.md`](apps/extension/README.md).

В расширении снимок делает браузер (`chrome.tabs.captureVisibleTab`), поэтому
в кадр попадают видео, canvas и iframe, а панель замечания на момент съёмки
скрывается. Текущая сборка расширения создаёт задачу в YouTrack (проект `SC`,
тип `Bug`); подробности — [`apps/extension/README.md`](apps/extension/README.md).
Если на странице уже есть встроенный модуль, расширение не ставит второй
виджет (метка `data-ui-comments-inline`).

## Демо

```bash
npm run demo          # http://127.0.0.1:5173
```

Демо-страница с вымышленными данными: замечания хранятся в памяти, сервер не
нужен. Подробности — [`apps/demo/README.md`](apps/demo/README.md).

## Локальный стенд

```bash
npm run start         # http://127.0.0.1:4400
npm run showcase      # собрать витрину компонентов
```

Стенд поднимает страницу-трекер и API в памяти, собирает расширение и патчит
его манифест под `127.0.0.1`. Витрина показывает только компоненты модуля.
Подробности — [`tools/local-dev/README.md`](tools/local-dev/README.md).

## Сервер

Два варианта:

1. **Готовый пакет `server/`** (Go + SQLite) — компилируется в бинарник хоста,
   отдельного сервиса не нужно. Подключение — [`server/README.md`](server/README.md).
2. **Свой бэкенд** — реализуйте пять маршрутов из контракта в
   [`packages/ui-comments/README.md`](packages/ui-comments/README.md)
   (список, создание, статус, удаление, снимок). Клиент не изменится; если
   формат ответа не `{"data": ...}`, реализуйте интерфейс `UiCommentsApi` вручную.

## Требования

- React 18+, браузер с поддержкой `foreignObject` (Chrome, Edge, Firefox;
  Safari — с ограничениями).
- `html-to-image` (MIT) для снимка; грузится динамическим импортом.

## Ограничения

- Снимается видимая область, а не весь документ.
- Разметка привязана к координатам экрана: после прокрутки она останется на
  месте. На время рисования прокрутка блокируется.
- Разметка «запекается» в JPEG; отдельно векторные данные не хранятся.

## Лицензия

MIT — см. [`LICENSE`](LICENSE).
