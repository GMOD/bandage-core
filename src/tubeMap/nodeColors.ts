import { abgrToCssRgba } from '@jbrowse/core/util/colorBits'

import {
  computeColorSchemeRange,
  getNodeColor,
} from '../renderer/GeometryBuilder'

import type { ResolvedColorScheme } from '../colorSchemes'
import type { ReferenceRamp } from '../renderer/GeometryBuilder'
import type { Graph } from '../types'

// Each box in the colour the force and anchored drawings give its node, so on
// the reference-position ramp a box reads against the linear view's segments.
// Uniform and grey leave the boxes clear, as sequenceTubeMap draws them.
export function tubeMapNodeColors(
  graph: Graph,
  colorScheme: ResolvedColorScheme,
  referenceRamp?: ReferenceRamp,
) {
  if (colorScheme === 'uniform' || colorScheme === 'grey') {
    return undefined
  }
  const range = { ...computeColorSchemeRange(graph), referenceRamp }
  return new Map(
    graph.nodes.map((node, index) => [
      node.id,
      abgrToCssRgba(getNodeColor(node, index, colorScheme, range)),
    ]),
  )
}
