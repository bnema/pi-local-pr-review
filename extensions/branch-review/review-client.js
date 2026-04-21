import { commentLineLabel, commentLineRef } from "./review-comments.js";
import { groupDraftComments } from "./review-draft-panel.js";
import { buildFileTree } from "./review-file-tree.js";
import { formatReviewPrompt, parseUnifiedDiff } from "./review-prompt.js";
import { normalizeSelection } from "./review-selection.js";
import { initTheme, setTheme } from "./review-theme.js";

export { normalizeSelection } from "./review-selection.js";

function readBootstrap() {
	const element = document.getElementById("review-bootstrap");
	if (!element) throw new Error("missing review bootstrap");
	return JSON.parse(element.textContent || "{}");
}

export function storageKey(bootstrap) {
	return `pi-local-pr-review:${bootstrap.repo}:${bootstrap.base}:${bootstrap.head}:${bootstrap.session}`;
}

function createState(bootstrap) {
	const key = storageKey(bootstrap);
	let stored = null;
	try {
		stored = JSON.parse(localStorage.getItem(key) || "null");
	} catch {}

	return {
		key,
		summary: typeof stored?.summary === "string" ? stored.summary : "",
		comments: Array.isArray(stored?.comments) ? stored.comments : [],
	};
}

function saveState(state) {
	localStorage.setItem(
		state.key,
		JSON.stringify({ summary: state.summary, comments: state.comments }),
	);
}

function isLayoutDebugEnabled(storage) {
	try {
		if (storage?.getItem?.("pi-local-pr-review:debug-layout") === "1")
			return true;
	} catch {}

	const search = String(globalThis.location?.search || "");
	return /(?:^|[?&])debug-layout=1(?:&|$)/.test(search);
}

function elementWidthSnapshot(node) {
	if (!node) return null;

	const rect =
		typeof node.getBoundingClientRect === "function"
			? node.getBoundingClientRect()
			: null;
	const style =
		typeof globalThis.getComputedStyle === "function"
			? globalThis.getComputedStyle(node)
			: null;
	const marginLeft = Number.parseFloat(style?.marginLeft || "0") || 0;
	const marginRight = Number.parseFloat(style?.marginRight || "0") || 0;
	const measuredWidth = Math.max(
		Number(node.scrollWidth || 0),
		Number(node.clientWidth || 0),
		Number(node.offsetWidth || 0),
		Number(rect?.width || 0),
	);

	return {
		clientWidth: Number(node.clientWidth || 0),
		scrollWidth: Number(node.scrollWidth || 0),
		offsetWidth: Number(node.offsetWidth || 0),
		rectWidth: Number(rect?.width || 0),
		marginLeft,
		marginRight,
		totalWidth: measuredWidth + marginLeft + marginRight,
		display: style?.display || "",
		width: style?.width || "",
		minWidth: style?.minWidth || "",
		maxWidth: style?.maxWidth || "",
		overflowX: style?.overflowX || "",
		whiteSpace: style?.whiteSpace || "",
	};
}

function reportReviewLayout({ document, diffView, reason = "manual" }) {
	if (!document || !diffView) return null;

	const view = elementWidthSnapshot(diffView);
	const lines = Array.from(document.querySelectorAll?.(".diff-line") || []);
	const widest = lines
		.map((wrapper, index) => {
			const row =
				wrapper.querySelector?.(":scope > .diff-line__row") ||
				wrapper.querySelector?.(".diff-line__row");
			const text = row?.querySelector?.(".diff-line__text") || null;
			const comments =
				wrapper.querySelector?.(":scope > .diff-line__comments") ||
				wrapper.querySelector?.(".diff-line__comments");
			const composer =
				wrapper.querySelector?.(":scope > .diff-line__composer") ||
				wrapper.querySelector?.(".diff-line__composer");
			const wrapperMetrics = elementWidthSnapshot(wrapper);
			const rowMetrics = elementWidthSnapshot(row);
			const textMetrics = elementWidthSnapshot(text);
			const commentsMetrics = elementWidthSnapshot(comments);
			const composerMetrics = elementWidthSnapshot(composer);
			const widestContribution = Math.max(
				wrapperMetrics?.totalWidth || 0,
				rowMetrics?.totalWidth || 0,
				textMetrics?.totalWidth || 0,
				commentsMetrics?.totalWidth || 0,
				composerMetrics?.totalWidth || 0,
			);

			return {
				index,
				path: wrapper.dataset.path || "",
				lineRef: wrapper.dataset.lineRef || "",
				lineType: wrapper.dataset.lineType || "",
				widestContribution,
				wrapper: wrapperMetrics,
				row: rowMetrics,
				text: textMetrics,
				comments: commentsMetrics,
				composer: composerMetrics,
			};
		})
		.sort((left, right) => right.widestContribution - left.widestContribution)
		.slice(0, 12);

	const summary = widest.map((entry) => ({
		path: entry.path,
		lineRef: entry.lineRef,
		lineType: entry.lineType,
		widestContribution: entry.widestContribution,
		wrapperWidth: entry.wrapper?.totalWidth || 0,
		rowWidth: entry.row?.totalWidth || 0,
		textWidth: entry.text?.totalWidth || 0,
		commentsWidth: entry.comments?.totalWidth || 0,
		composerWidth: entry.composer?.totalWidth || 0,
	}));

	console.groupCollapsed(`[review-layout] ${reason}`);
	console.log("diff-view", view);
	console.table(summary);
	if (widest[0]) console.log("widest-line-detail", widest[0]);
	console.groupEnd();

	return { reason, diffView: view, widest };
}

