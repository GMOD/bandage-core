// How much sequence each haplotype carries through a window of a path GFA, and
// per-node carriage. At base level (Minigraph-Cactus) a repeat array does not
// revisit reference nodes, so "copies" is not a visit count: it is the bp a
// walk spends between the flanking reference nodes, divided by the repeat unit.
//
//   node copycount.mjs <gfa> <refPathPrefix> <start> <end> <unitBp> [out.svg]
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readGfa } from './gfa.mjs'

const [file, ref, start, end, unitArg, out] = process.argv.slice(2)
const unit = Number(unitArg)
const g = readGfa(file, { referencePath: ref })
const byId = new Map(g.nodes.map(n => [n.id, n]))
const refPath = g.paths.find(p => p.name === g.referencePath)
// flanking reference nodes: last one ending at or before start, first one
// starting at or after end
let pos = refPath.start
let before = null,
  after = null
for (const id of refPath.nodeIds) {
  const len = byId.get(id).length
  if (pos + len <= +start) before = id
  if (after === null && pos >= +end) after = id
  pos += len
}
console.log(`flanks: ${before} .. ${after}`)
const rows = []
for (const p of g.paths) {
  const i0 = p.nodeIds.indexOf(before)
  const i1 = p.nodeIds.indexOf(after)
  let bp = 0
  let complete = i0 >= 0 && i1 >= 0
  if (complete) {
    const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0]
    for (let i = a + 1; i < b; i++) bp += byId.get(p.nodeIds[i]).length
  } else {
    bp = p.nodeIds.reduce((s, id) => s + byId.get(id).length, 0)
  }
  rows.push({
    name: p.name.split('#').slice(0, 2).join('#'),
    bp,
    complete,
    copies: bp / unit,
  })
}
rows.sort((a, b) => b.bp - a.bp)
for (const r of rows)
  console.log(
    `${r.name}\t${(r.bp / 1000).toFixed(1)} kb\t≈ ${r.copies.toFixed(1)} units${r.complete ? '' : ' (walk does not reach both flanks; whole walk counted)'}`,
  )

const carriage = new Map()
for (const p of g.paths)
  for (const id of new Set(p.nodeIds))
    carriage.set(id, (carriage.get(id) ?? 0) + 1)
const hist = new Map()
for (const v of carriage.values()) hist.set(v, (hist.get(v) ?? 0) + 1)
console.log(
  'nodes by number of haplotypes carrying them:',
  [...hist]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`)
    .join(' '),
)

if (out) {
  const w = 900,
    rowH = 26,
    pad = 30,
    labelW = 130
  const h = pad * 2 + rows.length * rowH + 30
  const max = Math.max(...rows.map(r => r.bp))
  const X = bp => labelW + (bp / max) * (w - labelW - pad - 80)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="sans-serif" font-size="12">`,
    '<rect width="100%" height="100%" fill="white"/>',
  ]
  parts.push(
    `<text x="${pad}" y="20" font-size="14" fill="#222">Sequence carried through the KIV-2 array, per haplotype (unit ${unit} bp)</text>`,
  )
  rows.forEach((r, i) => {
    const y = pad + 14 + i * rowH
    const isRef = r.name.startsWith(ref)
    parts.push(
      `<text x="${labelW - 8}" y="${y + 13}" text-anchor="end" fill="${isRef ? '#2f8fd6' : '#333'}" font-weight="${isRef ? 'bold' : 'normal'}">${r.name}</text>`,
    )
    // one block per unit, so copies are countable
    const units = Math.round(r.copies)
    for (let k = 0; k < units; k++) {
      const x0 = X(k * unit),
        x1 = X(Math.min((k + 1) * unit, r.bp))
      parts.push(
        `<rect x="${x0}" y="${y}" width="${Math.max(1, x1 - x0 - 1.5)}" height="18" fill="${isRef ? '#2f8fd6' : '#8e3fbf'}" opacity="${0.55 + 0.45 * (k % 2 === 0)}"/>`,
      )
    }
    parts.push(
      `<text x="${X(r.bp) + 8}" y="${y + 13}" fill="#333">${(r.bp / 1000).toFixed(0)} kb ≈ ${units} units</text>`,
    )
  })
  parts.push('</svg>')
  writeFileSync(out, parts.join('\n'))
  execFileSync('rsvg-convert', ['-o', out.replace(/\.svg$/, '.png'), out])
}
