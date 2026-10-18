// A locus as people type it and genome browsers write it, 1-based and closed:
// `chr6:160,614,798-160,647,758`, `chr6:160614798..160647758`, or one base,
// `chr6:160,614,798`. The region it returns is 0-based and half-open, as
// `parseRegion` reads a figure spec's.

const LOCUS = /^\s*([^:\s]+):\s*([\d,]+)(?:\s*(?:-|\.\.)\s*([\d,]+))?\s*$/

export function parseLocus(text: string) {
  const m = LOCUS.exec(text)
  if (!m) {
    return undefined
  }
  const n = (s: string) => Number(s.replaceAll(',', ''))
  const start = n(m[2]!) - 1
  const end = m[3] ? n(m[3]) : start + 1
  return start >= 0 && end > start ? { refName: m[1]!, start, end } : undefined
}

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function formatLocus(r: {
  refName: string
  start: number
  end: number
}) {
  return `${r.refName}:${grouped(r.start + 1)}-${grouped(r.end)}`
}
