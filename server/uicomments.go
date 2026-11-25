// Package uicomments — эталонная серверная часть модуля замечаний по
// интерфейсу: таблица, HTTP API и снимки экрана.
//
// Пакет самостоятельный: только стандартная библиотека и database/sql. Он не
// знает ничего о приложении, его сессиях и ролях — хост передаёт открытую
// базу и функцию авторизации. Подходит как готовый вариант интеграции; если
// бэкенд проекта на другом стеке, контракт из README реализуется вручную.
//
// Типовой запуск:
//
//	svc, err := uicomments.New(ctx, db, uicomments.Options{
//	    Authorize: func(r *http.Request) (uicomments.User, bool) { ... },
//	})
//	mux.Handle("/api/v1/ui-comments", svc.Handler())
//	mux.Handle("/api/v1/ui-comments/", svc.Handler())
package uicomments

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultBasePath — путь, под которым модуль обычно подключают.
const DefaultBasePath = "/api/v1/ui-comments"

const (
	defaultMaxScreenshot = 6 << 20
	defaultMaxBody       = 9 << 20
	defaultListLimit     = 500
	maxTextRunes         = 4000
	maxResolutionRunes   = 8000
)

// Статусы замечания — те же строки, что в API и интерфейсе.
var statuses = map[string]bool{
	"new":      true,
	"in_work":  true,
	"fixed":    true,
	"rejected": true,
}

// User — минимум, который модуль знает о человеке. Хост заполняет поля из
// своей сессии; Admin решает, можно ли менять статус и удалять записи.
type User struct {
	Username string
	Name     string
	Role     string
	Admin    bool
}

// Options — настройки сервиса.
type Options struct {
	// BasePath — путь монтирования. По умолчанию DefaultBasePath; должен
	// совпадать с тем, под которым хост вызывает mux.Handle.
	BasePath string
	// Authorize обязателен. ok=false означает «нет входа» → 401.
	Authorize func(*http.Request) (User, bool)
	// MaxScreenshotBytes — предел размера снимка после декодирования.
	MaxScreenshotBytes int
	// MaxBodyBytes — предел тела запроса на создание замечания.
	MaxBodyBytes int
	// ListLimit — сколько записей отдаёт список максимум.
	ListLimit int
	// RawResponse отключает конверт {"data": ...}: ответ отдаётся как есть.
	RawResponse bool
	// Logger — куда писать внутренние ошибки; по умолчанию log.Default().
	Logger *log.Logger
	// Now — источник времени (удобно в тестах).
	Now func() time.Time
}

