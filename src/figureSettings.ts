import { LABEL_DEFAULTS } from './graphLabels'
import { FIGURE_WIDTH_PX } from './layout/fitAssumptions'
import { ENGINE_DEFAULTS } from './pipeline'

import type { ColorScheme } from './colorSchemes'
import type { EdgeWidth } from './edgeWidths'
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
  // every node's length written on it, not only a placeholder's
  nodeLengths?: boolean
  // a site too small to draw at the figure's scale drawn as a tick
  levelOfDetail?: boolean
  // the interval the reference ramp spans where it is not the cut window
  colorDomain?: { start: number; end: number }
}

export const FIGURE_DEFAULTS: Required<Omit<FigureSettings, 'colorDomain'>> = {
  ...ENGINE_DEFAULTS,
  width: FIGURE_WIDTH_PX,
  height: 800,
  colorScheme: 'auto',
  nodeWidth: 'depth',
  edgeWidth: 'uniform',
  contigThickness: 6,
  connectorThickness: 2,
  nodeLengths: LABEL_DEFAULTS.nodeLengths,
  levelOfDetail: true,
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
