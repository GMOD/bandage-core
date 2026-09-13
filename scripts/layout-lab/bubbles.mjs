// A variant map from gfatools' bubble decomposition: the reference as a line,
// each bubble a glyph sized by the allele lengths it holds and labelled by what
// kind of variation it is. No node graph; the question it answers is "what
// varies here, how big, how many ways", which is what a reader asks first.
//
//   node bubbles.mjs <bubbles.bed.gz> <chrom> <start> <end> <out.svg> [title]
//
// gfatools bubble columns: chrom, start, end, #segments, #paths (distinct
// routes), inversion flag, shortest route bp, longest route bp, three unused,
// segment ids, shortest sequence, longest sequence.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export function readBubbles(bed, chrom, start, end) {
  const text = execFileSync('zcat', [bed], { maxBuffer: 1 << 30 }).toString()
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.startsWith(chrom + '\t')) continue
    const f = line.split('\t')
    const s = +f[1],
      e = +f[2]
    if (e < start || s > end) continue
    rows.push({
      start: s,
      end: e,
      refSpan: e - s,
      segments: +f[3],
      paths: +f[4],
      inversion: f[5] === '1',
      shortest: +f[6],
      longest: +f[7],
      ids: f[11].split(','),
    })
  }
  return rows
}

// Bubble class from the numbers gfatools states. A bubble's routes are what
// the haplotypes do between two reference segments; the reference route is one
// of them with length refSpan.
export function classify(b) {
  const { refSpan, shortest, longest, paths, inversion, segments } = b
  // gfatools counts distinct routes; a nested superbubble's count is
  // combinatorial and saturates the int32 it is stored in
  const routes =
    paths >= 2147483647
      ? 'more routes than fit an int32'
      : paths >= 100000
        ? `${(paths / 1000).toFixed(0)}k routes`
        : `${paths} routes`
  if (segments >= 40) {
    return {
      kind: 'complex',
      label: `superbubble: ${segments} segments, ${routes}, ${fmt(shortest)}–${fmt(longest)}${inversion ? ', with an inversion' : ''}`,
    }
  }
  if (inversion)
    return { kind: 'inversion', label: `inversion, ${fmt(longest)}` }
  if (paths >= 8 && longest > 5 * Math.max(shortest, 1)) {
    return {
      kind: 'cnv',
      label: `${routes}, ${fmt(shortest)}–${fmt(longest)}: repeat array`,
    }
  }
  if (shortest === longest && shortest === refSpan) {
    return {
      kind: refSpan <= 1 ? 'snp' : 'sub',
      label: refSpan <= 1 ? 'SNP' : `${fmt(refSpan)} substitution`,
    }
  }
  if (refSpan === 0 || shortest === refSpan) {
    // reference is the shortest route: others insert sequence
    return {
      kind: 'ins',
      label: `insertion, up to ${fmt(longest - refSpan)}${paths > 2 ? `, ${paths} alleles` : ''}`,
    }
  }
  if (longest === refSpan) {
    return {
      kind: 'del',
      label: `deletion of ${fmt(refSpan - shortest)}${paths > 2 ? `, ${paths} alleles` : ''}`,
    }
  }
  return {
    kind: 'complex',
    label: `${paths} alleles, ${fmt(shortest)}–${fmt(longest)} for ${fmt(refSpan)} of reference`,
  }
}

const KIND = {
  snp: '#5b6b7a',
  sub: '#5b6b7a',
  ins: '#2f8fd6',
  del: '#c94040',
  cnv: '#8e3fbf',
  inversion: '#e07b00',
  complex: '#8e3fbf',
}

export function fmt(bp) {
  return bp >= 1000
    ? `${(bp / 1000).toFixed(bp >= 10000 ? 0 : 1)} kb`
    : `${bp} bp`
}

