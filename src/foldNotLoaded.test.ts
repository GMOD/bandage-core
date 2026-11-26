import { hostedTables } from '../test_data/hosted/hostedTables'
import { loadGraph } from './pipeline'
import { foldThreads } from './threadFold'

import type { Graph } from './types'

// HLA class II, chr6:32,484,416-32,514,438, as the graph track cuts the hosted
// HPRC walk file for its eight default haplotypes: at the default budgets,
// 6,419 of its 16,417 nodes stand in for stretches not loaded; expanded, every
// stretch loads
function hlaCut(mode: 'default' | 'expanded') {
  return loadGraph(hostedTables(`hla-ii-${mode}`).tables, 'hla', {
    referencePath: 'GRCh38',
  })
}

// what a fold draws, by node name, which does not depend on the nodes a
// branch holds
function drawn(graph: Graph) {
  const nameOf = new Map(graph.nodes.map(node => [node.id, node.name]))
  return {
    nodes: graph.nodes
      .map(node => ({
        name: node.name,
        length: node.length,
        depth: node.depth,
        rank: node.stable?.rank,
        start: node.stable?.start,
        placeholder: node.placeholder === true,
        lengthSpan: node.lengthSpan,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    edges: graph.edges
      .map(
        edge =>
          `${nameOf.get(edge.from)}${edge.fromStrand} ${nameOf.get(edge.to)}${edge.toStrand} ${edge.passes}`,
      )
      .sort(),
    threads: (graph.paths ?? [])
      .map(
        path =>
          `${path.count} ${path.members?.join(',')}: ${path.nodeIds.map(id => nameOf.get(id)).join(' ')}`,
      )
      .sort(),
  }
}

// the landing review: the stack's fold of the default cut drew seven sites
// twice as hollow loops, 63 nodes, 94 links and 9 threads where the fold of
// the expanded cut, and the released fold, draw 54, 76 and 7
test('HLA-II folds the same whether its off-reference stretches were loaded or not', () => {
  const unloaded = hlaCut('default')
  const loaded = hlaCut('expanded')
  expect(unloaded.nodes.filter(node => node.placeholder)).toHaveLength(6419)
  expect(loaded.nodes.filter(node => node.placeholder)).toHaveLength(0)
  const [a, b] = [unloaded, loaded].map(cut => {
    const fold = foldThreads(cut, 236)
    expect(fold.folded).toBe(true)
    return drawn(fold.graph)
  })
  expect(a!.nodes.filter(node => node.placeholder)).toEqual([])
  expect([a!.nodes.length, a!.edges.length, a!.threads.length]).toEqual([
    54, 76, 7,
  ])
  expect(a).toEqual(b)
})

// the landing review: 927 and 935 bp in place of 3,852 bp of GRCh38 drew a
// node labelled 3.9 kb
test("HLA-II's clustered replacement of 3,852 bp spans its alleles' own 927 and 935 bp", () => {
  for (const mode of ['default', 'expanded'] as const) {
    const fold = foldThreads(hlaCut(mode), 236)
    expect(
      fold.graph.nodes.find(node => node.name.startsWith('ins:163316188:'))
        ?.lengthSpan,
    ).toEqual({ least: 927, most: 935 })
  }
})
