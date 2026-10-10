import { stressLayout } from './layout/stressEngine'
import loadBandage from './loadBandage'

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
      'Stress layout by stochastic gradient descent in plain JS: distances along the graph become distances on the page, so the reference reads straight and a repeat loop reads as a ring.',
  },
] as const

export type LayoutEngineKind = (typeof LAYOUT_ENGINES)[number]['value']

export const LAYOUT_ENGINE_VALUES = LAYOUT_ENGINES.map(e => e.value)

export function isLayoutEngineKind(value: unknown): value is LayoutEngineKind {
  return LAYOUT_ENGINE_VALUES.includes(value as LayoutEngineKind)
}

// Runs whichever engine a request names: the Bandage wasm module, loaded on
// first use, or the stress layout. What a worker or a CLI hands `forceLayout`.
export const layoutEngine: LayoutEngine = async request => {
  if (request.options.engine === 'stress') {
    const start = performance.now()
    const result = stressLayout(request)
    return { result, duration: performance.now() - start }
  }
  const bandage = await loadBandage()
  const start = performance.now()
  const result = bandage.computeLayout(request.graph, request.options)
  return { result, duration: performance.now() - start }
}
