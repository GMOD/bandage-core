// SVG renderer for a layout: nodes as thick polylines, edges as thin cubic
// curves attached to the facing node ends, coloured by rank / reference.
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const RANK_COLORS = [
  '#2f8fd6',
  '#f28c28',
  '#a3266d',
  '#3aa655',
  '#8e6bd1',
  '#c94040',
]

export function renderSvg(graph, positions, out, opts = {}) {
  const {
    width = 1400,
    height = 800,
    pad = 30,
    thickness = 6,
    title = '',
    nodeColor,
    aspectLock = true,
    edgeAlpha = 0.6,
    labels = false,
    paths = null,
    region = null,
    scheme = 'reference',
  } = opts
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const pts of Object.values(positions)) {
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  }
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  let sx = (width - 2 * pad) / w
  let sy = (height - 2 * pad) / h
  if (aspectLock) sx = sy = Math.min(sx, sy)
  const drawnW = w * sx + 2 * pad
  const drawnH = h * sy + 2 * pad + (title ? 24 : 0)
  const X = x => pad + (x - minX) * sx
  const Y = y => (title ? 24 : 0) + pad + (y - minY) * sy
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${drawnW.toFixed(0)}" height="${drawnH.toFixed(0)}" viewBox="0 0 ${drawnW.toFixed(0)} ${drawnH.toFixed(0)}">`,
  )
  parts.push(`<rect width="100%" height="100%" fill="white"/>`)
  if (title)
    parts.push(
      `<text x="8" y="17" font-family="sans-serif" font-size="14" fill="#222">${esc(title)}</text>`,
    )
  for (const e of graph.edges) {
    const a = positions[e.from],
      b = positions[e.to]
    if (!a || !b) continue
    const { p, q, ta, tb } = facing(a, b)
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    const k = Math.min(d / 2, 5 / 1) // control length in layout units
    const c1 = { x: p.x + ta.x * k, y: p.y + ta.y * k }
    const c2 = { x: q.x + tb.x * k, y: q.y + tb.y * k }
    parts.push(
      `<path d="M${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)} C${X(c1.x).toFixed(1)},${Y(c1.y).toFixed(1)} ${X(c2.x).toFixed(1)},${Y(c2.y).toFixed(1)} ${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}" fill="none" stroke="#555" stroke-opacity="${edgeAlpha}" stroke-width="1.2"/>`,
    )
  }
  for (const [id, pts] of Object.entries(positions)) {
    const n = byId.get(id)
    const color = nodeColor
      ? nodeColor(n)
      : scheme === 'reference'
        ? referenceColor(n, graph, region)
        : RANK_COLORS[Math.min(n?.stable?.rank ?? 1, RANK_COLORS.length - 1)]
    const d = pts
      .map(
        (p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`,
      )
      .join(' ')
    parts.push(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    if (labels && n) {
      const m = pts[Math.floor(pts.length / 2)]
      parts.push(
        `<text x="${X(m.x).toFixed(1)}" y="${(Y(m.y) - 5).toFixed(1)}" font-family="sans-serif" font-size="8" fill="#333">${esc(n.name)}</text>`,
      )
    }
  }
  if (paths) {
    const n = paths.length
    const step = thickness * 0.9
    paths.forEach((path, pi) => {
      const off = (pi - (n - 1) / 2) * step
      const hue = Math.round((pi * 360) / n)
      let d = ''
      let prev = null
      path.nodeIds.forEach((id, i) => {
        let pts = positions[id]
        if (!pts) return
        if (path.strands[i] === '-') pts = [...pts].reverse()
        const [na, nb] = offsetPts(pts, off)
        const nrm = na
        for (const p of nrm)
          d += `${d ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)} `
        prev = pts
      })
      parts.push(
        `<path d="${d}" fill="none" stroke="hsl(${hue},70%,45%)" stroke-opacity="0.85" stroke-width="${Math.max(1, thickness * 0.7)}" stroke-linejoin="round"/>`,
      )
    })
  }
  parts.push('</svg>')
  writeFileSync(out, parts.join('\n'))
  if (out.endsWith('.svg')) {
    execFileSync('rsvg-convert', ['-o', out.replace(/\.svg$/, '.png'), out])
  }
}

function offsetPts(pts, off) {
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b.x - a.x,
      dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    out.push({ x: pts[i].x - (dy / l) * off, y: pts[i].y + (dx / l) * off })
  }
  return [out]
}

// The plugin's 'reference-position' scheme (GeometryBuilder.getNodeColor):
// hue 0..300 across the region for rank-0 nodes, charcoal for anchored
// off-reference nodes, grey for nodes with no coordinate.
let rampCache = null
function referenceColor(n, graph, region) {
  if (!n) return '#a0a0a0'
  if (!n.stable) return '#a0a0a0'
  if (n.stable.rank > 0) return 'rgb(60,65,72)'
  if (!rampCache || rampCache.graph !== graph) {
    let min = Infinity,
      max = -Infinity
    for (const m of graph.nodes)
      if (m.stable?.rank === 0) {
        const mid = m.stable.start + m.length / 2
        min = Math.min(min, mid)
        max = Math.max(max, mid)
      }
    rampCache = {
      graph,
      start: region ? region.start : min,
      span: region ? region.end - region.start : Math.max(1, max - min),
    }
  }
  const mid = n.stable.start + n.length / 2
  const frac = Math.max(
    0,
    Math.min(1, (mid - rampCache.start) / rampCache.span),
  )
  return `hsl(${(frac * 300).toFixed(1)},70%,50%)`
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

// Which ends of two polylines face each other, plus outward unit tangents there.
function facing(a, b) {
  const ends = pts => [
    { p: pts[0], t: tangent(pts[Math.min(1, pts.length - 1)], pts[0]) },
    { p: pts.at(-1), t: tangent(pts[Math.max(pts.length - 2, 0)], pts.at(-1)) },
  ]
  // Bandage semantics: edge leaves the END of a and enters the START of b.
  const ea = ends(a)[1]
  const eb = ends(b)[0]
  return { p: ea.p, q: eb.p, ta: ea.t, tb: eb.t }
}

function tangent(from, to) {
  const dx = to.x - from.x,
    dy = to.y - from.y
  const l = Math.hypot(dx, dy) || 1
  return { x: dx / l, y: dy / l }
}

// Montage several PNGs side by side / in a grid with ImageMagick.
export function montage(pngs, out, cols = 2) {
  execFileSync('magick', [
    'montage',
    ...pngs,
    '-tile',
    `${cols}x`,
    '-geometry',
    '+6+6',
    '-background',
    '#ddd',
    out,
  ])
}
