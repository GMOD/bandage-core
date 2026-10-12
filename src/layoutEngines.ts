import { fmmmLayout } from '@jbrowse/graph-fmmm-layout'
import { stressLayout } from '@jbrowse/graph-stress-layout'

import type { LayoutEngine } from './pipeline'

export const LAYOUT_ENGINES = [
  {
    value: 'fmmm',
    label: 'Bandage (FMMM)',
    description:
      "Bandage's force-directed layout: OGDF's fast multipole multilevel method, compiled to wasm.",
  },
  {
    value: 'stress',
    label: 'Stress',
    description:
      'Plain JS: the reference drawn straight and each variant placed against it, an allele as a lens, a repeat loop as a ring, a deletion as an arch; stress by stochastic gradient descent for components with no reference.',
  },
] as const

export type LayoutEngineKind = (typeof LAYOUT_ENGINES)[number]['value']

export const LAYOUT_ENGINE_VALUES = LAYOUT_ENGINES.map(e => e.value)

export function isLayoutEngineKind(value: unknown): value is LayoutEngineKind {
  return LAYOUT_ENGINE_VALUES.includes(value as LayoutEngineKind)
}

// Runs whichever engine a request names: the Bandage wasm module, or the stress layout. What a worker or a CLI hands `forceLayout`.
export const layoutEngine: LayoutEngine = async request => {
  if (request.options.engine === 'stress') {
    const start = performance.now()
    const result = stressLayout(request)
    return { result, duration: performance.now() - start }
  }
  const start = performance.now()
  const result = await fmmmLayout(request)
  return { result, duration: performance.now() - start }
}
