// Does the graph-derived decomposition account for every haplotype's extra
// sequence? For each walk, sum (bp through bubble - reference span) over all
// derived bubbles and compare with the walk's total length minus the
// reference length over the same window.
//   node validate-decomp.mjs <gfa> <refPrefix> <start> <end>
import { readGfa, cutWindow, isBackbone } from './gfa.mjs'
import { decompose } from './graphBubbles.mjs'

const [file, ref, start, end] = process.argv.slice(2)
let g = readGfa(file, { referencePath: ref })
if (start !== 'all') g = cutWindow(g, +start, +end)
const byId = new Map(g.nodes.map(n => [n.id, n]))
const { bubbles } = decompose(g)
const nameOf = n => n.split('#').slice(0, 2).join('#')
const perWalk = new Map()
for (const b of bubbles) {
  const startId = g.nodes.find(n => n.name === b.ids[0]).id
  const endId = g.nodes.find(n => n.name === b.ids.at(-1)).id
  for (const p of g.paths) {
    const i0 = p.nodeIds.indexOf(startId),
      i1 = p.nodeIds.indexOf(endId)
    if (i0 < 0 || i1 < 0) continue
    const [a, c] = i0 < i1 ? [i0, i1] : [i1, i0]
    const bp = p.nodeIds
      .slice(a + 1, c)
      .reduce((s, id) => s + byId.get(id).length, 0)
    const key = nameOf(p.name)
    perWalk.set(key, (perWalk.get(key) ?? 0) + (bp - b.refSpan))
  }
}
const refLen = g.nodes.filter(isBackbone).reduce((s, n) => s + n.length, 0)
console.log(`bubbles ${bubbles.length}, reference bp in window ${refLen}`)
for (const p of g.paths) {
  const total = p.nodeIds.reduce((s, id) => s + byId.get(id).length, 0)
  const key = nameOf(p.name)
  console.log(
    `${key}\twalk ${(total / 1000).toFixed(1)} kb\textra vs reference ${((total - refLen) / 1000).toFixed(1)} kb\tsum over bubbles ${((perWalk.get(key) ?? 0) / 1000).toFixed(1)} kb`,
  )
}
