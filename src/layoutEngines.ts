import { stressLayout } from './layout/stressEngine'
import loadBandage from './loadBandage'

import type { LayoutEngine } from './pipeline'

// Runs whichever engine a request names: the Bandage wasm module, loaded on
// first use, or the stress layout. What a worker or a CLI hands `forceLayout`.
export const layoutEngine: LayoutEngine = async request => {
  const start = performance.now()
  if (request.options.engine === 'stress') {
    const result = stressLayout(request)
    return { result, duration: performance.now() - start }
  }
  const bandage = await loadBandage()
  const result = bandage.computeLayout(request.graph, request.options)
  return { result, duration: performance.now() - start }
}
