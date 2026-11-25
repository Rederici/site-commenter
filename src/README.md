# Site Commenter — клиент

Самостоятельный React-модуль: плавающее окно с разметкой поверх экрана,
снимок видимой области и отправка замечания на сервер.

Ничего не знает о приложении-хосте: ни о роутере, ни о сессии, ни о стилях.
Всё, что нужно, передаётся через `UiCommentsProvider`.

## Что умеет

- Кнопка «Замечание» в углу экрана со счётчиком открытых замечаний.
- Разметка поверх интерфейса: **стрелка, подчёркивание, обводка, надпись**,
  четыре цвета, отмена последней фигуры и очистка.
- Снимок видимой области **вместе с разметкой** (JPEG), позиции прокрутки
  панелей сохраняются.
- Отправка текста + снимка + контекста экрана на сервер по простому контракту.
- **Текст необязателен, если приложен снимок**: разметка на картинке может
  говорить сама за себя.
- Необязательный реестр: список, фильтры, снимки, статусы и ответы.

## Зависимости

```bash
npm install html-to-image
```

`react` и `react-dom` (18+) у хоста уже есть. `html-to-image` грузится
динамическим импортом только в момент сохранения со снимком.

## Установка

1. Скопируйте каталог `uicomments/` в `src/` проекта.
2. Импортируйте стили один раз:
   ```ts
   import "./uicomments/styles.css";
   ```
3. Оберните приложение провайдером и поставьте окно:

```tsx
import {
  UiCommentsProvider,
  UiCommentsWidget,
  UiCommentsRegistry,
  createUiCommentsApi,
} from "./uicomments";
import "./uicomments/styles.css";

const api = createUiCommentsApi({ basePath: "/api/v1/ui-comments" });

export function App() {
  return (
    <UiCommentsProvider
      config={{
        api,
        user: currentUser,              // { username, name?, role?, isAdmin? }
        context: {                      // пересчитывается при навигации
          route: location.pathname,
          routeTitle: "Планировщик",
          url: window.location.href,
          channelName: "Канал 1",
          date: "2026-11-23",
        },
        captureRoot: "#root",           // что попадает на снимок
        registryHref: "#/comments",
      }}
    >
      <Router />
      <UiCommentsWidget />
    </UiCommentsProvider>
  );
}
```

Реестр — отдельный маршрут:

```tsx
<Route path="/comments" element={<UiCommentsRegistry />} />
```

## Настройки `UiCommentsProvider`

| Поле | Обязательно | По умолчанию | Назначение |
|---|---|---|---|
| `api` | да | — | реализация `UiCommentsApi`; готовый клиент — `createUiCommentsApi` |
| `user` | да | — | кто пишет; `isAdmin` открывает статусы и удаление |
| `context` | да | — | путь экрана, заголовок, адрес, канал/дата |
| `captureRoot` | нет | `body` | селектор корня, который попадает на снимок |
| `annotations` | нет | `true` | включить разметку |
| `enabled` | нет | `true` | показывать окно (например, скрыть в демо-режиме) |
| `storageKey` | нет | `ui-comments` | префикс ключей `localStorage` |
| `registryHref` | нет | `#/comments` | ссылка «Все замечания» |
| `screenHref` | нет | сохранённый URL | ссылка из реестра на экран |
| `labels` | нет | русские | переопределение подписей |
| `onSent` | нет | — | колбэк после успешной отправки (тост хоста) |

## Контракт API

Обязателен только `create`. Остальное нужно реестру; если методов нет,
реестр покажет список без управления.

```ts
type UiCommentsApi = {
  create(input: UiCommentInput): Promise<UiComment>;
  list(filter?: UiCommentFilter, signal?: AbortSignal): Promise<UiComment[]>;
  update?(id: string, patch: { status?: UiCommentStatus; resolution?: string }): Promise<UiComment>;
  remove?(id: string): Promise<unknown>;
  screenshotUrl?(id: string): string;
};
```

`createUiCommentsApi({ basePath })` — готовая реализация для сервера,
который отвечает в конверте `{"data": ...}` и принимает:

