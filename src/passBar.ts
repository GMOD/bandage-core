import { el } from './el'
import { formatBp } from './graphLabels'
import { abgrHex } from './renderer/colorBits'
import { passInk } from './walkPasses'

import type { WalkLift } from './walkHighlight'

export interface PassBar {
  walk: string
  bp: number
  ownInk: number
  runs: { pass: number; start: number; end: number; ink: number }[]
  passes: {
    pass: number
    start: number
    end: number
    repeatBp: number
    againBp: number
    reversedBp: number
    text: string
    ink: number
    reversed: boolean
  }[]
  bundled: boolean
}

export function passBars(lift: WalkLift | undefined) {
  return (lift?.walks ?? []).flatMap(walk => {
    const drawn = walk.walkPasses
    return drawn?.passes.length
      ? [
          {
            walk: walk.name,
            bp: walk.range ? walk.range.end - walk.range.start : walk.bp,
            ownInk: drawn.ownInk,
            runs: drawn.runs.map(run => ({
              ...run,
              ink: passInk(drawn, run.pass),
            })),
            passes: drawn.passes.map((pass, i) => ({
              pass: i,
              start: pass.start,
              end: pass.end,
              repeatBp: pass.repeatBp,
              againBp: pass.againBp,
              reversedBp: pass.reversedBp,
              text: drawn.bundled ? `${i + 1}` : pass.title,
              ink: pass.ink,
              reversed: pass.reversed,
            })),
            bundled: drawn.bundled,
          },
        ]
      : []
  })
}

const FONT = { 'font-family': 'Helvetica, Arial, sans-serif', 'font-size': 11 }
const CHAR_PX = 6.2
const SIDE_PX = 12
const TITLE_Y = 13
const EXTENT_Y = 34
const BAR_TOP = 40
const BAR_PX = 16
const TICK_PX = 4
export const PASS_BAR_HEIGHT = BAR_TOP + BAR_PX + 26

const niceStep = (span: number, most: number) => {
  const raw = span / most
  const power = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map(m => m * power).find(s => s >= raw) ?? raw
}

export function passBarTree(bar: PassBar, label: string, width: number) {
  const room = width - 2 * SIDE_PX
  const x = (bp: number) => SIDE_PX + (bar.bp > 0 ? (bp / bar.bp) * room : 0)
  const bpPerPx = room > 0 ? bar.bp / room : 1
  const merged: PassBar['runs'] = []
  for (const run of bar.runs) {
    const last = merged.at(-1)
    if (last?.pass === run.pass && run.start - last.end < bpPerPx) {
      last.end = run.end
    } else {
      merged.push({ ...run })
    }
  }
  const step = bar.bp > 0 ? niceStep(bar.bp, 8) : 1
  const ticks = Array.from(
    { length: bar.bp > 0 ? Math.floor(bar.bp / step) + 1 : 0 },
    (_, i) => i * step,
  )
  const title = el(
    'text',
    { x: SIDE_PX, y: TITLE_Y, ...FONT, 'font-weight': 'bold' },
    `${label} along its length`,
  )
  const named: { from: number; to: number }[] = []
  const brackets = bar.passes.flatMap(pass => {
    const own: { start: number; end: number }[] = []
    for (const run of bar.runs) {
      const last = own.at(-1)
      if (run.pass === pass.pass && last && run.start - last.end < bpPerPx) {
        last.end = run.end
      } else if (run.pass === pass.pass) {
        own.push({ start: run.start, end: run.end })
      }
    }
    const ink = abgrHex(pass.ink)
    const solid = own.map(run =>
      el('path', {
        d: `M${x(run.start)},${EXTENT_Y + 3}V${EXTENT_Y}H${x(run.end)}V${EXTENT_Y + 3}`,
        fill: 'none',
        stroke: ink,
        'stroke-width': 1.5,
      }),
    )
    const gaps = own
      .slice(1)
      .map(
        (run, i) =>
          `M${x(own[i]?.end ?? run.start)},${EXTENT_Y}H${x(run.start)}`,
      )
      .join('')
    const longest = own.reduce<{ start: number; end: number } | undefined>(
      (most, run) =>
        !most || run.end - run.start > most.end - most.start ? run : most,
      undefined,
    )
    const half = (pass.text.length * CHAR_PX) / 2 + 2
    const centre =
      longest &&
      Math.min(
        Math.max((x(longest.start) + x(longest.end)) / 2, half),
        width - half,
      )
    const clear =
      centre !== undefined &&
      named.every(n => centre + half <= n.from || centre - half >= n.to)
    if (clear) {
      named.push({ from: centre - half, to: centre + half })
    }
    const name =
      clear &&
      el(
        'text',
        {
          x: centre,
          y: EXTENT_Y - 3,
          ...FONT,
          'font-weight': 'bold',
          fill: ink,
          'text-anchor': 'middle',
        },
        pass.text,
      )
    const dotted = el('path', {
      d: gaps,
      fill: 'none',
      stroke: ink,
      'stroke-width': 0.75,
      'stroke-dasharray': '1 2',
    })
    return (gaps ? [dotted] : []).concat(solid, name ? [name] : [])
  })
  const ground = el('rect', {
    x: SIDE_PX,
    y: BAR_TOP,
    width: room,
    height: BAR_PX,
    fill: abgrHex(bar.ownInk),
  })
  const stretches = merged.map(run =>
    el('rect', {
      x: x(run.start),
      y: BAR_TOP,
      width: Math.max(0.5, x(run.end) - x(run.start)),
      height: BAR_PX,
      fill: abgrHex(run.ink),
    }),
  )
  const axis = ticks.flatMap(bp => [
    el('line', {
      x1: x(bp),
      x2: x(bp),
      y1: BAR_TOP + BAR_PX,
      y2: BAR_TOP + BAR_PX + TICK_PX,
      stroke: '#666',
    }),
    el(
      'text',
      {
        x: x(bp),
        y: BAR_TOP + BAR_PX + TICK_PX + 11,
        ...FONT,
        fill: '#444',
        'text-anchor': 'middle',
      },
      bp === 0 ? '0' : formatBp(bp),
    ),
  ])
  return {
    tag: 'g',
    attrs: {},
    children: [title].concat(brackets, [ground], stretches, axis),
  }
}
