import { loadSettings, saveSettings, type PlayerSettings } from "@keyspilli/player-core";

export const APP_THEME_EVENT = "keyspilli:theme";
export type AppTheme = PlayerSettings["stageTheme"];

export function applyAppTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent(APP_THEME_EVENT));
}

export function setAppTheme(theme: AppTheme) {
  saveSettings({ ...loadSettings(), stageTheme: theme });
  applyAppTheme(theme);
}