// Comment — замечание в том виде, в каком его отдаёт API.
type Comment struct {
	ID             string `json:"id"`
	Author         string `json:"author"`
	AuthorUsername string `json:"authorUsername"`
	Role           string `json:"role"`
	Text           string `json:"text"`
	Status         string `json:"status"`
	Route          string `json:"route"`
	RouteTitle     string `json:"routeTitle"`
	URL            string `json:"url"`
	ChannelID      string `json:"channelId"`
	ChannelName    string `json:"channelName"`
	Date           string `json:"date"`
	ViewportWidth  int    `json:"viewportWidth"`
	ViewportHeight int    `json:"viewportHeight"`
	HasScreenshot  bool   `json:"hasScreenshot"`
	ScreenshotType string `json:"screenshotType,omitempty"`
	Resolution     string `json:"resolution"`
	ResolvedBy     string `json:"resolvedBy"`
	ResolvedAt     string `json:"resolvedAt"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

// Filter — фильтры списка.
type Filter struct {
	Status  string
	Route   string
	Channel string
	Date    string
	Query   string
	Limit   int
}

// Service — HTTP-обработчик и хранилище замечаний.
type Service struct {
	db   *sql.DB
	opts Options
	mux  *http.ServeMux
}

// New создаёт сервис и гарантирует наличие таблицы. Повторный вызов
// безопасен: схема создаётся через CREATE TABLE IF NOT EXISTS.
func New(ctx context.Context, db *sql.DB, opts Options) (*Service, error) {
	if db == nil {
		return nil, errors.New("uicomments: нужна открытая база")
	}
	if opts.Authorize == nil {
		return nil, errors.New("uicomments: не задан Options.Authorize")
	}
	if opts.BasePath == "" {
		opts.BasePath = DefaultBasePath
	}
	opts.BasePath = "/" + strings.Trim(opts.BasePath, "/")
	if opts.MaxScreenshotBytes <= 0 {
		opts.MaxScreenshotBytes = defaultMaxScreenshot
	}
	if opts.MaxBodyBytes <= 0 {
		opts.MaxBodyBytes = defaultMaxBody
	}
	if opts.ListLimit <= 0 {
		opts.ListLimit = defaultListLimit
	}
	if opts.Logger == nil {
		opts.Logger = log.Default()
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if err := EnsureSchema(ctx, db); err != nil {
		return nil, err
	}
	s := &Service{db: db, opts: opts}
	s.mux = s.routes()
	return s, nil
}

// EnsureSchema создаёт таблицу и индексы. Хост может вызывать её из своей
// миграции, чтобы схема появилась вместе с остальными таблицами.
func EnsureSchema(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS ui_comments (
			id              TEXT PRIMARY KEY,
			author          TEXT NOT NULL DEFAULT '',
			author_username TEXT NOT NULL DEFAULT '',
			role            TEXT NOT NULL DEFAULT '',
			text            TEXT NOT NULL,
			status          TEXT NOT NULL DEFAULT 'new',
			route           TEXT NOT NULL DEFAULT '',
			route_title     TEXT NOT NULL DEFAULT '',
			url             TEXT NOT NULL DEFAULT '',
			channel_id      TEXT NOT NULL DEFAULT '',
			channel_name    TEXT NOT NULL DEFAULT '',
			screen_date     TEXT NOT NULL DEFAULT '',
			viewport_w      INTEGER NOT NULL DEFAULT 0,
			viewport_h      INTEGER NOT NULL DEFAULT 0,
			screenshot      BLOB,
			screenshot_type TEXT NOT NULL DEFAULT '',
			resolution      TEXT NOT NULL DEFAULT '',
			resolved_by     TEXT NOT NULL DEFAULT '',
			resolved_at     TEXT NOT NULL DEFAULT '',
			created_at      TEXT NOT NULL,
			updated_at      TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_ui_comments_created ON ui_comments(created_at);
		CREATE INDEX IF NOT EXISTS idx_ui_comments_status ON ui_comments(status);
		CREATE INDEX IF NOT EXISTS idx_ui_comments_route ON ui_comments(route);
	`)
	return err
}

// Handler возвращает обработчик со всеми маршрутами модуля.
func (s *Service) Handler() http.Handler { return s.mux }

func (s *Service) routes() *http.ServeMux {
	base := s.opts.BasePath
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+base, s.withUser(s.list))
	mux.HandleFunc("POST "+base, s.withUser(s.create))
	mux.HandleFunc("PATCH "+base+"/{id}", s.withUser(s.update))
	mux.HandleFunc("DELETE "+base+"/{id}", s.withUser(s.remove))
	mux.HandleFunc("GET "+base+"/{id}/screenshot", s.withUser(s.screenshot))
	return mux
}

// List читает записи без BLOB снимка — список остаётся лёгким.
func (s *Service) List(ctx context.Context, f Filter) ([]Comment, error) {
	where := []string{"1 = 1"}
	args := []any{}
	if f.Status != "" {
		where = append(where, "status = ?")
		args = append(args, f.Status)
	}
	if f.Route != "" {
		where = append(where, "route = ?")
		args = append(args, f.Route)
	}
	if f.Channel != "" {
		where = append(where, "channel_id = ?")
		args = append(args, f.Channel)
	}
	if f.Date != "" {
		where = append(where, "screen_date = ?")
		args = append(args, f.Date)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		where = append(where, `(text LIKE ? OR author LIKE ? OR route_title LIKE ?
			OR channel_name LIKE ? OR resolution LIKE ?)`)
		like := "%" + q + "%"
		args = append(args, like, like, like, like, like)
	}
	limit := f.Limit
	if limit <= 0 || limit > s.opts.ListLimit {
		limit = s.opts.ListLimit
	}
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, `
		SELECT `+columns+`
		FROM ui_comments
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY created_at DESC, id DESC
		LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Comment{}
	for rows.Next() {
		item, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// Get читает одну запись.
func (s *Service) Get(ctx context.Context, id string) (Comment, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT `+columns+` FROM ui_comments WHERE id = ?`, id)
	return scanComment(row)
}

