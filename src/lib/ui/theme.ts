export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "diamond-theme";

/** Only an explicit Diamond preference can override the light default. */
export function resolveTheme(preference: string | null): Theme {
  return preference === "dark" ? "dark" : "light";
}

// Parser-blocking in the root head: runs before body paint, even before React loads.
// Keep this static (no user input) and storage failures harmless.
export const THEME_INITIALIZER = `(()=>{let t="light";try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")t="dark"}catch{}document.documentElement.dataset.theme=t})()`;
