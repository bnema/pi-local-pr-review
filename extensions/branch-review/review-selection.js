export function normalizeSelection(lines, side) {
  const selectable = Array.isArray(lines)
    ? lines
        .map((line) => ({
          lineRef: Number(line?.lineRef),
          text: String(line?.text ?? ""),
        }))
        .filter((line) => Number.isFinite(line.lineRef))
    : []

  if (selectable.length === 0) return null

  const sorted = [...selectable].sort((left, right) => left.lineRef - right.lineRef)

  return {
    side,
    startLine: sorted[0].lineRef,
    endLine: sorted[sorted.length - 1].lineRef,
    snippetLines: sorted.map((line) => line.text),
  }
}