const lucideSvgRoot = [
	`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"`,
	` fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`,
].join("");
const lucideSvgEnd = `</svg>`;

const moonIcon = [
	lucideSvgRoot,
	`<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />`,
	lucideSvgEnd,
].join("");

const sunIcon = [
	lucideSvgRoot,
	`<circle cx="12" cy="12" r="4" />`,
	`<path d="M12 2v2" />`,
	`<path d="M12 20v2" />`,
	`<path d="m4.93 4.93 1.41 1.41" />`,
	`<path d="m17.66 17.66 1.41 1.41" />`,
	`<path d="M2 12h2" />`,
	`<path d="M20 12h2" />`,
	`<path d="m6.34 17.66-1.41 1.41" />`,
	`<path d="m19.07 4.93-1.41 1.41" />`,
	lucideSvgEnd,
].join("");

const panelLeftOpenIcon = [
	lucideSvgRoot,
	`<rect width="18" height="18" x="3" y="3" rx="2" />`,
	`<path d="M9 3v18" />`,
	`<path d="m14 9 3 3-3 3" />`,
	lucideSvgEnd,
].join("");

const panelLeftCloseIcon = [
	lucideSvgRoot,
	`<rect width="18" height="18" x="3" y="3" rx="2" />`,
	`<path d="M9 3v18" />`,
	`<path d="m16 15-3-3 3-3" />`,
	lucideSvgEnd,
].join("");

const refreshCwIcon = [
	lucideSvgRoot,
	`<path d="M21 2v6h-6" />`,
	`<path d="M21 8a9 9 0 0 0-15.5-2.36L3 8" />`,
	`<path d="M3 22v-6h6" />`,
	`<path d="M3 16a9 9 0 0 0 15.5 2.36L21 16" />`,
	lucideSvgEnd,
].join("");

function setIconButtonContent(button, icon, label) {
	if (!button) return;
	button.innerHTML = `${icon}<span class="sr-only">${label}</span>`;
	button.setAttribute("aria-label", label);
	button.setAttribute("title", label);
}

function syncThemeButton(button, theme) {
	if (!button) return;
	const next = theme === "dark" ? "Light mode" : "Dark mode";
	const icon = theme === "dark" ? sunIcon : moonIcon;
	setIconButtonContent(button, icon, `Switch to ${next.toLowerCase()}`);
}

export function toggleTheme({ document, storage, button }) {
	const current =
		document.documentElement.dataset.theme === "dark" ? "dark" : "light";
	const next = current === "dark" ? "light" : "dark";
	const applied = setTheme({ document, storage }, next);
	syncThemeButton(button, applied);
	return applied;
}

function setSidebarCollapsed(document, collapsed) {
	if (!document?.body?.dataset) return collapsed;
	document.body.dataset.sidebar = collapsed ? "collapsed" : "expanded";
	return collapsed;
}

function syncSidebarToggle(button, collapsed) {
	if (!button) return;
	const label = `${collapsed ? "Show" : "Hide"} sidebar`;
	const icon = collapsed ? panelLeftOpenIcon : panelLeftCloseIcon;
	setIconButtonContent(button, icon, label);
	button.setAttribute("aria-pressed", collapsed ? "true" : "false");
}

function createId() {
	return (
		globalThis.crypto?.randomUUID?.() ||
		`comment-${Date.now()}-${Math.random().toString(16).slice(2)}`
	);
}

export function formatSidebarFileLabel(name, maxLength = 21) {
	const text = String(name || "");
	if (text.length <= maxLength) return text;

	const dot = text.lastIndexOf(".");
	if (dot <= 0 || dot === text.length - 1) {
		return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
	}

	const suffix = text.slice(dot + 1);
	const prefixLength = maxLength - suffix.length - 3;
	if (prefixLength < 4) {
		return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
	}

	return `${text.slice(0, prefixLength)}...${suffix}`;
}

function composerAnchorLine(composer) {
	return Number(composer?.endLine ?? composer?.startLine ?? NaN);
}

function lineSide(line) {
	return line.type === "remove" ? "old" : "new";
}

function lineRefForSide(line, side) {
	return side === "old" ? line.oldLine : line.newLine;
}

function selectableLinesForFile(file, side) {
	const lines = [];

	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.type === "meta") continue;
			const lineRef = lineRefForSide(line, side);
			if (lineRef === null || lineRef === undefined) continue;
			lines.push({ lineRef: Number(lineRef), text: line.text });
		}
	}

	return lines;
}

function selectionForRange(file, side, startLine, endLine) {
	const lower = Math.min(Number(startLine), Number(endLine));
	const upper = Math.max(Number(startLine), Number(endLine));
	const lines = selectableLinesForFile(file, side).filter(
		(line) => line.lineRef >= lower && line.lineRef <= upper,
	);

	return normalizeSelection(lines, side);
}

function createComposerComment(composer) {
	return {
		id: createId(),
		path: composer.path,
		side: composer.side,
		startLine: composer.startLine,
		endLine: composer.endLine,
		body: composer.body,
		snippetLines: composer.snippetLines,
		snippet: composer.snippetLines.join("\n"),
		line: composer.startLine,
		oldLine: composer.side === "old" ? composer.startLine : null,
		newLine: composer.side === "new" ? composer.startLine : null,
	};
}

function fileSectionId(path) {
	return `file-${path.replace(/[^a-z0-9]+/gi, "-")}`;
}

