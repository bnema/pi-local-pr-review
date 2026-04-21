// @ts-check

/**
 * @typedef {"old" | "new"} DiffSide
 */

/**
 * @typedef {Object} SelectionInput
 * @property {unknown} [lineRef]
 * @property {unknown} [text]
 */

/**
 * @typedef {Object} SelectionLine
 * @property {number} lineRef
 * @property {string} text
 */

/**
 * @typedef {Object} NormalizedSelection
 * @property {DiffSide} side
 * @property {number} startLine
 * @property {number} endLine
 * @property {string[]} snippetLines
 */

/**
 * Normalize a set of selectable diff lines into a composer selection.
 *
 * @param {Array<SelectionInput> | null | undefined} lines
 * @param {DiffSide} side
 * @returns {NormalizedSelection | null}
 */
export function normalizeSelection(lines, side) {
	/** @type {SelectionLine[]} */
	const selectable = Array.isArray(lines)
		? lines
				.map((line) => ({
					lineRef: Number(line?.lineRef),
					text: String(line?.text ?? ""),
				}))
				.filter((line) => Number.isFinite(line.lineRef))
		: [];

	if (selectable.length === 0) return null;

	const sorted = [...selectable].sort(
		(left, right) => left.lineRef - right.lineRef,
	);

	return {
		side,
		startLine: sorted[0].lineRef,
		endLine: sorted[sorted.length - 1].lineRef,
		snippetLines: sorted.map((line) => line.text),
	};
}
