// What the force engine's `quality` means to a reader, as one table behind
// every app's dropdown: more quality is more of the engine's iterations, so the
// scale is the trade it makes. The default is ENGINE_DEFAULTS.quality.
export const LAYOUT_QUALITIES = [
  { value: 0, label: 'Fastest' },
  { value: 1, label: 'Fast' },
  { value: 2, label: 'Default' },
  { value: 3, label: 'Fine' },
  { value: 4, label: 'Best' },
] as const

export type LayoutQuality = (typeof LAYOUT_QUALITIES)[number]['value']
