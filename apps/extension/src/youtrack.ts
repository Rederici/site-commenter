import type { UiCommentInput } from "@sitecommenter/ui-comments";
import { getAccessToken } from "./oauth";
import { loadSettings, type YouTrackSettings } from "./youtrack-config";

type Project = { id: string; name?: string; shortName?: string };
type ProjectField = { id: string; field?: { name?: string } };
type Issue = { id: string; idReadable?: string };

async function request<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const detail = typeof payload === "string" ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 300);
    throw new Error(`YouTrack ${response.status}: ${detail}`);
  }
  return payload as T;
}

function pickProject(items: Project[], settings: YouTrackSettings): Project | undefined {
  return items.find((item) => item.shortName === settings.projectShortName);
}

async function findProject(token: string, settings: YouTrackSettings): Promise<Project> {
  try {
    const items = await request<Project[]>(
      token,
      `${settings.url}/api/admin/projects?fields=id,name,shortName&$top=200`
    );
    const found = pickProject(items, settings);
    if (found) return found;
  } catch {
    // Не админ — ниже попробуем обычный список проектов.
  }

  const items = await request<Project[]>(token, `${settings.url}/api/projects?fields=id,name,shortName&$top=200`);
  const found = pickProject(items, settings);
  if (!found) {
    const available = items.map((item) => item.shortName || item.id).join(", ");
    throw new Error(`Проект ${settings.projectShortName} не найден. Доступны: ${available || "нет"}`);
  }
  return found;
}

async function findTypeField(token: string, settings: YouTrackSettings, projectId: string): Promise<ProjectField> {
  const fields = await request<ProjectField[]>(
    token,
    `${settings.url}/api/admin/projects/${encodeURIComponent(projectId)}/customFields?fields=id,field(name)`
  );
  const type = fields.find((field) => field.field?.name === "Type");
  if (!type) throw new Error(`В проекте ${settings.projectShortName} нет поля Type`);
  return type;
}

function buildSummary(input: UiCommentInput): string {
  const firstLine = input.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || `Замечание по интерфейсу: ${input.routeTitle || input.route || "экран"}`).slice(0, 200);
}

function buildDescription(input: UiCommentInput): string {
  const context = [
    input.routeTitle || input.route
      ? `Экран: ${input.routeTitle || ""}${input.route ? ` (${input.route})` : ""}`
      : "",
    input.url ? `URL: ${input.url}` : "",
    input.channelName ? `Канал: ${input.channelName}` : "",
    input.date ? `Дата: ${input.date}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [input.text.trim(), context ? `---\n${context}` : ""].filter(Boolean).join("\n\n");
}

function parseScreenshot(dataUrl: string): { blob: Blob; name: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Некорректный формат снимка");

  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  const type = match[1].toLowerCase();
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return { blob: new Blob([bytes], { type }), name: `screenshot.${extension}` };
}

export type CreatedTask = {
  id: string;
  idReadable: string;
  url: string;
};

export async function createTask(input: UiCommentInput): Promise<CreatedTask> {
  const settings = await loadSettings();
  const token = await getAccessToken();
  const project = await findProject(token, settings);
  const typeField = await findTypeField(token, settings, project.id);

  const summary = buildSummary(input);
  const description = buildDescription(input);

  const issue = await request<Issue>(token, `${settings.url}/api/issues?fields=id,idReadable`, {
    method: "POST",
    body: JSON.stringify({
      project: { id: project.id },
      summary,
      description,
      customFields: [
        {
          id: typeField.id,
          name: "Type",
          $type: "SingleEnumIssueCustomField",
          value: { name: settings.issueType },
        },
      ],
    }),
  });

  let finalDescription = description;
  if (input.screenshot) {
    const screenshot = parseScreenshot(input.screenshot);
    const form = new FormData();
    form.append("file", screenshot.blob, screenshot.name);

    const upload = await fetch(
      `${settings.url}/api/issues/${encodeURIComponent(issue.id)}/attachments?fields=id,name,url`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        body: form,
      }
    );
    if (!upload.ok) {
      throw new Error(`Не удалось приложить снимок: ${upload.status} ${(await upload.text()).slice(0, 200)}`);
    }

    finalDescription = `${description}\n\n![Снимок экрана](${screenshot.name})`;
    await request<Issue>(token, `${settings.url}/api/issues/${encodeURIComponent(issue.id)}?fields=id,idReadable`, {
      method: "POST",
      body: JSON.stringify({ description: finalDescription }),
    });
  }

  const idReadable = issue.idReadable || issue.id;
  const url = `${settings.url}/issue/${idReadable}`;
  await chrome.tabs.create({ url });

  return { id: issue.id, idReadable, url };
}