export function normalizedComments(state) {
	return state.comments
		.filter((comment) => String(comment.body || "").trim())
		.map((comment) => ({
			...comment,
			body: String(comment.body || "").trim(),
		}));
}

export function currentReview(state) {
	const comments = groupDraftComments(normalizedComments(state)).flatMap(
		(group) => group.comments,
	);

	return {
		summary: String(state.summary || "").trim(),
		comments,
	};
}

function setStatus(message, kind = "") {
	const status = document.getElementById("status");
	if (!status) return;
	status.textContent = message;
	status.dataset.kind = kind;
}

const highlightLanguageByName = new Map([
	["Dockerfile", "dockerfile"],
	["Gemfile", "ruby"],
	["Makefile", "makefile"],
	["Rakefile", "ruby"],
]);

const highlightLanguageByExtension = new Map([
	[".bash", "bash"],
	[".cjs", "javascript"],
	[".css", "css"],
	[".go", "go"],
	[".html", "xml"],
	[".jsx", "javascript"],
	[".js", "javascript"],
	[".json", "json"],
	[".md", "markdown"],
	[".mjs", "javascript"],
	[".rb", "ruby"],
	[".rs", "rust"],
	[".sh", "bash"],
	[".toml", "toml"],
	[".ts", "typescript"],
	[".tsx", "typescript"],
	[".yaml", "yaml"],
	[".yml", "yaml"],
	[".zsh", "bash"],
]);

// Keep this pinned to match the highlight.js stylesheet/core version in review-template.html.
const highlightLanguageBundleBase =
	"https://unpkg.com/@highlightjs/cdn-assets@11.11.1/languages";
const highlightLanguageLoads = new Map();

export function detectHighlightLanguage(filePath) {
	const rawPath = String(filePath || "");
	const basename = rawPath.split("/").pop() || "";

	if (highlightLanguageByName.has(basename)) {
		return highlightLanguageByName.get(basename);
	}

	const dot = basename.lastIndexOf(".");
	if (dot === -1) return null;

	const extension = basename.slice(dot).toLowerCase();
	return highlightLanguageByExtension.get(extension) || null;
}

export function highlightLanguageAssetUrl(language) {
	return `${highlightLanguageBundleBase}/${language}.min.js`;
}

function collectHighlightLanguages(filePaths) {
	const languages = new Set();

	for (const filePath of filePaths) {
		const language = detectHighlightLanguage(filePath);
		if (language) languages.add(language);
	}

	return [...languages];
}

export async function loadHighlightLanguage(language) {
	if (!language) return false;

	const hljs = globalThis.hljs;
	if (typeof hljs?.getLanguage === "function" && hljs.getLanguage(language)) {
		return true;
	}

	if (highlightLanguageLoads.has(language)) {
		return highlightLanguageLoads.get(language);
	}

	const promise = new Promise((resolve) => {
		const doc = globalThis.document;
		const head = doc?.head || doc?.documentElement;
		if (
			!doc ||
			!head ||
			typeof doc.createElement !== "function" ||
			typeof head.append !== "function"
		) {
			resolve(false);
			return;
		}

		const script = doc.createElement("script");
		script.async = true;
		script.src = highlightLanguageAssetUrl(language);
		script.addEventListener(
			"load",
			() => {
				resolve(
					typeof globalThis.hljs?.getLanguage === "function"
						? Boolean(globalThis.hljs.getLanguage(language))
						: true,
				);
			},
			{ once: true },
		);
		script.addEventListener("error", () => resolve(false), { once: true });

		try {
			head.append(script);
		} catch {
			resolve(false);
		}
	}).catch(() => false);

	highlightLanguageLoads.set(language, promise);
	return promise;
}

export async function loadHighlightLanguages(filePaths) {
	const languages = collectHighlightLanguages(filePaths);
	return Promise.all(
		languages.map((language) => loadHighlightLanguage(language)),
	);
}

export function renderHighlightedCode(node, text, filePath = "") {
	node.textContent = text;
	node.classList?.add?.("hljs");

	const hljs = globalThis.hljs;
	if (!hljs) return false;

	const language = detectHighlightLanguage(filePath);

	if (
		language &&
		typeof hljs.highlight === "function" &&
		(!hljs.getLanguage || hljs.getLanguage(language))
	) {
		try {
			const result = hljs.highlight(String(text || ""), {
				language,
				ignoreIllegals: true,
			});
			if (result?.value) {
				node.innerHTML = result.value;
				return true;
			}
		} catch {}
	}

	if (typeof hljs.highlightAuto !== "function") return false;

	try {
		const result = hljs.highlightAuto(String(text || ""));
		if (!result?.value || !result.language || result.language === "plaintext")
			return false;
		node.innerHTML = result.value;
		return true;
	} catch {
		return false;
	}
}

let lineDragCleanup = null;

function renderDraftPreview(state) {
	const draft = document.getElementById("draft-preview");
	if (!draft) return;
	draft.textContent = formatReviewPrompt(currentReview(state));
}

export function createDraftPreviewDisclosure(document) {
	const draftPreviewSection = document.createElement("details");
	draftPreviewSection.className = "draft-preview";
	draftPreviewSection.open = false;

	const draftPreviewHeading = document.createElement("summary");
	draftPreviewHeading.textContent = "Prompt preview";

	const draftPreview = document.createElement("pre");
	draftPreview.id = "draft-preview";

	draftPreviewSection.append(draftPreviewHeading, draftPreview);
	return { draftPreviewSection, draftPreviewHeading, draftPreview };
}

