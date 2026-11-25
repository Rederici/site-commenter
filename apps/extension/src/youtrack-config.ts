export type YouTrackSettings = {
  url: string;
  projectName: string;
  projectShortName: string;
  issueType: string;
};

export const DEFAULT_SETTINGS: YouTrackSettings = {
  url: "https://yt.example.com",
  projectName: "Site Commenter",
  projectShortName: "SC",
  issueType: "Bug",
};

export const YOUTRACK_CLIENT_ID = "test-sitecommenter";
export const YOUTRACK_SCOPE = "YouTrack";
export const TITLE_MAX_LENGTH = 120;

const SETTINGS_KEY = "youtrack.settings";

/**
 * Пока это константы. Позже сюда придёт экран настроек: проект и тип задачи
 * будут читаться из chrome.storage, а попап — показывать выбранные значения.
 */
export async function loadSettings(): Promise<YouTrackSettings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const value = stored[SETTINGS_KEY];
    return {
      ...DEFAULT_SETTINGS,
      ...(typeof value === "object" && value ? (value as Partial<YouTrackSettings>) : {}),
      url: String((value as Partial<YouTrackSettings> | undefined)?.url || DEFAULT_SETTINGS.url).replace(/\/+$/, ""),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function issuesUrl(settings: YouTrackSettings = DEFAULT_SETTINGS): string {
  return `${settings.url}/projects/${settings.projectShortName}`;
}
