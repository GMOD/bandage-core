import {
  NOT_LOADED_CSS,
  computeColorSchemeRange,
  getNodeColor,
} from '../renderer/GeometryBuilder'
import { abgrToCssRgba } from '../renderer/colorBits'

import type { ResolvedColorScheme } from '../colorSchemes'
import type { ReferenceRamp } from '../renderer/GeometryBuilder'
import type { Graph } from '../types'

// Each box in the colour the force and anchored drawings give its node, so on
// the reference-position ramp a box reads against the linear view's segments.
// Uniform and grey leave the boxes clear, as sequenceTubeMap draws them, but
// for a placeholder's.
export function tubeMapNodeColors(
  graph: Graph,
  colorScheme: ResolvedColorScheme,
  referenceRamp?: ReferenceRamp,
) {
  const placeholders = graph.nodes.filter(node => node.placeholder)
  const range = computeColorSchemeRange(graph, referenceRamp)
  return colorScheme === 'uniform' || colorScheme === 'grey'
    ? placeholders.length > 0
      ? new Map(placeholders.map(node => [node.id, NOT_LOADED_CSS]))
      : undefined
    : new Map(
        graph.nodes.map((node, index) => [
          node.id,
          abgrToCssRgba(getNodeColor(node, index, colorScheme, range)),
        ]),
      )
}
