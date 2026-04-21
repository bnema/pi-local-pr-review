// @ts-check

const themeStorageKey = "pi-local-pr-review:theme";

/**
 * @typedef {"dark" | "light"} Theme
 */

/**
 * @typedef {Object} StorageLike
 * @property {(key: string) => string | null} [getItem]
 * @property {(key: string, value: string) => void} [setItem]
 */

/**
 * @typedef {Object} MatchMediaResultLike
 * @property {boolean} [matches]
 */

/**
 * @typedef {(query: string) => MatchMediaResultLike | null | undefined} MatchMediaLike
 */

/**
 * @typedef {HTMLElement} ThemeRoot
 */

/**
 * @typedef {Document} ThemeDocument
 */

/**
 * @typedef {Object} ThemeEnvironment
 * @property {ThemeDocument} document
 * @property {StorageLike | null | undefined} [storage]
 * @property {MatchMediaLike | null | undefined} [matchMedia]
 */

/**
 * @param {string | null | undefined} theme
 * @returns {Theme | null}
 */
function normalizeTheme(theme) {
	return theme === "dark" || theme === "light" ? theme : null;
}

/**
 * @param {ThemeRoot} root
 * @param {Theme} theme
 * @returns {Theme}
 */
export function applyThemeToRoot(root, theme) {
	root.dataset.theme = theme;
	if (root.style) root.style.colorScheme = theme;
	return theme;
}

/**
 * @param {ThemeEnvironment} env
 * @param {string | null | undefined} theme
 * @returns {Theme}
 */
export function setTheme({ document, storage }, theme) {
	const next = normalizeTheme(theme) || "light";
	const root = document.documentElement;
	applyThemeToRoot(root, next);
	try {
		storage?.setItem?.(themeStorageKey, next);
	} catch {}
	return next;
}

/**
 * @param {ThemeEnvironment} env
 * @returns {Theme}
 */
export function initTheme({ document, storage, matchMedia }) {
	/** @type {Theme | null} */
	let saved = null;
	try {
		saved = normalizeTheme(storage?.getItem?.(themeStorageKey));
	} catch {}

	if (saved) {
		const root = document.documentElement;
		applyThemeToRoot(root, saved);
		return saved;
	}

	const prefersDark = Boolean(
		matchMedia?.("(prefers-color-scheme: dark)")?.matches,
	);
	const theme = prefersDark ? "dark" : "light";
	const root = document.documentElement;
	applyThemeToRoot(root, theme);
	return theme;
}