export function buildCommentCounts(state) {
	const counts = new Map();
	for (const comment of normalizedComments(state)) {
		const path = String(comment.path || "");
		counts.set(path, (counts.get(path) || 0) + 1);
	}
	return counts;
}

function renderTreeNode(node, counts, activePath, selectFile) {
	if (node.type === "directory") {
		const directory = document.createElement("div");
		directory.className = "file-tree__directory";

		if (node.name) {
			const label = document.createElement("div");
			label.className = "file-tree__directory-label";
			label.textContent = node.name;
			directory.append(label);
		}

		const children = document.createElement("div");
		children.className = "file-tree__children";

		for (const child of node.children) {
			children.append(renderTreeNode(child, counts, activePath, selectFile));
		}

		directory.append(children);
		return directory;
	}

	const button = document.createElement("button");
	button.type = "button";
	button.className = "file-tree__file";
	if (node.path === activePath) {
		button.classList.add("file-tree__file--active");
		button.setAttribute("aria-current", "true");
	}

	const label = document.createElement("span");
	label.className = "file-tree__file-label";
	label.textContent = formatSidebarFileLabel(node.name);
	label.title = node.name;

	const count = counts.get(node.path) || 0;
	if (count > 0) {
		const badge = document.createElement("span");
		badge.className = "file-tree__badge";
		badge.textContent = String(count);
		button.append(badge);
	}

	button.append(label);

	button.addEventListener("click", () => selectFile(node.path));
	return button;
}

function buildCommentCard(
	state,
	comment,
	refreshComments,
	refreshDraftOverview,
) {
	const card = document.createElement("div");
	card.className = "comment-card";
	card.dataset.commentId = comment.id;

	const title = document.createElement("div");
	title.className = "comment-card__title";
	title.textContent = `${comment.path}:${commentLineLabel(comment)} (${comment.side})`;

	const textarea = document.createElement("textarea");
	textarea.value = comment.body || "";
	textarea.rows = 3;
	textarea.placeholder = "Write a review comment";
	textarea.addEventListener("input", () => {
		comment.body = textarea.value;
		saveState(state);
		refreshDraftOverview();
		renderDraftPreview(state);
	});

	const controls = document.createElement("div");
	controls.className = "comment-card__controls";

	const remove = document.createElement("button");
	remove.type = "button";
	remove.textContent = "Remove";
	remove.addEventListener("click", () => {
		state.comments = state.comments.filter((entry) => entry.id !== comment.id);
		saveState(state);
		refreshComments();
	});

	controls.append(remove);
	card.append(title, textarea, controls);
	return card;
}

function buildDraftCommentCard(comment) {
	const card = document.createElement("article");
	card.className = "comment-card comment-card--draft";

	const title = document.createElement("div");
	title.className = "comment-card__title";
	title.textContent = `${comment.path}:${commentLineLabel(comment)} (${comment.side})`;

	const body = document.createElement("div");
	body.className = "draft-comment__body";
	body.textContent = String(comment.body || "").trim() || "No comment body";

	card.append(title, body);
	return card;
}

function buildComposerCard(composer, saveComposer, cancelComposer) {
	const card = document.createElement("div");
	card.className = "comment-card comment-card--composer";

	const title = document.createElement("div");
	title.className = "comment-card__title";
	title.textContent = `${composer.path}:${composer.startLine}${composer.endLine !== composer.startLine ? `-${composer.endLine}` : ""} (${composer.side})`;

	const textarea = document.createElement("textarea");
	textarea.value = composer.body || "";
	textarea.rows = 3;
	textarea.placeholder = "Write a review comment";
	textarea.addEventListener("input", () => {
		composer.body = textarea.value;
	});

	const controls = document.createElement("div");
	controls.className = "comment-card__controls";

	const save = document.createElement("button");
	save.type = "button";
	save.textContent = "Save";
	save.addEventListener("click", saveComposer);

	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.textContent = "Cancel";
	cancel.addEventListener("click", cancelComposer);

	controls.append(save, cancel);
	card.append(title, textarea, controls);
	return card;
}

function renderCommentsForLine(
	state,
	slot,
	file,
	line,
	refreshComments,
	refreshDraftOverview,
) {
	slot.replaceChildren();
	const comments = state.comments.filter(
		(comment) =>
			comment.path === file.path &&
			comment.side === line.side &&
			Number(commentLineRef(comment)) === Number(line.lineRef),
	);

	for (const comment of comments) {
		slot.append(
			buildCommentCard(state, comment, refreshComments, refreshDraftOverview),
		);
	}
}

function renderComposerForLine(slot, composer, saveComposer, cancelComposer) {
	slot.replaceChildren();

	if (!composer) return;

	const path = slot.dataset.path || "";
	const side = slot.dataset.side || "";
	const lineRef = Number(slot.dataset.lineRef || "");

	if (
		composer.path !== path ||
		composer.side !== side ||
		composerAnchorLine(composer) !== lineRef
	)
		return;

	slot.append(buildComposerCard(composer, saveComposer, cancelComposer));
}

