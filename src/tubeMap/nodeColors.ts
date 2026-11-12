import {
  computeColorSchemeRange,
  getNodeColor,
} from '../renderer/GeometryBuilder'
import { abgrToCssRgba } from '../renderer/colorBits'

import type { ResolvedColorScheme } from '../colorSchemes'
import type { ReferenceRamp } from '../renderer/GeometryBuilder'
import type { Graph } from '../types'

// Each box in the colour the force and anchored drawings give its node, so on
// the reference-position ramp a box reads against the linear view's segments.
// Uniform and grey leave the boxes clear, as sequenceTubeMap draws them, and
// a box of steps the cut did not load is clear under every scheme.
export function tubeMapNodeColors(
  graph: Graph,
  colorScheme: ResolvedColorScheme,
  referenceRamp?: ReferenceRamp,
) {
  return colorScheme === 'uniform' || colorScheme === 'grey'
    ? undefined
    : schemeTints(graph, colorScheme, referenceRamp)
}

function schemeTints(
  graph: Graph,
  colorScheme: ResolvedColorScheme,
  referenceRamp: ReferenceRamp | undefined,
) {
  const range = computeColorSchemeRange(graph, referenceRamp)
  return new Map(
    graph.nodes.flatMap((node, index) =>
      node.placeholder
        ? []
        : [
            [
              node.id,
              abgrToCssRgba(getNodeColor(node, index, colorScheme, range)),
            ] as const,
          ],
    ),
  )
}
