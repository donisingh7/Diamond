"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/ui/theme";

const THEME_CHANGE = "diamond-theme-change";
function readTheme(): Theme {
  return resolveTheme(document.documentElement.dataset.theme ?? null);
}
function serverTheme(): Theme { return "light"; }
function subscribe(onChange: () => void) {
  // A different tab may change storage between the head script and hydration.
  try { document.documentElement.dataset.theme = resolveTheme(localStorage.getItem(THEME_STORAGE_KEY)); } catch { /* Keep the current visit's theme. */ }
  function onStorage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    document.documentElement.dataset.theme = resolveTheme(event.newValue);
    onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE, onChange);
  };
}
function selectTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Still works for this visit. */ }
  window.dispatchEvent(new Event(THEME_CHANGE));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  return <div className="theme-toggle" role="group" aria-label="Color theme">
    <button type="button" data-theme-choice="light" aria-label="Light theme" aria-pressed={theme === "light"} onClick={() => selectTheme("light")}><Sun aria-hidden="true" /><span>Light</span></button>
    <button type="button" data-theme-choice="dark" aria-label="Dark theme" aria-pressed={theme === "dark"} onClick={() => selectTheme("dark")}><Moon aria-hidden="true" /><span>Dark</span></button>
  </div>;
}
