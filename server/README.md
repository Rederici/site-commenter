# Site Commenter — сервер (Go)

Необязательная **эталонная** реализация контракта для проектов на Go +
SQLite. Это библиотека, а не отдельный сервис: она компилируется в бинарник
хоста и работает в его процессе, на его порту и в его базе.

Если бэкенд на другом стеке — пакет не нужен, достаточно реализовать контракт
из README клиента (`src/README.md`).

## Подключение

```go
import "uicomments"

comments, err := uicomments.New(ctx, db, uicomments.Options{
    Authorize: func(r *http.Request) (uicomments.User, bool) {
        u, err := mySession(r)          // сессия приложения
        if err != nil {
            return uicomments.User{}, false
        }
        return uicomments.User{
            Username: u.Login,
            Name:     u.DisplayName,
            Role:     u.RoleTitle,
            Admin:    u.CanEditComments, // статус, ответ и удаление
        }, true
    },
})
if err != nil {
    return err
}

mux.Handle("/api/v1/ui-comments", comments.Handler())
mux.Handle("/api/v1/ui-comments/", comments.Handler())
```

Второй `Handle` с косой чертой обязателен: он ловит `/api/v1/ui-comments/{id}`
и `/screenshot`.

Схема создаётся сама (`CREATE TABLE IF NOT EXISTS`). Если в проекте есть
свои миграции, вызовите `uicomments.EnsureSchema(ctx, db)` из миграции — это
то же самое и безопасно повторно.

## Настройки

| Поле | По умолчанию | Назначение |
|---|---|---|
| `BasePath` | `/api/v1/ui-comments` | путь монтирования; должен совпадать с `mux.Handle` |
| `Authorize` | обязателен | достаёт пользователя из запроса; `false` → 401 |
| `MaxScreenshotBytes` | 6 МиБ | предел снимка после декодирования |
| `MaxBodyBytes` | 9 МиБ | предел тела запроса на создание |
| `ListLimit` | 500 | максимум записей в списке |
| `RawResponse` | `false` | отключить конверт `{"data": ...}` |
| `Logger` | `log.Default()` | журнал внутренних ошибок |
| `Now` | `time.Now` | источник времени для тестов |

## Что отдаёт API

```
GET    {base}?status=&route=&channel=&date=&q=  → {"data": [Comment]}
POST   {base}                                    → 201 {"data": Comment}
PATCH  {base}/{id}   {"status"?,"resolution"?}   → {"data": Comment}
DELETE {base}/{id}                               → {"data":{"ok":true}}
GET    {base}/{id}/screenshot                    → image/jpeg|png|webp
```

Поля `Comment`: `id`, `author`, `authorUsername`, `role`, `text`, `status`,
`route`, `routeTitle`, `url`, `channelId`, `channelName`, `date`,
`viewportWidth`, `viewportHeight`, `hasScreenshot`, `screenshotType`,
`resolution`, `resolvedBy`, `resolvedAt`, `createdAt`, `updatedAt`.

Ошибки — `{"error":{"code","message","details"}}`. Без сессии — `401`,
`PATCH`/`DELETE` без `Admin` — `403`.

Текст необязателен, если приложен снимок: пустой `text` с `screenshot`
принимается. Без текста и без снимка — `400 validation_failed`.

Статусы: `new`, `in_work`, `fixed`, `rejected`. Список отдаётся без BLOB
снимка — только `hasScreenshot`; картинка отдельным запросом.

## Схема

Таблица `ui_comments` (миграция создаёт её сама):

- `id TEXT PRIMARY KEY`, `text`, `status`, `route`, `route_title`, `url`,
  `channel_id`, `channel_name`, `screen_date`;
- `author`, `author_username`, `role`;
- `screenshot BLOB`, `screenshot_type`;
- `resolution`, `resolved_by`, `resolved_at`;
- `created_at`, `updated_at`, `viewport_w`, `viewport_h`.

Индексы: `created_at`, `status`, `route`.

## Тесты

```bash
go test ./uicomments/...
```

Тесты поднимают модуль на голом `net/http` без приложения вокруг — это и есть
проверка переносимости: авторизация подменяется заголовками, база — временным
файлом SQLite.
