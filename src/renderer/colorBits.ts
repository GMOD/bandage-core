import {
  abgrAlpha,
  abgrBlue,
  abgrGreen,
  abgrRed,
  packAbgr,
} from '@jbrowse/core/util/colorBits'

// The one ABGR helper core does not have. Everything else the renderer needs —
// the packing, the channel accessors, both css formatters — comes straight from
// `@jbrowse/core/util/colorBits`, which ReExports/list.ts now names, so the
// plugin bundle binds it to the host's copy. The plugin targets the latest
// JBrowse beta; 5.0.0-beta.4 serves that module without `packAbgr`, and the
// plugin fails to install there.

// Scale a packed color's channels, clamped at full brightness and leaving alpha
// alone. factor === 1 returns the color unchanged.
// The same colour at a fraction of its alpha, so a faded node reads as the
// same ink through it on any background.
export function fadeAbgr(c: number, alpha: number) {
  return packAbgr(
    abgrRed(c),
    abgrGreen(c),
    abgrBlue(c),
    Math.round(abgrAlpha(c) * alpha),
  )
}

export function brightenAbgr(c: number, factor: number) {
  return packAbgr(
    Math.min(255, Math.round(abgrRed(c) * factor)),
    Math.min(255, Math.round(abgrGreen(c) * factor)),
    Math.min(255, Math.round(abgrBlue(c) * factor)),
    abgrAlpha(c),
  )
}