function renderDiffLine(
	state,
	file,
	line,
	refreshComments,
	refreshDraftOverview,
	selectLine,
) {
	const wrapper = document.createElement("section");
	wrapper.className = `diff-line diff-line--${line.type}`;
	wrapper.dataset.path = file.path;
	wrapper.dataset.side = lineSide(line);
	wrapper.dataset.lineRef = String(
		lineSide(line) === "old" ? (line.oldLine ?? "") : (line.newLine ?? ""),
	);
	wrapper.dataset.lineType = line.type;

	const row = document.createElement("div");
	row.className = "diff-line__row";

	const gutter = document.createElement(
		line.type === "meta" ? "span" : "button",
	);
	gutter.className = "diff-line__gutter";
	if (line.type === "meta") {
		gutter.textContent = "";
	} else {
		gutter.type = "button";
		gutter.textContent = "+";
		gutter.setAttribute("aria-label", "Add review comment");
		gutter.addEventListener("mousedown", (event) =>
			selectLine(file, line, event),
		);
		gutter.addEventListener("mouseenter", (event) =>
			selectLine(file, line, event),
		);
		gutter.addEventListener("click", (event) => {
			if (event.detail !== 0) return;
			selectLine(file, line, event);
		});
	}

	const oldLine = document.createElement("span");
	oldLine.className = "diff-line__number diff-line__number--old";
	oldLine.textContent = line.oldLine ?? "";

	const newLine = document.createElement("span");
	newLine.className = "diff-line__number diff-line__number--new";
	newLine.textContent = line.newLine ?? "";

	const text = document.createElement("span");
	text.className = "diff-line__text hljs";
	renderHighlightedCode(text, line.text, file.path);

	row.append(gutter, oldLine, newLine, text);

	const composerSlot = document.createElement("div");
	composerSlot.className = "diff-line__composer";
	composerSlot.dataset.path = file.path;
	composerSlot.dataset.side = lineSide(line);
	composerSlot.dataset.lineRef = String(
		lineSide(line) === "old" ? (line.oldLine ?? "") : (line.newLine ?? ""),
	);

	if (line.type === "meta") composerSlot.hidden = true;

	const commentsSlot = document.createElement("div");
	commentsSlot.className = "diff-line__comments";
	commentsSlot.dataset.path = file.path;
	commentsSlot.dataset.side = lineSide(line);
	commentsSlot.dataset.line = String(
		lineSide(line) === "old" ? (line.oldLine ?? "") : (line.newLine ?? ""),
	);

	renderCommentsForLine(
		state,
		commentsSlot,
		file,
		{
			side: lineSide(line),
			lineRef: lineSide(line) === "old" ? line.oldLine : line.newLine,
		},
		refreshComments,
		refreshDraftOverview,
	);

	wrapper.append(row, composerSlot, commentsSlot);
	return wrapper;
}

function renderFileSection(
	state,
	file,
	refreshComments,
	refreshDraftOverview,
	selectLine,
) {
	const section = document.createElement("section");
	section.className = "file-section";
	section.id = fileSectionId(file.path);

	const scroller = document.createElement("div");
	scroller.className = "file-section__scroller";

	const content = document.createElement("div");
	content.className = "file-section__content";

	const heading = document.createElement("h3");
	heading.textContent = `${file.path} (${file.additions}+ / ${file.deletions}-)`;
	content.append(heading);

	for (const hunk of file.hunks) {
		const pre = document.createElement("pre");
		pre.className = "hunk-header";
		pre.textContent = hunk.header;
		content.append(pre);

		for (const line of hunk.lines) {
			content.append(
				renderDiffLine(
					state,
					file,
					line,
					refreshComments,
					refreshDraftOverview,
					selectLine,
				),
			);
		}
	}

	scroller.append(content);
	section.append(scroller);
	return section;
}

export function renderStaleBanner(document, { stale, reloading, onReload }) {
	if (!stale) return null;

	const banner = document.createElement("div");
	banner.className = `review-status review-status--${reloading ? "reloading" : "stale"}`;
	banner.dataset.kind = reloading ? "reloading" : "stale";
	banner.setAttribute("role", "status");
	banner.setAttribute("aria-live", "polite");

	const icon = document.createElement("span");
	icon.className = "review-status__icon";
	icon.innerHTML = refreshCwIcon;

	const message = document.createElement("span");
	message.className = "review-status__label";
	message.textContent = reloading ? "Reloading..." : "Diff changed";

	banner.append(icon, message);

	if (!reloading && typeof onReload === "function") {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "review-status__action";
		button.textContent = "Reload";
		button.addEventListener("click", onReload);
		banner.append(button);
	}

	return banner;
}

function composerHasExactAnchor(file, composer) {
	const side = composer?.side;
	const startLine = Number(composer?.startLine);
	const endLine = Number(composer?.endLine);
	if (!side || !Number.isFinite(startLine) || !Number.isFinite(endLine))
		return false;

	const refs = new Set(
		selectableLinesForFile(file, side).map((line) => line.lineRef),
	);
	const lower = Math.min(startLine, endLine);
	const upper = Math.max(startLine, endLine);

	for (let lineRef = lower; lineRef <= upper; lineRef += 1) {
		if (!refs.has(lineRef)) return false;
	}

	return true;
}

export function preserveComposerAcrossReload(composer, files) {
	if (!composer) return null;

	const path = String(composer.path || "");
	if (!path) return null;

	for (const file of files || []) {
		if (file?.path !== path) continue;
		if (composerHasExactAnchor(file, composer)) return composer;
	}

	return null;
}

