// @ts-check

/**
 * @typedef {Object} ReviewCommentLike
 * @property {string | null | undefined} [path]
 * @property {string | number | null | undefined} [startLine]
 * @property {string | number | null | undefined} [endLine]
 * @property {string | number | null | undefined} [newLine]
 * @property {string | number | null | undefined} [oldLine]
 * @property {string | number | null | undefined} [line]
 */

/**
 * @param {ReviewCommentLike | null | undefined} comment
 * @returns {string}
 */
export function commentPath(comment) {
	return String(comment?.path || "unknown file");
}

/**
 * @param {ReviewCommentLike | null | undefined} comment
 * @returns {string | number}
 */
export function commentLineRef(comment) {
	return (
		comment?.startLine ??
		comment?.newLine ??
		comment?.oldLine ??
		comment?.line ??
		"unknown"
	);
}

/**
 * @param {ReviewCommentLike | null | undefined} comment
 * @returns {string | number}
 */
export function commentEndLine(comment) {
	return comment?.endLine ?? commentLineRef(comment);
}

/**
 * @param {ReviewCommentLike | null | undefined} comment
 * @returns {number}
 */
export function commentLineNumber(comment) {
	const lineNumber = Number(commentLineRef(comment));
	return Number.isFinite(lineNumber) ? lineNumber : Number.POSITIVE_INFINITY;
}

/**
 * @param {ReviewCommentLike | null | undefined} comment
 * @returns {string}
 */
export function commentLineLabel(comment) {
	const startLine = commentLineRef(comment);
	const endLine = commentEndLine(comment);

	if (String(startLine) === "unknown") return "unknown";
	if (Number(startLine) === Number(endLine)) return String(startLine);
	return `${startLine}-${endLine}`;
}