```
GET    {base}?status=&route=&channel=&date=&q=  → { data: UiComment[] }
POST   {base}                                    → { data: UiComment }
PATCH  {base}/{id}   {status?, resolution?}      → { data: UiComment }
DELETE {base}/{id}                               → { data: {...} }
GET    {base}/{id}/screenshot                    → image/jpeg
```

Полное описание полей и требований к серверу — в разделе «Сервер» ниже.
Готовый вариант — пакет `server/` (Go + SQLite), его README лежит рядом.

## Сервер: контракт

Клиенту нужны пять маршрутов под общим префиксом (по умолчанию
`/api/v1/ui-comments`):

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| `GET` | `{base}?status=&route=&channel=&date=&q=` | — | `{data: Comment[]}` |
| `POST` | `{base}` | `CommentInput` | `201 {data: Comment}` |
| `PATCH` | `{base}/{id}` | `{status?, resolution?}` | `{data: Comment}` |
| `DELETE` | `{base}/{id}` | — | `{data: {ok: true}}` |
| `GET` | `{base}/{id}/screenshot` | — | `image/jpeg` |

`CommentInput`:

```json
{
  "text": "Кнопка уезжает за границу",
  "route": "/planner",
  "routeTitle": "Планировщик",
  "url": "https://example.com/#/planner",
  "channelName": "Канал 1",
  "date": "2026-11-23",
  "viewportWidth": 1600,
  "viewportHeight": 900,
  "screenshot": "data:image/jpeg;base64,…"
}
```

Требования:

1. **Снимок.** Принять data URL, проверить сигнатуру (JPEG/PNG/WebP) и размер
   (по умолчанию 6 МиБ), хранить как BLOB или файл. Список не должен тянуть
   картинки — только флаг `hasScreenshot`.
2. **Статусы.** `new`, `in_work`, `fixed`, `rejected`; при `fixed`/`rejected`
   сервер заполняет `resolvedBy`/`resolvedAt`.
3. **Права.** Создание и чтение — любая аутентифицированная роль; `PATCH` и
   `DELETE` — только модератор, проверка на сервере.
4. **Валидация.** Текст до 4000 символов, путь экрана начинается с `/`,
   `resolution` до 8000, тело запроса ограничено. Текст необязателен, если
   приложен снимок; без текста и без снимка — `400`.
5. **Формат ответа.** Либо конверт `{"data": ...}` (его ждёт
   `createUiCommentsApi`), либо свой — тогда реализуйте `UiCommentsApi` вручную.


## Разметка

- Инструмент выбирается в окне: указатель, стрелка, подчёркивание, обводка,
  надпись. Надпись ставится кликом и подтверждается `Ctrl+Enter`; `Enter`
  переносит строку, поэтому надпись может быть многострочной.
- Пока выбран инструмент, слой перехватывает мышь и колесо: содержимое под
  разметкой не уезжает. `Esc` возвращает указатель.
- Разметка — SVG поверх экрана, она попадает в снимок как часть DOM. Отдельно
  хранить её не нужно: она уже на картинке.
- Панель окна помечена `data-ui-comment-skip` и на снимок не попадает.
- Если браузер не смог построить снимок, замечание уходит без картинки, а в
  окне появляется предупреждение.

## Темы и стили

Все классы с префиксом `uic-`. Токены берутся из переменных хоста, если они
есть (`--panel`, `--border`, `--text`, `--accent`, `--danger`, `--warn`,
`--ok`, `--font`, `--mono`, `--r-lg`, `--shadow-lg`), иначе используются
нейтральные значения. Переопределить можно на `.uic-root`, `.uic-page` или
`:root`:

```css
:root {
  --uic-accent: #0f766e;
  --uic-radius: 8px;
}
```

## Ограничения

- Снимается видимая область, а не весь документ.
- Снимок делает браузер оператора (`foreignObject`), поэтому экзотические
  CSS-фильтры и внешние ресурсы могут отрисоваться иначе.
- Разметка привязана к координатам экрана: после прокрутки она останется на
  месте. Поэтому на время рисования прокрутка блокируется.
