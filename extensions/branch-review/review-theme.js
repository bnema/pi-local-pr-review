const themeStorageKey = "pi-local-pr-review:theme"

function normalizeTheme(theme) {
  return theme === "dark" || theme === "light" ? theme : null
}

export function applyThemeToRoot(root, theme) {
  root.dataset.theme = theme
  if (root.style) root.style.colorScheme = theme
  return theme
}

export function setTheme({ document, storage }, theme) {
  const next = normalizeTheme(theme) || "light"
  const root = document.documentElement
  applyThemeToRoot(root, next)
  try {
    storage?.setItem?.(themeStorageKey, next)
  } catch {}
  return next
}

export function initTheme({ document, storage, matchMedia }) {
  let saved = null
  try {
    saved = normalizeTheme(storage?.getItem?.(themeStorageKey))
  } catch {}

  if (saved) {
    const root = document.documentElement
    applyThemeToRoot(root, saved)
    return saved
  }

  const prefersDark = Boolean(matchMedia?.("(prefers-color-scheme: dark)")?.matches)
  const theme = prefersDark ? "dark" : "light"
  const root = document.documentElement
  applyThemeToRoot(root, theme)
  return theme
}
