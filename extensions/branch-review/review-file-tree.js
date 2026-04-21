// @ts-check

/**
 * @typedef {Record<string, unknown> & { path?: unknown }} FileInput
 */

/**
 * @typedef {Record<string, unknown> & { path: string }} FileRecord
 */

/**
 * @typedef {Object} DirectoryNode
 * @property {"directory"} type
 * @property {string} name
 * @property {string} path
 * @property {TreeNode[]} children
 */

/**
 * @typedef {Object} FileNode
 * @property {"file"} type
 * @property {string} name
 * @property {string} path
 * @property {FileRecord} file
 */

/**
 * @typedef {DirectoryNode | FileNode} TreeNode
 */

/**
 * @param {TreeNode} a
 * @param {TreeNode} b
 */
function compareNodes(a, b) {
	if (a.name === b.name) {
		if (a.type === b.type) return 0;
		return a.type === "directory" ? -1 : 1;
	}

	return a.name < b.name ? -1 : 1;
}

/**
 * @param {string} name
 * @param {string} path
 * @returns {DirectoryNode}
 */
function createDirectory(name, path) {
	return {
		type: "directory",
		name,
		path,
		children: [],
	};
}

/**
 * @param {FileRecord} file
 * @returns {FileNode}
 */
function createFile(file) {
	const parts = String(file.path || "").split("/");
	return {
		type: "file",
		name: parts[parts.length - 1] || file.path,
		path: file.path,
		file,
	};
}

/**
 * @param {DirectoryNode} node
 */
function sortTree(node) {
	node.children.sort(compareNodes);
	for (const child of node.children) {
		if (child.type === "directory") sortTree(child);
	}
}

/**
 * Build a nested file tree from a flat list of files.
 *
 * @param {Array<FileInput> | null | undefined} files
 * @returns {DirectoryNode}
 */
export function buildFileTree(files) {
	const root = createDirectory("", "");

	for (const file of Array.isArray(files) ? files : []) {
		const path = String(file?.path || "").trim();
		if (!path) continue;

		const parts = path.split("/");
		const leaf = createFile({ ...file, path });
		let node = root;
		let currentPath = "";

		for (let index = 0; index < parts.length - 1; index += 1) {
			const segment = parts[index];
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			let child = /** @type {DirectoryNode | undefined} */ (
				node.children.find(
					(entry) => entry.type === "directory" && entry.name === segment,
				)
			);
			if (!child) {
				child = createDirectory(segment, currentPath);
				node.children.push(child);
			}
			node = child;
		}

		node.children.push(leaf);
	}

	sortTree(root);
	return root;
}
