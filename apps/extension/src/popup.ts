import {
  DEFAULT_SETTINGS,
  clearSettings,
  loadSettings,
  saveSettings,
  type YouTrackSettings,
} from "./youtrack-config";

type User = { id: string; login: string; name?: string; email?: string };
type Project = { id: string; name?: string; shortName?: string };

const authEl = document.getElementById("auth") as HTMLElement;
const settingsEl = document.getElementById("settings") as HTMLElement;
const projectSelect = document.getElementById("project") as HTMLSelectElement;
const typeSelect = document.getElementById("type") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLElement;
const openButton = document.getElementById("open") as HTMLButtonElement;

let settings: YouTrackSettings = { ...DEFAULT_SETTINGS };
let user: User | null = null;
let projects: Project[] = [];
let issueTypes: string[] = [];
let busy = false;

function send<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function setStatus(text: string, tone: "muted" | "error" | "warn" | "success" = "muted") {
  statusEl.textContent = text;
  statusEl.className = `status${tone === "muted" ? "" : ` is-${tone}`}`;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.disabled = busy;
  element.addEventListener("click", onClick);
  return element;
}

function currentProject(): Project | undefined {
  return projects.find(
    (project) =>
      (settings.projectId && project.id === settings.projectId) ||
      (settings.projectShortName && project.shortName === settings.projectShortName)
  );
}

function renderAuth() {
  authEl.replaceChildren();
  settingsEl.hidden = !user;

  if (user) {
    const row = document.createElement("div");
    row.className = "user-row";

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = (user.name || user.login).slice(0, 1).toUpperCase();

    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "user-name";
    name.textContent = user.name || user.login;
    const login = document.createElement("div");
    login.className = "user-login";
    login.textContent = `@${user.login}`;
    text.append(name, login);

    row.append(avatar, text, button("Выйти", "btn btn-secondary", logout));
    authEl.append(row);
    return;
  }

  const hint = document.createElement("p");
  hint.textContent = "Войдите в YouTrack, чтобы создавать задачи из замечаний.";
  authEl.append(hint, button("Войти в YouTrack", "btn", login));
}

function renderSettings() {
  if (!user) {
    projectSelect.replaceChildren();
    typeSelect.replaceChildren();
    return;
  }

  const project = currentProject();

  projectSelect.disabled = busy || projects.length === 0;
  projectSelect.replaceChildren();
  const projectPlaceholder = document.createElement("option");
  projectPlaceholder.value = "";
  projectPlaceholder.textContent = projects.length ? "Выберите проект" : "Нет доступных проектов";
  projectSelect.append(projectPlaceholder);

  for (const item of projects) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name || item.shortName} (${item.shortName || item.id})`;
    projectSelect.append(option);
  }
  projectSelect.value = project?.id || "";

  typeSelect.disabled = busy || !project || issueTypes.length === 0;
  typeSelect.replaceChildren();

  if (!project) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Сначала выберите проект";
    typeSelect.append(option);
    return;
  }

  const typePlaceholder = document.createElement("option");
  typePlaceholder.value = "";
  typePlaceholder.textContent = issueTypes.length ? "Выберите тип" : "Нет доступных типов";
  typeSelect.append(typePlaceholder);

  for (const value of issueTypes) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    typeSelect.append(option);
  }

  if (issueTypes.includes(settings.issueType)) {
    typeSelect.value = settings.issueType;
  }
}

async function loadProjects() {
  setStatus("Загружаем проекты…");
  const response = await send<{ projects?: Project[]; error?: string }>({ type: "youtrack:projects" });
  if (response.error) {
    projects = [];
    issueTypes = [];
    renderSettings();
    setStatus(response.error, "error");
    return;
  }

  projects = response.projects || [];
  const project = currentProject();

  if (project) {
    settings = await saveSettings({
      projectId: project.id,
      projectName: project.name || project.shortName || "",
      projectShortName: project.shortName || "",
    });
    await loadTypes(project.id, false);
  } else if (settings.projectShortName) {
    settings = await saveSettings({
      projectId: "",
      projectName: "",
      projectShortName: "",
      issueType: "Bug",
    });
    issueTypes = [];
  }

  renderSettings();
}

async function loadTypes(projectId: string, preferBug: boolean) {
  const response = await send<{ values?: string[]; error?: string }>({
    type: "youtrack:issue-types",
    payload: { projectId },
  });

  if (response.error) {
    issueTypes = ["Bug"];
    setStatus(response.error, "warn");
  } else {
    issueTypes = response.values?.length ? response.values : ["Bug"];
  }

  const next = preferBug
    ? issueTypes.includes("Bug")
      ? "Bug"
      : issueTypes[0] || ""
    : issueTypes.includes(settings.issueType)
      ? settings.issueType
      : issueTypes.includes("Bug")
        ? "Bug"
        : issueTypes[0] || "";

  if (next !== settings.issueType) {
    settings = await saveSettings({ issueType: next });
  }

  renderSettings();
}

async function onProjectChange() {
  const project = projects.find((item) => item.id === projectSelect.value);

  if (!project) {
    settings = await saveSettings({
      projectId: "",
      projectName: "",
      projectShortName: "",
      issueType: "Bug",
    });
    issueTypes = [];
    renderSettings();
    setStatus("Проект не выбран", "warn");
    return;
  }

  settings = await saveSettings({
    projectId: project.id,
    projectName: project.name || project.shortName || "",
    projectShortName: project.shortName || "",
    issueType: "",
  });
  setStatus("Загружаем типы задач…");
  await loadTypes(project.id, true);
  setStatus("Сохранено", "success");
}

async function onTypeChange() {
  settings = await saveSettings({ issueType: typeSelect.value });
  setStatus("Сохранено", "success");
}

async function login() {
  if (busy) return;
  busy = true;
  renderAuth();
  renderSettings();
  setStatus("Открываем YouTrack…");

  try {
    const response = await send<{ user?: User; error?: string }>({ type: "youtrack:login" });
    if (!response.user) {
      setStatus(response.error || "Не удалось выполнить вход", "error");
      return;
    }
    user = response.user;
    busy = false;
    renderAuth();
    renderSettings();
    await loadProjects();
    setStatus("Вход выполнен", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy = false;
    renderAuth();
    renderSettings();
  }
}

async function logout() {
  if (busy) return;
  busy = true;
  renderAuth();
  renderSettings();
  try {
    await send({ type: "youtrack:logout" });
    await clearSettings();
    user = null;
    projects = [];
    issueTypes = [];
    settings = { ...DEFAULT_SETTINGS };
    setStatus("Вы вышли из YouTrack");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy = false;
    renderAuth();
    renderSettings();
  }
}

function openCommentForm() {
  setStatus("Открываем форму…");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      setStatus("Не удалось найти активную вкладку", "warn");
      return;
    }
    chrome.tabs
      .sendMessage(tab.id, { type: "ui-comments:open" })
      .then(() => {
        setStatus("Форма открыта на странице", "success");
        window.close();
      })
      .catch(() => {
        setStatus("На этой странице расширение не работает. Откройте todo.example.com.", "warn");
      });
  });
}

async function init() {
  settings = await loadSettings();
  projectSelect.addEventListener("change", () => void onProjectChange());
  typeSelect.addEventListener("change", () => void onTypeChange());
  openButton.addEventListener("click", openCommentForm);

  const response = await send<{ user?: User | null }>({ type: "youtrack:status" });
  user = response.user || null;
  renderAuth();
  renderSettings();

  if (user) {
    await loadProjects();
  }
}

void init().catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : String(error), "error");
});
