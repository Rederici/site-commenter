/**
 * OAuth 2.0 Authorization Code + PKCE для YouTrack.
 *
 * Redirect URI — стандартный для Chrome-расширения:
 * https://<extension-id>.chromiumapp.org/
 * Он должен быть прописан в OAuth-клиенте YouTrack.
 */

import { YOUTRACK_CLIENT_ID, YOUTRACK_SCOPE, loadSettings } from "./youtrack-config";

type StoredAuth = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

type StoredPkce = {
  verifier: string;
  state: string;
  redirectUri: string;
};

const AUTH_KEY = "youtrack.auth";
const PKCE_KEY = "youtrack.pkce";

/**
 * Для локального теста конфиденциального клиента. Для публичного клиента с
 * PKCE секрет не нужен; хранить его в расширении не стоит.
 */
const CLIENT_SECRET = "";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function readAuth(): Promise<StoredAuth | null> {
  const data = await chrome.storage.local.get(AUTH_KEY);
  const stored = data[AUTH_KEY];
  if (!stored || typeof stored !== "object") return null;
  const auth = stored as StoredAuth;
  return typeof auth.accessToken === "string" ? auth : null;
}

async function writeAuth(auth: StoredAuth): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: auth });
}

async function requestToken(params: Record<string, string>): Promise<StoredAuth> {
  const settings = await loadSettings();
  const body = new URLSearchParams(params);
  if (CLIENT_SECRET) body.set("client_secret", CLIENT_SECRET);

  const response = await fetch(`${settings.url}/hub/api/rest/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await response.text();
  let payload: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    error?: string;
    error_description?: string;
  } = {};
  try {
    payload = JSON.parse(text);
  } catch {
    // оставим пустой объект, ниже будет понятная ошибка
  }

  if (!response.ok || !payload.access_token) {
    const reason = payload.error_description || payload.error || text.slice(0, 300) || `HTTP ${response.status}`;
    throw new Error(`YouTrack OAuth: ${reason}`);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
  };
}

async function login(): Promise<StoredAuth> {
  const settings = await loadSettings();
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = randomString(48);
  const state = randomString(16);
  const pkce: StoredPkce = { verifier, state, redirectUri };
  await chrome.storage.local.set({ [PKCE_KEY]: pkce });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: YOUTRACK_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: YOUTRACK_SCOPE,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
  });

  const redirectUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: `${settings.url}/hub/api/rest/oauth2/auth?${params.toString()}`, interactive: true },
      (url) => {
        const error = chrome.runtime.lastError;
        if (error || !url) {
          reject(new Error(error?.message || "OAuth-окно закрыто до завершения"));
          return;
        }
        resolve(url);
      }
    );
  });

  const parsed = new URL(redirectUrl);
  const code = parsed.searchParams.get("code");
  const error = parsed.searchParams.get("error_description") || parsed.searchParams.get("error");
  if (!code) throw new Error(error || "YouTrack не вернул код авторизации");

  const stored = await chrome.storage.local.get(PKCE_KEY);
  const expected = stored[PKCE_KEY] as StoredPkce | undefined;
  await chrome.storage.local.remove(PKCE_KEY);
  if (!expected || parsed.searchParams.get("state") !== expected.state) {
    throw new Error("OAuth state не совпал — повторите вход");
  }

  return requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: expected.redirectUri,
    client_id: YOUTRACK_CLIENT_ID,
    code_verifier: expected.verifier,
  });
}

export async function getAccessToken(options: { interactive?: boolean } = {}): Promise<string> {
  const auth = await readAuth();
  if (auth && auth.expiresAt > Date.now() + 60_000) return auth.accessToken;

  if (auth?.refreshToken) {
    try {
      const refreshed = await requestToken({
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
        client_id: YOUTRACK_CLIENT_ID,
      });
      await writeAuth(refreshed);
      return refreshed.accessToken;
    } catch {
      await chrome.storage.local.remove(AUTH_KEY);
    }
  }

  if (options.interactive === false) throw new Error("Требуется вход в YouTrack");

  const next = await login();
  await writeAuth(next);
  return next.accessToken;
}

export async function logout(): Promise<void> {
  await chrome.storage.local.remove([AUTH_KEY, PKCE_KEY]);
}
