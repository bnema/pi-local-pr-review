export function parseUnifiedDiff(patch) {
  const files = []
  let currentFile = null
  let currentHunk = null
  let oldLine = 0
  let newLine = 0

  for (const rawLine of String(patch || "").split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/^diff --git a\/(.*) b\/(.*)$/)
      if (!match) continue
      currentFile = {
        path: match[2],
        oldPath: match[1],
        additions: 0,
        deletions: 0,
        hunks: [],
      }
      files.push(currentFile)
      currentHunk = null
      continue
    }

    if (!currentFile) continue

    if (rawLine.startsWith("@@ ")) {
      const match = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (!match) continue
      oldLine = Number.parseInt(match[1], 10)
      newLine = Number.parseInt(match[3], 10)
      currentHunk = {
        header: rawLine,
        lines: [],
      }
      currentFile.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk || rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) continue

    if (rawLine.startsWith("\\ No newline at end of file")) {
      currentHunk.lines.push({ type: "meta", text: rawLine })
      continue
    }

    if (rawLine.startsWith("+")) {
      currentHunk.lines.push({ type: "add", oldLine: null, newLine, text: rawLine.slice(1) })
      currentFile.additions += 1
      newLine += 1
      continue
    }

    if (rawLine.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", oldLine, newLine: null, text: rawLine.slice(1) })
      currentFile.deletions += 1
      oldLine += 1
      continue
    }

    if (rawLine.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", oldLine, newLine, text: rawLine.slice(1) })
      oldLine += 1
      newLine += 1
      continue
    }

    currentHunk.lines.push({ type: "meta", text: rawLine })
  }

  return files
}

export function formatReviewPrompt(review) {
  const lines = ["Local branch review", ""]
  const summary = typeof review?.summary === "string" ? review.summary.trim() : ""

  if (summary) {
    lines.push("Summary", summary, "")
  }

  let currentPath = null
  for (const comment of Array.isArray(review?.comments) ? review.comments : []) {
    if (!comment || !String(comment.body || "").trim()) continue

    const path = comment.path || "unknown file"
    if (path !== currentPath) {
      currentPath = path
      lines.push(`File: ${path}`)
    }

    const body = String(comment.body || "").trim()
    const startLine = comment.startLine ?? comment.newLine ?? comment.oldLine ?? comment.line ?? "unknown"
    const endLine = comment.endLine ?? startLine
    const label = String(startLine) === "unknown" ? "line unknown" : Number(startLine) === Number(endLine) ? `line ${startLine}` : `lines ${startLine}-${endLine}`
    lines.push(`- ${comment.side} ${label}: ${body}`)

    if (Array.isArray(comment.snippetLines) && comment.snippetLines.length > 0) {
      const maxBacktickRun = Math.max(...comment.snippetLines.map((snippetLine) => {
        const matches = String(snippetLine).match(/`+/g)
        return matches ? Math.max(...matches.map((run) => run.length)) : 0
      }))
      const fenceLength = Math.max(3, maxBacktickRun + 1)
      const fence = "`".repeat(fenceLength)
      lines.push("  Snippet:")
      lines.push(`  ${fence}`)
      for (const snippetLine of comment.snippetLines) {
        lines.push(`  ${String(snippetLine)}`)
      }
      lines.push(`  ${fence}`)
    } else if (comment.snippet) {
      lines.push(`  Snippet: ${comment.snippet}`)
    }
  }

  return lines.join("\n")
}
