export type Theme = "light" | "dark";

export function initTheme(): Theme {
  const saved = localStorage.getItem("theme") as Theme | null;
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme: Theme = saved ?? (systemDark ? "dark" : "light");

  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}
