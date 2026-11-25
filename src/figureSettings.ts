import { LABEL_DEFAULTS } from './graphLabels'
import { FIGURE_WIDTH_PX } from './layout/fitAssumptions'
import { ENGINE_DEFAULTS } from './pipeline'

import type { ColorScheme } from './colorSchemes'
import type { EdgeWidth } from './edgeWidths'
import type { SmallSites } from './levelOfDetail'
import type { NodeWidth } from './nodeWidths'
import type { EngineSettings } from './pipeline'

// Every setting a figure spec carries that is neither the graph, the layout
// mode nor the walks: what the engine reads, and what the renderer does.
export interface FigureSettings extends Partial<EngineSettings> {
  width?: number
  height?: number
  colorScheme?: ColorScheme
  nodeWidth?: NodeWidth
  edgeWidth?: EdgeWidth
  contigThickness?: number
  connectorThickness?: number
  // how wide a lane that states a haplotype count, a thread of a folded graph,
  // draws against nodeWidths.ts countLaneWidthPx: 1 by default, 0.4 for a lit
  // thread about a contig wide
  countLaneScale?: number
  // every node's length written on it, not only a placeholder's
  nodeLengths?: boolean
  // after a node's length, the share of the drawn haplotypes that walk it,
  // where some leave it out (graphLabels.ts labelledNodeShares)
  nodeShares?: boolean
  // 'hidden': a site too small to draw at the figure's scale is not drawn
  smallSites?: SmallSites
  // the interval the reference ramp spans where it is not the cut window
  colorDomain?: { start: number; end: number }
}

export const FIGURE_DEFAULTS: Required<Omit<FigureSettings, 'colorDomain'>> = {
  ...ENGINE_DEFAULTS,
  width: FIGURE_WIDTH_PX,
  height: 800,
  colorScheme: 'auto',
  nodeWidth: 'walks',
  edgeWidth: 'walks',
  contigThickness: 6,
  connectorThickness: 2,
  countLaneScale: 1,
  nodeLengths: LABEL_DEFAULTS.nodeLengths,
  nodeShares: false,
  smallSites: 'hidden',
}

// The pane a figure fits its drawing into, which its force layout is sized for
export function figureFit(s: Pick<FigureSettings, 'width' | 'height'>) {
  return {
    width: s.width ?? FIGURE_DEFAULTS.width,
    height: s.height ?? FIGURE_DEFAULTS.height,
  }
}

// A spec names a setting only where it differs from what bandage-figure would
// do on its own, so a spec stays short and reads as what the view changed, and
// a setting the view leaves alone cannot drift from the CLI's own reading of
// it. `colorDomain` has no default: it is a value, written whenever there is
// one.
export function figureSpecSettings(s: FigureSettings) {
  const defaults: Record<string, unknown> = FIGURE_DEFAULTS
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (v !== undefined && v !== defaults[k]) {
      out[k] = v
    }
  }
  return out
}
