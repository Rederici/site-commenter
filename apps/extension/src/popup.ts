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
const youtrackLink = document.getElementById("youtrack-link") as HTMLAnchorElement;
const sitesList = document.getElementById("sites") as HTMLElement;
const siteInput = document.getElementById("site-input") as HTMLInputElement;
const siteAdd = document.getElementById("site-add") as HTMLButtonElement;

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

function normalizeSite(value: string): string {
  let text = value.trim().toLowerCase();
  if (!text) return "";
  if (text.includes("://")) {
    try {
      text = new URL(text).hostname;
    } catch {
      return "";
    }
  } else {
    text = text.split("/")[0].replace(/:\d+$/, "");
  }
  return /^(\*\.)?[a-z0-9.-]+$/.test(text) ? text : "";
}

function renderSites() {
  sitesList.replaceChildren();
  if (!settings.sites.length) {
    const empty = document.createElement("li");
    empty.className = "sites-empty";
    empty.textContent = "Пока нет сайтов — попап нигде не появится.";
    sitesList.append(empty);
    return;
  }

  for (const site of settings.sites) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = site;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "site-remove";
    remove.title = `Убрать ${site}`;
    remove.textContent = "×";
    remove.addEventListener("click", () => void removeSite(site));
    item.append(name, remove);
    sitesList.append(item);
  }
}

async function syncSites() {
  try {
    await send({ type: "youtrack:sync-sites" });
  } catch {
    // content script обновится при следующей загрузке страницы
  }
}

async function addSite() {
  const site = normalizeSite(siteInput.value);
  if (!site) {
    setStatus("Укажите домен или URL, например todo.example.com", "error");
    return;
  }
  if (settings.sites.includes(site)) {
    setStatus("Этот сайт уже добавлен", "warn");
    return;
  }

  settings = await saveSettings({ sites: [...settings.sites, site] });
  siteInput.value = "";
  renderSites();
  await syncSites();
  setStatus("Сохранено. Обновите открытые вкладки.", "success");
}

async function removeSite(site: string) {
  settings = await saveSettings({ sites: settings.sites.filter((item) => item !== site) });
  renderSites();
  await syncSites();
  setStatus("Сохранено. Обновите открытые вкладки.", "success");
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
    sitesList.replaceChildren();
    return;
  }

  renderSites();

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
    const sameProject =
      settings.projectId === project.id || settings.projectShortName === project.shortName;
    settings = await saveSettings({
      projectId: project.id,
      projectName: project.name || project.shortName || "",
      projectShortName: project.shortName || "",
    });
    if (sameProject && settings.availableTypes?.length) {
      issueTypes = settings.availableTypes;
      if (!issueTypes.includes(settings.issueType)) {
        const next = issueTypes.includes("Bug") ? "Bug" : issueTypes[0] || "";
        settings = await saveSettings({ issueType: next });
      }
      renderSettings();
    } else {
      await loadTypes(project.id, false);
    }
  } else if (settings.projectShortName) {
    settings = await saveSettings({
      projectId: "",
      projectName: "",
      projectShortName: "",
      issueType: "Bug",
      availableTypes: [],
      typeFieldId: "",
    });
    issueTypes = [];
  }

  renderSettings();
}

async function loadTypes(projectId: string, preferBug: boolean) {
  const response = await send<{ values?: string[]; fieldId?: string; error?: string }>({
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

  settings = await saveSettings({
    issueType: next,
    availableTypes: issueTypes,
    typeFieldId: response.fieldId || "",
  });

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
      availableTypes: [],
      typeFieldId: "",
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
    availableTypes: [],
    typeFieldId: "",
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

async function init() {
  settings = await loadSettings();
  youtrackLink.href = settings.url;
  youtrackLink.title = settings.url;
  youtrackLink.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: settings.url });
  });
  projectSelect.addEventListener("change", () => void onProjectChange());
  typeSelect.addEventListener("change", () => void onTypeChange());
  siteAdd.addEventListener("click", () => void addSite());
  siteInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void addSite();
  });

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