async function renderFreshDiffSnapshot(app, payload) {
	app.diffView.replaceChildren();

	const parsedFiles = parseUnifiedDiff(payload.patch);
	const renderedFiles = payload.files.map(
		(filePath) =>
			parsedFiles.find((file) => file.path === filePath) || {
				path: filePath,
				additions: 0,
				deletions: 0,
				hunks: [],
			},
	);

	await loadHighlightLanguages(renderedFiles.map((file) => file.path));

	const nextFingerprint = await fingerprintForLoadedDiff(payload);

	app.diffSnapshot = payload;
	app.diffFingerprint = nextFingerprint;
	app.files = renderedFiles;
	app.tree = buildFileTree(renderedFiles);
	app.dragSelection = null;
	app.composer = preserveComposerAcrossReload(app.composer, renderedFiles);
	app.stale = false;

	const diffControls = document.createElement("div");
	diffControls.className = "diff-view__controls";

	const sidebarToggle = document.createElement("button");
	sidebarToggle.type = "button";
	sidebarToggle.className = "diff-view__sidebar-toggle icon-button";
	syncSidebarToggle(sidebarToggle, app.sidebarCollapsed);
	sidebarToggle.addEventListener("click", () => {
		app.sidebarCollapsed = setSidebarCollapsed(document, !app.sidebarCollapsed);
		syncSidebarToggle(sidebarToggle, app.sidebarCollapsed);
	});

	diffControls.append(sidebarToggle);
	app.diffView.append(diffControls);

	for (const file of renderedFiles) {
		app.diffView.append(
			renderFileSection(
				app.state,
				file,
				app.refreshComments,
				app.renderDraftOverview,
				app.handleLineSelection,
			),
		);
	}

	app.renderSidebar();
	app.refreshComments();
	app.syncComposerUI();
	app.scheduleLayoutReport("after-render");
}

export async function loadDiff(bootstrap) {
	const response = await fetch("/api/diff", {
		headers: {
			"x-review-token": bootstrap.token,
		},
	});
	if (!response.ok) throw new Error(`failed to load diff (${response.status})`);
	return response.json();
}

export async function loadReviewStatus(bootstrap) {
	const response = await fetch("/api/review-status", {
		headers: {
			"x-review-token": bootstrap.token,
		},
	});
	if (!response.ok)
		throw new Error(`failed to load review status (${response.status})`);
	return response.json();
}

export async function pollReviewStatus(app) {
	if (!app?.bootstrap || !app.diffFingerprint || app.reloading)
		return app?.stale ?? false;

	try {
		const loader = app.loadReviewStatus || loadReviewStatus;
		const status = await loader(app.bootstrap);
		const nextStale =
			String(status?.fingerprint || "") !== String(app.diffFingerprint || "");

		if (nextStale !== app.stale) {
			app.stale = nextStale;
			app.renderSidebar?.();
		}

		return nextStale;
	} catch {
		return app.stale ?? false;
	}
}

export async function reloadDiff(app) {
	if (!app?.bootstrap || app.reloading) return null;

	const loader = app.loadDiff || loadDiff;
	const renderSnapshot =
		app.renderFreshDiffSnapshot ||
		((payload) => renderFreshDiffSnapshot(app, payload));

	app.reloading = true;
	app.renderSidebar?.();

	try {
		const payload = await loader(app.bootstrap);
		await renderSnapshot(payload);
		app.stale = false;
		return payload;
	} catch {
		return null;
	} finally {
		app.reloading = false;
		app.renderSidebar?.();
	}
}

export async function fingerprintForLoadedDiff(payload) {
	const bytes = new TextEncoder().encode(String(payload?.patch || ""));
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(hash)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function submitReview(state, bootstrap) {
	const response = await fetch("/api/submit", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-review-token": bootstrap.token,
		},
		body: JSON.stringify(currentReview(state)),
	});

	let payload = null;
	try {
		payload = await response.json();
	} catch {}

	if (!response.ok) {
		throw new Error(
			payload?.error ||
				payload?.message ||
				`submit failed (${response.status})`,
		);
	}

	return payload;
}