export function renderVariantMap(
  rows,
  region,
  out,
  { width = 1600, title = '', genes = [] } = {},
) {
  const pad = 40,
    lineY = 150,
    bottom = 60
  const span = region.end - region.start
  const X = bp => pad + ((bp - region.start) / span) * (width - 2 * pad)
  const H = bp => 12 + 26 * Math.log10(1 + bp) // glyph height from allele bp
  const maxH = Math.max(...rows.map(b => H(b.longest)), 40)
  const top = 40 + 15 * Math.min(rows.length, 6)
  const height = top + maxH + 80 + bottom + (genes.length ? 30 : 0)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">`,
    `<rect width="100%" height="100%" fill="white"/>`,
  ]
  if (title)
    parts.push(
      `<text x="${pad}" y="20" font-size="14" fill="#222">${esc(title)}</text>`,
    )
  const ly = top + maxH + 20
  // reference line as the rainbow ramp
  const steps = 60
  for (let i = 0; i < steps; i++) {
    const x0 = pad + (i / steps) * (width - 2 * pad),
      x1 = pad + ((i + 1) / steps) * (width - 2 * pad)
    parts.push(
      `<line x1="${x0}" x2="${x1 + 0.5}" y1="${ly}" y2="${ly}" stroke="hsl(${(300 * i) / steps},70%,50%)" stroke-width="7"/>`,
    )
  }
  // ticks
  for (let k = 0; k <= 4; k++) {
    const bp = region.start + (span * k) / 4
    parts.push(
      `<line x1="${X(bp)}" x2="${X(bp)}" y1="${ly + 8}" y2="${ly + 14}" stroke="#666"/>`,
    )
    parts.push(
      `<text x="${X(bp)}" y="${ly + 28}" font-size="11" fill="#555" text-anchor="middle">${bp.toLocaleString()}</text>`,
    )
  }
  for (const g of genes) {
    const x0 = Math.max(pad, X(g.start)),
      x1 = Math.min(width - pad, X(g.end))
    parts.push(
      `<rect x="${x0}" y="${ly + 36}" width="${Math.max(2, x1 - x0)}" height="8" fill="#c8a400" opacity="0.8"/>`,
    )
    parts.push(
      `<text x="${(x0 + x1) / 2}" y="${ly + 58}" font-size="11" fill="#7a6400" text-anchor="middle">${esc(g.name)}</text>`,
    )
  }
  // glyphs, sorted so small ones draw last
  const sorted = [...rows].sort((a, b) => b.refSpan - a.refSpan)
  for (const b of sorted) {
    const cls = classify(b)
    const x0 = X(Math.max(b.start, region.start)),
      x1 = X(Math.min(b.end, region.end))
    const w = Math.max(x1 - x0, 10)
    const cx = (x0 + x1) / 2
    const h = H(b.longest)
    const color = KIND[cls.kind]
    // lens: ref route along the line, longest route as an arc above with height h
    parts.push(
      `<path d="M${cx - w / 2},${ly} C${cx - w / 2},${ly - h} ${cx + w / 2},${ly - h} ${cx + w / 2},${ly} Z" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2"/>`,
    )
    if (b.shortest < b.refSpan) {
      // a route shorter than the reference: dashed chord under the line
      const d = 6 + 10 * Math.log10(1 + b.refSpan - b.shortest)
      parts.push(
        `<path d="M${cx - w / 2},${ly} C${cx - w / 2},${ly + d} ${cx + w / 2},${ly + d} ${cx + w / 2},${ly}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3"/>`,
      )
    }
  }
  // labels in staggered rows above the glyphs, each tied to its bubble by a
  // hairline, so a dense window stays readable
  const rowEnd = []
  const labelBase = top - 8
  for (const b of [...rows].sort((a, b) => a.start - b.start)) {
    const cls = classify(b)
    const color = KIND[cls.kind]
    const bx =
      (X(Math.max(b.start, region.start)) + X(Math.min(b.end, region.end))) / 2
    const half = cls.label.length * 3.1
    const cx = Math.min(Math.max(bx, pad + half), width - pad - half)
    let row = 0
    while ((rowEnd[row] ?? -Infinity) > cx - half - 12) row++
    rowEnd[row] = cx + half
    const y = labelBase + row * 15
    parts.push(
      `<text x="${cx}" y="${y}" font-size="11" fill="${color}" text-anchor="middle">${esc(cls.label)}</text>`,
    )
    parts.push(
      `<line x1="${bx}" x2="${bx}" y1="${y + 4}" y2="${ly - H(b.longest) - 2}" stroke="${color}" stroke-width="0.7" stroke-opacity="0.5"/>`,
    )
  }
  parts.push('</svg>')
  writeFileSync(out, parts.join('\n'))
  execFileSync('rsvg-convert', ['-o', out.replace(/\.svg$/, '.png'), out])
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [bed, chrom, start, end, out, title] = process.argv.slice(2)
  const region = { start: +start, end: +end }
  const rows = readBubbles(bed, chrom, region.start, region.end)
  for (const b of rows)
    console.log(
      `${b.start}-${b.end}\t${b.segments} segs\t${b.paths} routes\t${b.shortest}-${b.longest} bp\t${classify(b).label}`,
    )
  renderVariantMap(rows, region, out, { title: title ?? '' })
}