const columns = `
	id, author, author_username, role, text, status, route, route_title,
	url, channel_id, channel_name, screen_date, viewport_w, viewport_h,
	COALESCE(length(screenshot), 0) > 0, screenshot_type,
	resolution, resolved_by, resolved_at, created_at, updated_at`

func scanComment(row interface{ Scan(...any) error }) (Comment, error) {
	var item Comment
	err := row.Scan(&item.ID, &item.Author, &item.AuthorUsername, &item.Role,
		&item.Text, &item.Status, &item.Route, &item.RouteTitle, &item.URL,
		&item.ChannelID, &item.ChannelName, &item.Date,
		&item.ViewportWidth, &item.ViewportHeight, &item.HasScreenshot,
		&item.ScreenshotType, &item.Resolution, &item.ResolvedBy, &item.ResolvedAt,
		&item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *Service) withUser(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.opts.Authorize(r)
		if !ok {
			s.writeError(w, http.StatusUnauthorized, "unauthorized", "Требуется вход")
			return
		}
		next(w, r, user)
	}
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, _ User) {
	q := r.URL.Query()
	items, err := s.List(r.Context(), Filter{
		Status:  strings.TrimSpace(q.Get("status")),
		Route:   strings.TrimSpace(q.Get("route")),
		Channel: strings.TrimSpace(q.Get("channel")),
		Date:    strings.TrimSpace(q.Get("date")),
		Query:   q.Get("q"),
	})
	if err != nil {
		s.logf("list: %v", err)
		s.writeError(w, http.StatusInternalServerError, "db_error", "Не удалось прочитать замечания")
		return
	}
	s.writeJSON(w, http.StatusOK, items)
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, user User) {
	if !requireJSON(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(s.opts.MaxBodyBytes))

	var body struct {
		Text           string `json:"text"`
		Route          string `json:"route"`
		RouteTitle     string `json:"routeTitle"`
		URL            string `json:"url"`
		ChannelID      string `json:"channelId"`
		ChannelName    string `json:"channelName"`
		Date           string `json:"date"`
		ViewportWidth  int    `json:"viewportWidth"`
		ViewportHeight int    `json:"viewportHeight"`
		Screenshot     string `json:"screenshot"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "Некорректный JSON замечания")
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	if len([]rune(body.Text)) > maxTextRunes {
		s.writeError(w, http.StatusBadRequest, "validation_failed",
			"Замечание слишком длинное (до "+strconv.Itoa(maxTextRunes)+" символов)")
		return
	}
	body.Route = strings.TrimSpace(body.Route)
	if body.Route != "" && !strings.HasPrefix(body.Route, "/") {
		s.writeError(w, http.StatusBadRequest, "validation_failed", "Некорректный путь экрана")
		return
	}

	shot, shotType, err := decodeScreenshot(body.Screenshot, s.opts.MaxScreenshotBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}
	// Текст необязателен, если приложен снимок: разметка на картинке часто
	// говорит больше, чем короткая подпись.
	if body.Text == "" && len(shot) == 0 {
		s.writeError(w, http.StatusBadRequest, "validation_failed",
			"Опишите замечание или приложите снимок экрана")
		return
	}

	author := strings.TrimSpace(user.Name)
	if author == "" {
		author = user.Username
	}
	token, err := randomToken()
	if err != nil {
		s.logf("token: %v", err)
		s.writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось создать замечание")
		return
	}
	now := s.opts.Now().UTC().Format(time.RFC3339)
	item := Comment{
		ID:             "uic-" + token[:10],
		Author:         author,
		AuthorUsername: user.Username,
		Role:           user.Role,
		Text:           body.Text,
		Status:         "new",
		Route:          cutText(body.Route, 200),
		RouteTitle:     cutText(strings.TrimSpace(body.RouteTitle), 160),
		URL:            cutText(strings.TrimSpace(body.URL), 1000),
		ChannelID:      cutText(strings.TrimSpace(body.ChannelID), 120),
		ChannelName:    cutText(strings.TrimSpace(body.ChannelName), 160),
		Date:           cutText(strings.TrimSpace(body.Date), 10),
		ViewportWidth:  clampInt(body.ViewportWidth, 0, 10000),
		ViewportHeight: clampInt(body.ViewportHeight, 0, 10000),
		HasScreenshot:  len(shot) > 0,
		ScreenshotType: shotType,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if _, err := s.db.ExecContext(r.Context(), `
		INSERT INTO ui_comments (id, author, author_username, role, text, status, route,
			route_title, url, channel_id, channel_name, screen_date, viewport_w,
			viewport_h, screenshot, screenshot_type, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.Author, item.AuthorUsername, item.Role, item.Text, item.Route,
		item.RouteTitle, item.URL, item.ChannelID, item.ChannelName, item.Date,
		item.ViewportWidth, item.ViewportHeight, nullableBlob(shot), shotType,
		now, now); err != nil {
		s.logf("create: %v", err)
		s.writeError(w, http.StatusInternalServerError, "db_error", "Не удалось сохранить замечание")
		return
	}
	s.writeJSON(w, http.StatusCreated, item)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, user User) {
	if !user.Admin {
		s.writeError(w, http.StatusForbidden, "forbidden", "Недостаточно прав для изменения замечания")
		return
	}
	if !requireJSON(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)

	var body struct {
		Status     *string `json:"status"`
		Resolution *string `json:"resolution"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "Некорректный запрос")
		return
	}
	if body.Status == nil && body.Resolution == nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "Нечего менять")
		return
	}
	if body.Status != nil && !statuses[strings.TrimSpace(*body.Status)] {
		s.writeError(w, http.StatusBadRequest, "validation_failed", "Неизвестный статус замечания")
		return
	}
	if body.Resolution != nil && len([]rune(*body.Resolution)) > maxResolutionRunes {
		s.writeError(w, http.StatusBadRequest, "validation_failed", "Резолюция слишком длинная")
		return
	}

	id := r.PathValue("id")
	now := s.opts.Now().UTC().Format(time.RFC3339)
	if body.Status != nil {
		status := strings.TrimSpace(*body.Status)
		resolvedBy, resolvedAt := "", ""
		if status == "fixed" || status == "rejected" {
			resolvedBy = strings.TrimSpace(user.Name)
			if resolvedBy == "" {
				resolvedBy = user.Username
			}
			resolvedAt = now
		}
		if _, err := s.db.ExecContext(r.Context(), `
			UPDATE ui_comments
			SET status = ?, resolved_by = ?, resolved_at = ?, updated_at = ?
			WHERE id = ?`, status, resolvedBy, resolvedAt, now, id); err != nil {
			s.logf("update status: %v", err)
			s.writeError(w, http.StatusInternalServerError, "db_error", "Не удалось сохранить статус")
			return
		}
	}
	if body.Resolution != nil {
		if _, err := s.db.ExecContext(r.Context(), `
			UPDATE ui_comments SET resolution = ?, updated_at = ? WHERE id = ?`,
			strings.TrimSpace(*body.Resolution), now, id); err != nil {
			s.logf("update resolution: %v", err)
			s.writeError(w, http.StatusInternalServerError, "db_error", "Не удалось сохранить резолюцию")
			return
		}
	}

	item, err := s.Get(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		s.writeError(w, http.StatusNotFound, "not_found", "Замечание не найдено")
		return
	}
	if err != nil {
		s.logf("get: %v", err)
		s.writeError(w, http.StatusInternalServerError, "db_error", "Не удалось прочитать замечание")
		return
	}
	s.writeJSON(w, http.StatusOK, item)
}

func (s *Service) remove(w http.ResponseWriter, r *http.Request, user User) {
	if !user.Admin {
		s.writeError(w, http.StatusForbidden, "forbidden", "Недостаточно прав для удаления замечания")
		return
	}
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM ui_comments WHERE id = ?`, r.PathValue("id"))
	if err != nil {
		s.logf("delete: %v", err)
		s.writeError(w, http.StatusInternalServerError, "db_error", "Не удалось удалить замечание")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		s.writeError(w, http.StatusNotFound, "not_found", "Замечание не найдено")
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) screenshot(w http.ResponseWriter, r *http.Request, _ User) {
	var data []byte
	var mime string
	err := s.db.QueryRowContext(r.Context(), `
		SELECT screenshot, screenshot_type FROM ui_comments WHERE id = ?`,
		r.PathValue("id")).Scan(&data, &mime)
	if errors.Is(err, sql.ErrNoRows) || len(data) == 0 {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.logf("screenshot: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if mime == "" {
		mime = "image/jpeg"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Снимок неизменяем: id записи уникален, содержимое не переписывается.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = w.Write(data)
}

// decodeScreenshot разбирает data URL снимка и проверяет формат.
func decodeScreenshot(dataURL string, maxBytes int) ([]byte, string, error) {
	value := strings.TrimSpace(dataURL)
	if value == "" {
		return nil, "", nil
	}
	const marker = ";base64,"
	idx := strings.Index(value, marker)
	if !strings.HasPrefix(value, "data:image/") || idx < 0 {
		return nil, "", errors.New("Снимок экрана должен быть PNG, JPEG или WebP")
	}
	declared := strings.TrimPrefix(value[:idx], "data:")
	raw, err := base64.StdEncoding.DecodeString(value[idx+len(marker):])
	if err != nil {
		return nil, "", errors.New("Не удалось прочитать снимок экрана")
	}
	if len(raw) == 0 {
		return nil, "", nil
	}
	if len(raw) > maxBytes {
		return nil, "", errors.New("Снимок экрана больше допустимого размера")
	}
	mime := http.DetectContentType(raw)
	switch mime {
	case "image/jpeg", "image/png", "image/webp":
	default:
		return nil, "", errors.New("Снимок экрана должен быть PNG, JPEG или WebP")
	}
	if !strings.HasPrefix(declared, mime) {
		return nil, "", errors.New("Формат снимка не совпадает с заявленным типом")
	}
	return raw, mime, nil
}

func (s *Service) writeJSON(w http.ResponseWriter, status int, data any) {
	if s.opts.RawResponse {
		writeJSONBody(w, status, data)
		return
	}
	writeJSONBody(w, status, map[string]any{
		"data": data,
		"meta": map[string]any{
			"mode":        "live",
			"generatedAt": s.opts.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Service) writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSONBody(w, status, map[string]any{
		"error": map[string]any{"code": code, "message": message, "details": nil},
	})
}

func (s *Service) logf(format string, args ...any) {
	if s.opts.Logger != nil {
		s.opts.Logger.Printf("ui-comments: "+format, args...)
	}
}

func writeJSONBody(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func requireJSON(w http.ResponseWriter, r *http.Request) bool {
	contentType := r.Header.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(strings.ToLower(contentType), "application/json") {
		writeJSONBody(w, http.StatusUnsupportedMediaType, map[string]any{
			"error": map[string]any{"code": "unsupported_media_type",
				"message": "Ожидается Content-Type: application/json", "details": nil},
		})
		return false
	}
	return true
}

func nullableBlob(data []byte) any {
	if len(data) == 0 {
		return nil
	}
	return data
}

func cutText(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func randomToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	const hexDigits = "0123456789abcdef"
	out := make([]byte, len(buf)*2)
	for i, b := range buf {
		out[i*2] = hexDigits[b>>4]
		out[i*2+1] = hexDigits[b&0x0f]
	}
	return string(out), nil
}