function renderApp(bootstrap) {
	lineDragCleanup?.abort();
	lineDragCleanup = new AbortController();

	const state = createState(bootstrap);
	const fileList = document.getElementById("file-list");
	const diffView = document.getElementById("diff-view");
	const draftEditor = document.getElementById("draft-editor");
	const storage = (() => {
		try {
			return globalThis.localStorage;
		} catch {
			return undefined;
		}
	})();
	initTheme({
		document,
		storage,
		matchMedia: globalThis.matchMedia?.bind(globalThis),
	});
	const app = {
		bootstrap,
		state,
		fileList,
		diffView,
		draftEditor,
		storage,
		sidebarCollapsed: setSidebarCollapsed(document, false),
		activePath: "",
		tree: buildFileTree([]),
		composer: null,
		dragSelection: null,
		files: [],
		layoutDebugEnabled: isLayoutDebugEnabled(storage),
		runLayoutReport: null,
		scheduleLayoutReport: null,
		renderSidebar: null,
		refreshComments: null,
		syncComposerUI: null,
		renderDraftOverview: null,
		handleLineSelection: null,
		loadDiff,
		loadReviewStatus,
		renderFreshDiffSnapshot: null,
		pollReviewStatus: null,
		reloadDiff: null,
		stale: false,
		reloading: false,
		diffSnapshot: null,
		diffFingerprint: "",
	};
	app.runLayoutReport = (reason = "manual") =>
		reportReviewLayout({ document, diffView: app.diffView, reason });
	app.scheduleLayoutReport = (reason) => {
		if (!app.layoutDebugEnabled) return;
		globalThis.setTimeout?.(() => {
			app.runLayoutReport(reason);
		}, 0);
	};

	globalThis.__piLocalPrReviewLayout = app.runLayoutReport;
	globalThis.__piLocalPrReviewEnableLayoutDebug = () => {
		try {
			storage?.setItem?.("pi-local-pr-review:debug-layout", "1");
		} catch {}
		console.info(
			"[review-layout] debug flag saved — reload the page to enable automatic layout logging",
		);
	};
	globalThis.__piLocalPrReviewDisableLayoutDebug = () => {
		try {
			storage?.removeItem?.("pi-local-pr-review:debug-layout");
		} catch {}
		console.info("[review-layout] debug flag cleared");
	};

	if (app.layoutDebugEnabled) {
		console.info(
			"[review-layout] debug enabled — run __piLocalPrReviewLayout('after-repro') in devtools after reproducing the width issue",
		);
		globalThis.addEventListener?.(
			"resize",
			() => app.scheduleLayoutReport("resize"),
			{ signal: lineDragCleanup.signal },
		);
	}

	draftEditor.replaceChildren();
	draftEditor.className = "draft-dock";
	draftEditor.dataset.collapsed = "false";
	draftEditor.setAttribute("aria-label", "Draft review panel");

	const draftHeader = document.createElement("div");
	draftHeader.className = "draft-dock__header";

	const draftHeading = document.createElement("h3");
	draftHeading.textContent = "Draft review";

	const draftToggle = document.createElement("button");
	draftToggle.type = "button";
	draftToggle.textContent = "Collapse panel";
	draftToggle.setAttribute("aria-expanded", "true");

	const draftBody = document.createElement("div");
	draftBody.className = "draft-dock__content";

	draftToggle.addEventListener("click", () => {
		const collapsed = draftEditor.dataset.collapsed === "true";
		const nextCollapsed = !collapsed;
		draftEditor.dataset.collapsed = String(nextCollapsed);
		draftBody.hidden = nextCollapsed;
		draftToggle.textContent = nextCollapsed ? "Expand panel" : "Collapse panel";
		draftToggle.setAttribute("aria-expanded", String(!nextCollapsed));
		app.scheduleLayoutReport(nextCollapsed ? "draft-collapse" : "draft-expand");
	});

	draftHeader.append(draftHeading, draftToggle);

	const summaryLabel = document.createElement("label");
	summaryLabel.textContent = "Summary";

	const summaryInput = document.createElement("textarea");
	summaryInput.rows = 4;
	summaryInput.value = state.summary;
	summaryInput.addEventListener("input", () => {
		state.summary = summaryInput.value;
		saveState(state);
		renderDraftPreview(state);
	});
	summaryLabel.append(summaryInput);

	const draftCommentsHeading = document.createElement("h4");
	draftCommentsHeading.textContent = "Saved comments";

	const draftComments = document.createElement("div");
	draftComments.id = "draft-comments";
	draftComments.className = "draft-group-list";

	const actions = document.createElement("div");
	actions.className = "actions";

	const submit = document.createElement("button");
	submit.type = "button";
	submit.textContent = "Submit review";
	submit.addEventListener("click", async () => {
		submit.disabled = true;
		setStatus("Submitting review…");
		try {
			const result = await submitReview(state, bootstrap);
			setStatus(result?.message || "Review delivered to pi", "success");
		} catch (error) {
			setStatus(
				error instanceof Error ? error.message : "Failed to submit review",
				"error",
			);
			submit.disabled = false;
		}
	});

	const status = document.createElement("p");
	status.id = "status";

	const { draftPreviewSection } = createDraftPreviewDisclosure(document);

	actions.append(submit);
	draftBody.append(
		summaryLabel,
		draftCommentsHeading,
		draftComments,
		actions,
		status,
		draftPreviewSection,
	);
	draftEditor.append(draftHeader, draftBody);

	function renderDraftOverview() {
		draftComments.replaceChildren();

		const groups = groupDraftComments(normalizedComments(state));
		if (groups.length === 0) {
			const empty = document.createElement("p");
			empty.className = "draft-empty";
			empty.textContent = "No saved comments yet.";
			draftComments.append(empty);
			return;
		}

		for (const group of groups) {
			const section = document.createElement("article");
			section.className = "draft-group";

			const title = document.createElement("div");
			title.className = "draft-group__title";
			title.textContent = group.path;

			const items = document.createElement("div");
			items.className = "draft-group__comments";

			for (const comment of group.comments) {
				items.append(buildDraftCommentCard(comment));
			}

			section.append(title, items);
			draftComments.append(section);
		}
	}

	function cancelComposer() {
		app.composer = null;
		app.syncComposerUI();
	}

	function saveComposer() {
		if (!app.composer) return;
		if (!String(app.composer.body || "").trim()) return;

		state.comments.push(createComposerComment(app.composer));
		app.composer = null;
		saveState(state);
		app.refreshComments();
	}

	function applyComposerSelection(
		file,
		nextSelection,
		keepBody,
		focusComposer = true,
	) {
		if (!nextSelection) return;

		app.composer = {
			...nextSelection,
			path: file.path,
			body: keepBody && app.composer ? app.composer.body : "",
		};

		app.syncComposerUI();
		if (!focusComposer) return;

		queueMicrotask(() => {
			document.querySelector(".diff-line__composer textarea")?.focus();
		});
	}

	function stopLineDrag() {
		app.dragSelection = null;
	}

	function syncComposerUI() {
		for (const wrapper of document.querySelectorAll(".diff-line")) {
			const path = wrapper.dataset.path || "";
			const side = wrapper.dataset.side || "";
			const lineRef = Number(wrapper.dataset.lineRef || "");
			const selected =
				Boolean(app.composer) &&
				app.composer.path === path &&
				app.composer.side === side &&
				Number.isFinite(lineRef) &&
				lineRef >= app.composer.startLine &&
				lineRef <= app.composer.endLine;

			wrapper.classList.toggle("diff-line--selected", selected);

			const gutter = wrapper.querySelector(".diff-line__gutter");
			if (gutter) {
				gutter.classList.toggle("diff-line__gutter--selected", selected);
				if (gutter.tagName === "BUTTON") {
					gutter.setAttribute("aria-pressed", selected ? "true" : "false");
				}
			}
		}

		for (const slot of document.querySelectorAll(".diff-line__composer")) {
			renderComposerForLine(slot, app.composer, saveComposer, cancelComposer);
		}
	}

	function handleLineSelection(file, line, event) {
		if (line.type === "meta") return;

		const side = lineSide(line);
		const lineRef = lineRefForSide(line, side);
		if (lineRef === null || lineRef === undefined) return;

		if (event.type === "mouseenter") {
			if (!app.dragSelection || !(event.buttons & 1)) return;
			if (
				app.dragSelection.path !== file.path ||
				app.dragSelection.side !== side
			)
				return;

			applyComposerSelection(
				file,
				selectionForRange(
					file,
					side,
					app.dragSelection.startLine,
					Number(lineRef),
				),
				true,
				false,
			);
			return;
		}

		if (event.type === "mousedown") {
			if (event.button !== 0) return;
			event.preventDefault();
			app.dragSelection = {
				path: file.path,
				side,
				startLine: Number(lineRef),
			};
		}

		const nextSelection =
			event.shiftKey &&
			app.composer &&
			app.composer.path === file.path &&
			app.composer.side === side
				? selectionForRange(file, side, app.composer.startLine, Number(lineRef))
				: normalizeSelection([{ lineRef, text: line.text }], side);

		const keepBody = Boolean(
			event.shiftKey &&
				app.composer &&
				app.composer.path === file.path &&
				app.composer.side === side,
		);
		applyComposerSelection(file, nextSelection, keepBody);
	}

	app.renderDraftOverview = renderDraftOverview;
	app.syncComposerUI = syncComposerUI;
	app.handleLineSelection = handleLineSelection;
	app.refreshComments = () => {
		for (const slot of document.querySelectorAll(".diff-line__comments")) {
			const path = slot.dataset.path || "";
			const side = slot.dataset.side || "";
			const line = Number(slot.dataset.line || "");
			slot.replaceChildren();
			for (const comment of state.comments) {
				if (
					comment.path === path &&
					comment.side === side &&
					Number(commentLineRef(comment)) === line
				) {
					slot.append(
						buildCommentCard(
							state,
							comment,
							app.refreshComments,
							renderDraftOverview,
						),
					);
				}
			}
		}

		app.renderSidebar();
		app.syncComposerUI();
		renderDraftOverview();
		renderDraftPreview(state);
		app.scheduleLayoutReport("refresh-comments");
	};

	document.addEventListener("mouseup", stopLineDrag, {
		signal: lineDragCleanup.signal,
	});

	function renderSidebar() {
		fileList.replaceChildren();

		const staleBanner = renderStaleBanner(document, {
			stale: app.stale,
			reloading: app.reloading,
			onReload: () => {
				void reloadDiff(app);
			},
		});

		const listHeading = document.createElement("h3");
		listHeading.textContent = "Files";

		const treeContainer = document.createElement("div");
		treeContainer.className = "file-tree";

		const counts = buildCommentCounts(state);
		for (const child of app.tree.children) {
			treeContainer.append(
				renderTreeNode(child, counts, app.activePath, (path) => {
					app.activePath = path;
					renderSidebar();
					document
						.getElementById(fileSectionId(path))
						?.scrollIntoView({ behavior: "smooth", block: "start" });
				}),
			);
		}

		const themeToggle = document.createElement("button");
		themeToggle.type = "button";
		themeToggle.className = "sidebar-theme-toggle icon-button";
		syncThemeButton(themeToggle, document.documentElement.dataset.theme);
		themeToggle.addEventListener("click", () => {
			toggleTheme({ document, storage, button: themeToggle });
		});

		fileList.append(
			...(staleBanner ? [staleBanner] : []),
			listHeading,
			treeContainer,
			themeToggle,
		);
	}

	app.renderSidebar = renderSidebar;
	app.renderFreshDiffSnapshot = (payload) =>
		renderFreshDiffSnapshot(app, payload);
	app.pollReviewStatus = () => pollReviewStatus(app);
	app.reloadDiff = () => reloadDiff(app);
	renderDraftPreview(state);
	renderDraftOverview();

	function startPolling() {
		const timer = globalThis.setInterval?.(() => {
			void pollReviewStatus(app);
		}, 5000);

		if (!timer) return;
		app.pollTimer = timer;
		lineDragCleanup.signal.addEventListener(
			"abort",
			() => {
				globalThis.clearInterval?.(timer);
			},
			{ once: true },
		);
	}

	return loadDiff(bootstrap)
		.then((payload) => renderFreshDiffSnapshot(app, payload))
		.then(() => startPolling())
		.catch((error) => {
			setStatus(
				error instanceof Error ? error.message : "Failed to load diff",
				"error",
			);
		});
}

if (typeof document !== "undefined") {
	renderApp(readBootstrap());
}
