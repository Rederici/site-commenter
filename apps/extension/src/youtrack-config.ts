export type YouTrackSettings = {
  url: string;
  projectId?: string;
  projectName: string;
  projectShortName: string;
  issueType: string;
  typeFieldId?: string;
  availableTypes?: string[];
  sites: string[];
};

export const DEFAULT_SETTINGS: YouTrackSettings = {
  url: __SITECOMMENTER_YOUTRACK_URL__,
  projectId: "",
  projectName: "",
  projectShortName: "",
  issueType: "Bug",
  typeFieldId: "",
  availableTypes: [],
  sites: [...__SITECOMMENTER_DEFAULT_SITES__],
};

export const YOUTRACK_CLIENT_ID = __SITECOMMENTER_YOUTRACK_CLIENT_ID__;
export const YOUTRACK_SCOPE = "YouTrack";
export const TITLE_MAX_LENGTH = 120;

const SETTINGS_KEY = "youtrack.settings";

/**
 * Настройки хранятся в chrome.storage.local. Пока проект не выбран, задачи не
 * создаются: это защита от случайной отправки не в тот проект.
 */
export async function loadSettings(): Promise<YouTrackSettings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const value = stored[SETTINGS_KEY];
    const settings = typeof value === "object" && value ? (value as Partial<YouTrackSettings>) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      url: String(settings.url || DEFAULT_SETTINGS.url).replace(/\/+$/, ""),
      projectId: String(settings.projectId || ""),
      projectName: String(settings.projectName || ""),
      projectShortName: String(settings.projectShortName || ""),
      issueType: String(settings.issueType || DEFAULT_SETTINGS.issueType),
      typeFieldId: String(settings.typeFieldId || ""),
      availableTypes: Array.isArray(settings.availableTypes)
        ? settings.availableTypes.map(String).filter(Boolean)
        : DEFAULT_SETTINGS.availableTypes,
      sites: Array.isArray(settings.sites)
        ? settings.sites.map(String).filter(Boolean)
        : DEFAULT_SETTINGS.sites,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<YouTrackSettings>): Promise<YouTrackSettings> {
  const current = await loadSettings();
  const next: YouTrackSettings = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove(SETTINGS_KEY);
}

export function issuesUrl(settings: YouTrackSettings = DEFAULT_SETTINGS): string {
  const project = settings.projectShortName || settings.projectId;
  return project ? `${settings.url}/projects/${project}` : `${settings.url}/projects`;
}
