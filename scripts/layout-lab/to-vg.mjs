// gfa window -> vg JSON for the sequence tube map (reference path first)
import { writeFileSync } from 'node:fs'
import { readGfa, cutWindow } from './gfa.mjs'
const [file, out, ref, win] = process.argv.slice(2)
let g = readGfa(file, { referencePath: ref })
if (win) {
  const [s, e] = win.split('-').map(Number)
  g = cutWindow(g, s, e)
}
const num = new Map(g.nodes.map((n, i) => [n.id, i + 1]))
const vg = {
  node: g.nodes.map(n => ({
    id: num.get(n.id),
    sequence: 'N'.repeat(Math.max(1, n.length)),
  })),
  edge: g.edges.map(e => ({ from: num.get(e.from), to: num.get(e.to) })),
  path: [...g.paths]
    .sort((a, b) =>
      a.name === g.referencePath ? -1 : b.name === g.referencePath ? 1 : 0,
    )
    .map(p => ({
      name: p.name,
      mapping: p.nodeIds.map((id, i) => ({
        position: {
          node_id: num.get(id),
          ...(p.strands[i] === '-' ? { is_reverse: true } : {}),
        },
        edit: [{ from_length: 1, to_length: 1 }],
      })),
    })),
}
writeFileSync(out, JSON.stringify(vg))
console.log(`${g.nodes.length} nodes, ${g.paths.length} paths -> ${out}`)
