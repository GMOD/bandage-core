import { figureSvg } from '../../src/figure'
import { layoutModeByValue } from '../../src/layoutModes'

import type { ThreadEvent } from '../../src/threadFold'
import type { Graph } from '../../src/types'

// The walks of `names` no thread holds: those a graph's key says have a
// departure over the window and no step here
const absent = (graph: Graph, names: readonly string[]) => {
  const held = new Set(
    (graph.paths ?? []).flatMap(path => [path.name, ...(path.members ?? [])]),
  )
  return names.filter(name => !held.has(name))
}

// What a thread fold draws and says, by node name: its nodes, each link with
// its strands, threads and passes, each thread in lane order with its count,
// walks, pieces, variation and steps, the fold's own facts and its events.
// A node's `members`, the input nodes a folded node holds, is left out: a
// fold from runs has no node for a run, so it lists reference nodes alone.
// Of the walks the fold's departures name, only those no thread holds are
// kept, the ones a key can say anything of.
export function drawn(graph: Graph, events: readonly ThreadEvent[]) {
  const nameOf = new Map(graph.nodes.map(node => [node.id, node.name]))
  const named = (ids: readonly string[]) => ids.map(id => nameOf.get(id) ?? id)
  return {
    referencePath: graph.referencePath,
    anchoredBy: graph.anchoredBy,
    nodes: graph.nodes
      .map(node => ({
        id: node.id,
        length: node.length,
        depth: node.depth,
        refName: node.stable?.refName,
        rank: node.stable?.rank,
        start: node.stable?.start,
        placeholder: node.placeholder === true,
        lengthSpan: node.lengthSpan,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: graph.edges
      .map(
        edge =>
          `${nameOf.get(edge.from)}${edge.fromStrand} ${nameOf.get(edge.to)}${edge.toStrand} ${edge.passes} ${(edge.pathIds ?? []).join(',')}`,
      )
      .sort(),
    paths: (graph.paths ?? []).map(path => ({
      name: path.name,
      start: path.start,
      count: path.count,
      members: path.members,
      pieces: path.pieces,
      variation: path.variation,
      steps: named(path.nodeIds).join(' '),
    })),
    threadFold: graph.threadFold && {
      ...graph.threadFold,
      departing: absent(graph, graph.threadFold.departing),
    },
    events: events.map(event => ({
      ...event,
      nodeIds: named(event.nodeIds),
      from: event.from === undefined ? undefined : nameOf.get(event.from),
      to: event.to === undefined ? undefined : nameOf.get(event.to),
    })),
  }
}

// The figure of a fold under the ordered layout
export function orderedFigure(graph: Graph) {
  const layout = layoutModeByValue('ordered').run(graph, undefined)
  return layout ? figureSvg(graph, layout, { width: 1600 }) : ''
}

// The first place two values differ, as a path into them and each side
export function firstDifference(
  a: unknown,
  b: unknown,
  path = '',
): string | undefined {
  const text = (value: unknown) => JSON.stringify(value)?.slice(0, 240)
  const keys = (value: object) => Object.keys(value)
  return text(a) === text(b) && JSON.stringify(a) === JSON.stringify(b)
    ? undefined
    : a !== null &&
        b !== null &&
        typeof a === 'object' &&
        typeof b === 'object'
      ? ([...new Set([...keys(a), ...keys(b)])]
          .map(key =>
            firstDifference(
              Reflect.get(a, key),
              Reflect.get(b, key),
              `${path}.${key}`,
            ),
          )
          .find(found => found !== undefined) ??
        `${path}: ${text(a)} against ${text(b)}`)
      : `${path}: ${text(a)} against ${text(b)}`
}
