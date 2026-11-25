# Site Commenter — расширение Chrome

Тонкая обёртка над `@sitecommenter/ui-comments`: content script монтирует окно
замечаний в shadow root страницы, снимок берётся нативный
(`chrome.tabs.captureVisibleTab`), а отправка создаёт задачу в YouTrack.

## Сборка

```bash
npm install
npm run build:extension     # → apps/extension/dist
```

Затем `chrome://extensions` → включить «Режим разработчика» → «Загрузить
распакованное» → выбрать `apps/extension/dist`.

Для локального стенда `npm run start` дополнительно патчит собранный манифест
под `127.0.0.1`/`localhost`.

## Как это работает

- **content script** (`src/content.tsx`) читает маршрут и заголовок страницы,
  монтирует `UiCommentsProvider` + `UiCommentsWidget` в shadow root и
  отправляет замечание в background.
- **service worker** (`src/background.ts`) отдаёт нативный снимок вкладки,
  открывает окно по кнопке на панели Chrome и `Alt+Shift+C`, а также создаёт
  задачу в YouTrack.
- **OAuth** (`src/oauth.ts`) — Authorization Code + PKCE. Access/refresh-токены
  лежат в `chrome.storage.local`. Первый вход запускается при первой отправке.
- **YouTrack** (`src/youtrack.ts`) — находит проект, создаёт задачу, прикладывает
  снимок и открывает её в новой вкладке.
- **разметка** — тот же SVG-слой модуля, поэтому попадает на нативный снимок
  без склейки.

## Текущая конфигурация

Пока это константы в `src/youtrack-config.ts`:

- YouTrack: `https://yt.example.com`
- проект: **Site Commenter (SC)**
- тип задачи: **Bug**
- OAuth client ID: **test-sitecommenter**

В попапе эти значения показываются текстом: «Задача будет создана в проекте
Site Commenter (SC), тип Bug». Позже это заменят настройки расширения.

Чтобы изменить проект или тип, поправьте `DEFAULT_SETTINGS` (или запишите
`youtrack.settings` в `chrome.storage.local`) и пересоберите расширение.

## OAuth

В OAuth-клиенте YouTrack должны быть включены:

- Authorization Code flow;
- Require PKCE;
- Require user consent;
- Redirect URI `https://<extension-id>.chromiumapp.org/`.

ID расширения фиксируется полем `key` в `manifest.json`; при смене ключа
redirect URI нужно обновить в YouTrack. Публикация в Store не требуется.

Client secret для публичного PKCE-клиента не нужен. Если инстанс потребует
секрет, его нельзя безопасно хранить в расширении — понадобится небольшой
backend, который обменивает код на токен.

## Настройка под свой сервис

| Что | Где |
|---|---|
| Домены, на которых работает расширение | `manifest.json` → `content_scripts.matches` |
| YouTrack, проект, тип | `src/youtrack-config.ts` |
| OAuth client ID | `src/youtrack-config.ts` |
| Горячая клавиша | `manifest.json` → `commands` |

`captureVisibleTab` требует `<all_urls>` **или** `activeTab`. В манифесте стоит
`<all_urls>` — так снимок работает из плавающей кнопки. Для минимальных прав
уберите `<all_urls>` и откройте окно кнопкой на панели Chrome или хоткеем.

## Что происходит при отправке

1. Снимок видимой области (с разметкой) и текст уходят в background.
2. Background получает OAuth-токен (при необходимости открывает окно входа).
3. Создаётся задача в проекте `SC`, Type `Bug`, State по умолчанию.
4. Снимок загружается вложением и вставляется в описание.
5. Открывается вкладка с созданной задачей.

Задача создаётся сразу, не черновиком. Если она не нужна — удалите её в
YouTrack.

## Ограничения

- Снимается активная вкладка и только видимая область.
- `captureVisibleTab` ограничен двумя вызовами в секунду.
- Расширение не ставит второй виджет на страницах, где уже есть встроенный
  модуль (метка `data-ui-comments-inline`).
- Настройки проекта/типа пока не редактируются из UI.
