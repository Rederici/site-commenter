package uicomments

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

// 1×1 PNG: минимальный валидный снимок.
const testShotPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// newStandalone поднимает модуль с обычным net/http и без приложения вокруг —
// это и есть проверка переносимости.
func newStandalone(t *testing.T) *httptest.Server {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "comments.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })

	svc, err := New(context.Background(), db, Options{
		Authorize: func(r *http.Request) (User, bool) {
			username := strings.TrimSpace(r.Header.Get("X-Test-User"))
			if username == "" {
				return User{}, false
			}
			return User{
				Username: username,
				Name:     "Пользователь " + username,
				Role:     "Редактор",
				Admin:    r.Header.Get("X-Test-Admin") == "1",
			}, true
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle(DefaultBasePath, svc.Handler())
	mux.Handle(DefaultBasePath+"/", svc.Handler())
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func call(t *testing.T, srv *httptest.Server, method, path, body, user string, admin bool) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	if admin {
		req.Header.Set("X-Test-Admin", "1")
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func decodeComment(t *testing.T, resp *http.Response) Comment {
	t.Helper()
	defer resp.Body.Close()
	var envelope struct {
		Data Comment `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data
}

func TestStandaloneLifecycle(t *testing.T) {
	srv := newStandalone(t)

	create := call(t, srv, http.MethodPost, DefaultBasePath, `{
		"text":"Кнопка уезжает",
		"route":"/planner",
		"routeTitle":"Планировщик",
		"channelName":"Тест",
		"screenshot":"data:image/png;base64,`+testShotPNG+`"
	}`, "operator", false)
	if create.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d", create.StatusCode)
	}
	created := decodeComment(t, create)
	if created.ID == "" || created.Status != "new" || !created.HasScreenshot {
		t.Fatalf("created: %+v", created)
	}
	if created.Author != "Пользователь operator" || created.Role != "Редактор" {
		t.Fatalf("автор и роль: %+v", created)
	}

	list := call(t, srv, http.MethodGet, DefaultBasePath+"?route=/planner", "", "operator", false)
	var listEnvelope struct {
		Data []Comment `json:"data"`
	}
	if err := json.NewDecoder(list.Body).Decode(&listEnvelope); err != nil {
		t.Fatal(err)
	}
	list.Body.Close()
	if len(listEnvelope.Data) != 1 || listEnvelope.Data[0].ID != created.ID {
		t.Fatalf("list: %+v", listEnvelope.Data)
	}

	shot := call(t, srv, http.MethodGet, DefaultBasePath+"/"+created.ID+"/screenshot", "", "operator", false)
	if shot.StatusCode != http.StatusOK || shot.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("screenshot: %d %s", shot.StatusCode, shot.Header.Get("Content-Type"))
	}
	shot.Body.Close()

	// Не администратор не меняет статус.
	denied := call(t, srv, http.MethodPatch, DefaultBasePath+"/"+created.ID, `{"status":"fixed"}`, "operator", false)
	denied.Body.Close()
	if denied.StatusCode != http.StatusForbidden {
		t.Fatalf("patch without admin: %d", denied.StatusCode)
	}

	patched := call(t, srv, http.MethodPatch, DefaultBasePath+"/"+created.ID,
		`{"status":"fixed","resolution":"Поправили"}`, "admin", true)
	if patched.StatusCode != http.StatusOK {
		t.Fatalf("patch: %d", patched.StatusCode)
	}
	updated := decodeComment(t, patched)
	if updated.Status != "fixed" || updated.ResolvedBy == "" || updated.Resolution != "Поправили" {
		t.Fatalf("updated: %+v", updated)
	}

	deleted := call(t, srv, http.MethodDelete, DefaultBasePath+"/"+created.ID, "", "admin", true)
	deleted.Body.Close()
	if deleted.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d", deleted.StatusCode)
	}
}

func TestScreenshotOnlyComment(t *testing.T) {
	srv := newStandalone(t)

	// Текст необязателен, если есть снимок: разметка на картинке самодостаточна.
	resp := call(t, srv, http.MethodPost, DefaultBasePath,
		`{"text":"","route":"/planner","screenshot":"data:image/png;base64,`+testShotPNG+`"}`, "op", false)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("замечание только со снимком: %d", resp.StatusCode)
	}
	item := decodeComment(t, resp)
	if item.Text != "" || !item.HasScreenshot {
		t.Fatalf("created: %+v", item)
	}

	// Без текста и без снимка — по-прежнему ошибка.
	empty := call(t, srv, http.MethodPost, DefaultBasePath, `{"text":""}`, "op", false)
	empty.Body.Close()
	if empty.StatusCode != http.StatusBadRequest {
		t.Fatalf("пустое замечание: %d", empty.StatusCode)
	}
}

func TestStandaloneAuthAndValidation(t *testing.T) {
	srv := newStandalone(t)

	unauthorized := call(t, srv, http.MethodGet, DefaultBasePath, "", "", false)
	unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("без пользователя: %d", unauthorized.StatusCode)
	}

	cases := []string{
		`{"text":"  "}`,
		`{"text":"x","screenshot":"data:image/png;base64,bm90IGltYWdl"}`,
		`{"text":"x","route":"planner"}`,
	}
	for _, body := range cases {
		resp := call(t, srv, http.MethodPost, DefaultBasePath, body, "op", false)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: %d", body, resp.StatusCode)
		}
	}
}

// RawResponse отдаёт payload без конверта — так модуль подключается к
// проекту со своим форматом ответа.
func TestRawResponse(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "raw.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	svc, err := New(context.Background(), db, Options{
		RawResponse: true,
		Authorize: func(*http.Request) (User, bool) {
			return User{Username: "op", Admin: true}, true
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	svc.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, DefaultBasePath, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d", rec.Code)
	}
	var items []Comment
	if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
		t.Fatalf("raw body: %s", rec.Body.String())
	}
	if len(items) != 0 {
		t.Fatalf("items: %+v", items)
	}
}
