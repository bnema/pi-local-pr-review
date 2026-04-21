// @ts-check

import {
	commentEndLine,
	commentLineLabel,
	commentPath,
} from "./review-comments.js";

/**
 * @typedef {{ type: "meta", text: string }} DiffMetaLine
 * @typedef {{ type: "add", oldLine: null, newLine: number, text: string }} DiffAddLine
 * @typedef {{ type: "remove", oldLine: number, newLine: null, text: string }} DiffRemoveLine
 * @typedef {{ type: "context", oldLine: number, newLine: number, text: string }} DiffContextLine
 * @typedef {DiffMetaLine | DiffAddLine | DiffRemoveLine | DiffContextLine} DiffLine
 */

/**
 * @typedef {Object} DiffHunk
 * @property {string} header
 * @property {DiffLine[]} lines
 */

/**
 * @typedef {Object} DiffFile
 * @property {string} path
 * @property {string} oldPath
 * @property {number} additions
 * @property {number} deletions
 * @property {DiffHunk[]} hunks
 */

/**
 * @typedef {Object} ReviewComment
 * @property {string | null | undefined} [path]
 * @property {string | null | undefined} [side]
 * @property {string | number | null | undefined} [startLine]
 * @property {string | number | null | undefined} [endLine]
 * @property {string | number | null | undefined} [newLine]
 * @property {string | number | null | undefined} [oldLine]
 * @property {string | number | null | undefined} [line]
 * @property {unknown} [body]
 * @property {unknown[] | null | undefined} [snippetLines]
 * @property {unknown} [snippet]
 */

/**
 * @typedef {Object} ReviewPayload
 * @property {unknown} [summary]
 * @property {ReviewComment[] | null | undefined} [comments]
 */

/**
 * Parse a unified diff into a browser-friendly file/hunk/line structure.
 *
 * @param {string | null | undefined} patch
 * @returns {DiffFile[]}
 */
export function parseUnifiedDiff(patch) {
	/** @type {DiffFile[]} */
	const files = [];
	/** @type {DiffFile | null} */
	let currentFile = null;
	/** @type {DiffHunk | null} */
	let currentHunk = null;
	let oldLine = 0;
	let newLine = 0;

	for (const rawLine of String(patch || "").split("\n")) {
		if (rawLine.startsWith("diff --git ")) {
			const match = rawLine.match(/^diff --git a\/(.*) b\/(.*)$/);
			if (!match) continue;
			currentFile = {
				path: match[2],
				oldPath: match[1],
				additions: 0,
				deletions: 0,
				hunks: [],
			};
			files.push(currentFile);
			currentHunk = null;
			continue;
		}

		if (!currentFile) continue;

		if (rawLine.startsWith("@@ ")) {
			const match = rawLine.match(
				/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
			);
			if (!match) continue;
			oldLine = Number.parseInt(match[1], 10);
			newLine = Number.parseInt(match[3], 10);
			currentHunk = {
				header: rawLine,
				lines: [],
			};
			currentFile.hunks.push(currentHunk);
			continue;
		}

		if (
			!currentHunk ||
			rawLine.startsWith("--- ") ||
			rawLine.startsWith("+++ ")
		)
			continue;

		if (rawLine.startsWith("\\ No newline at end of file")) {
			currentHunk.lines.push({ type: "meta", text: rawLine });
			continue;
		}

		if (rawLine.startsWith("+")) {
			currentHunk.lines.push({
				type: "add",
				oldLine: null,
				newLine,
				text: rawLine.slice(1),
			});
			currentFile.additions += 1;
			newLine += 1;
			continue;
		}

		if (rawLine.startsWith("-")) {
			currentHunk.lines.push({
				type: "remove",
				oldLine,
				newLine: null,
				text: rawLine.slice(1),
			});
			currentFile.deletions += 1;
			oldLine += 1;
			continue;
		}

		if (rawLine.startsWith(" ")) {
			currentHunk.lines.push({
				type: "context",
				oldLine,
				newLine,
				text: rawLine.slice(1),
			});
			oldLine += 1;
			newLine += 1;
			continue;
		}

		currentHunk.lines.push({ type: "meta", text: rawLine });
	}

	return files;
}

/**
 * Format the submitted browser review into a prompt that can be sent back to pi.
 *
 * @param {unknown} review
 * @returns {string}
 */
export function formatReviewPrompt(review) {
	/** @type {ReviewPayload | null} */
	let payload = null;
	if (typeof review === "object" && review !== null) {
		payload = /** @type {ReviewPayload} */ (review);
	}
	const lines = ["Local branch review", ""];
	const summary =
		typeof payload?.summary === "string" ? payload.summary.trim() : "";

	if (summary) {
		lines.push("Summary", summary, "");
	}

	/** @type {string | null} */
	let currentPath = null;
	for (const comment of Array.isArray(payload?.comments)
		? payload.comments
		: []) {
		if (!comment || !String(comment.body || "").trim()) continue;

		const path = commentPath(comment);
		if (path !== currentPath) {
			currentPath = path;
			lines.push(`File: ${path}`);
		}

		const body = String(comment.body || "").trim();
		const startLineLabel = commentLineLabel(comment);
		const endLine = commentEndLine(comment);
		let label = `lines ${startLineLabel}`;
		if (startLineLabel === "unknown") {
			label = "line unknown";
		} else if (Number(startLineLabel) === Number(endLine)) {
			label = `line ${startLineLabel}`;
		}
		lines.push(`- ${comment.side} ${label}: ${body}`);

		if (
			Array.isArray(comment.snippetLines) &&
			comment.snippetLines.length > 0
		) {
			const maxBacktickRun = Math.max(
				...comment.snippetLines.map((snippetLine) => {
					const matches = String(snippetLine).match(/`+/g);
					return matches ? Math.max(...matches.map((run) => run.length)) : 0;
				}),
			);
			const fenceLength = Math.max(3, maxBacktickRun + 1);
			const fence = "`".repeat(fenceLength);
			lines.push("  Snippet:");
			lines.push(`  ${fence}`);
			for (const snippetLine of comment.snippetLines) {
				lines.push(`  ${String(snippetLine)}`);
			}
			lines.push(`  ${fence}`);
		} else if (comment.snippet) {
			lines.push(`  Snippet: ${comment.snippet}`);
		}
	}

	return lines.join("\n");
}
