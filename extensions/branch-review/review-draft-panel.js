// @ts-check

import { commentLineNumber, commentPath } from "./review-comments.js";

/**
 * @typedef {Object} DraftCommentLike
 * @property {string | null | undefined} [path]
 * @property {string | number | null | undefined} [startLine]
 * @property {string | number | null | undefined} [newLine]
 * @property {string | number | null | undefined} [oldLine]
 * @property {string | number | null | undefined} [line]
 * @property {unknown} [body]
 */

/**
 * @typedef {Object} DraftCommentGroup
 * @property {string} path
 * @property {DraftCommentLike[]} comments
 */

/**
 * Group draft comments by path and sort them by line and body.
 *
 * @param {Array<DraftCommentLike> | null | undefined} comments
 * @returns {DraftCommentGroup[]}
 */
export function groupDraftComments(comments) {
	/** @type {Map<string, DraftCommentLike[]>} */
	const grouped = new Map();

	for (const comment of Array.isArray(comments) ? comments : []) {
		const path = commentPath(comment);
		const items = grouped.get(path);
		if (items) {
			items.push(comment);
		} else {
			grouped.set(path, [comment]);
		}
	}

	return [...grouped.entries()]
		.sort(([leftPath], [rightPath]) =>
			leftPath.localeCompare(rightPath, undefined, {
				numeric: true,
				sensitivity: "base",
			}),
		)
		.map(([path, items]) => ({
			path,
			comments: items
				.slice()
				.sort(
					(left, right) =>
						commentLineNumber(left) - commentLineNumber(right) ||
						String(left?.body || "").localeCompare(String(right?.body || "")),
				),
		}));
}
