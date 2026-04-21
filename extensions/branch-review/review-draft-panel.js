function commentLine(comment) {
  return Number(comment?.startLine ?? comment?.newLine ?? comment?.oldLine ?? comment?.line ?? Number.POSITIVE_INFINITY)
}

export function groupDraftComments(comments) {
  const grouped = new Map()

  for (const comment of Array.isArray(comments) ? comments : []) {
    const path = String(comment?.path || "unknown file")
    if (!grouped.has(path)) grouped.set(path, [])
    grouped.get(path).push(comment)
  }

  return [...grouped.entries()]
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath, undefined, { numeric: true, sensitivity: "base" }))
    .map(([path, items]) => ({
      path,
      comments: items
        .slice()
        .sort((left, right) => commentLine(left) - commentLine(right) || String(left?.body || "").localeCompare(String(right?.body || ""))),
    }))
}
