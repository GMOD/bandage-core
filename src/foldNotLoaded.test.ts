import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { loadGraph } from './pipeline'
import { foldThreads } from './threadFold'

import type { GraphTables } from './gfa/graphTables'
import type { Graph } from './types'

const isTyped = (
  value: unknown,
): value is { typed: string; values: (number | null)[] } =>
  typeof value === 'object' &&
  value !== null &&
  'typed' in value &&
  typeof value.typed === 'string' &&
  'values' in value &&
  Array.isArray(value.values)

const typedArrays: Record<string, (values: number[]) => ArrayLike<number>> = {
  Int32Array: values => Int32Array.from(values),
  Float64Array: values => Float64Array.from(values),
  Uint8Array: values => Uint8Array.from(values),
  Uint32Array: values => Uint32Array.from(values),
}

const revive = (_key: string, value: unknown) => {
  const make = isTyped(value) ? typedArrays[value.typed] : undefined
  return isTyped(value) && make ? make(value.values.map(v => v ?? NaN)) : value
}

function assertHosted(
  value: unknown,
): asserts value is { refName: string; tables: GraphTables } {
  expect(
    typeof value === 'object' &&
      value !== null &&
      'refName' in value &&
      typeof value.refName === 'string' &&
      'tables' in value &&
      typeof value.tables === 'object',
  ).toBe(true)
}

// HLA class II, chr6:32,484,416-32,514,438, as the graph track cuts the hosted
// HPRC walk file for its eight default haplotypes: at the default budgets,
// 6,419 of its 16,417 nodes stand in for stretches not loaded; expanded, every
// stretch loads
function hlaCut(mode: 'default' | 'expanded') {
  const fixture: unknown = JSON.parse(
    gunzipSync(
      readFileSync(
        join(__dirname, `../test_data/hosted/hla-ii-${mode}.tables.json.gz`),
      ),
    ).toString(),
    revive,
  )
  assertHosted(fixture)
  return loadGraph(fixture.tables, 'hla', { referencePath: 'GRCh38' })
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
