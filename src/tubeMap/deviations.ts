import { boxX, referenceBoxes } from './axis'
import { lastAtMost } from './coarsen'
import { pathOrigin } from '../pathAnchoring'

import type { ReferenceBox } from './axis'
import type { Deviation } from './coarsen'
import type { TubeMapFrame } from './draw'
import type { TubeMapDrawing } from '../layout/tubeMapLayout'
import type { Graph } from '../types'

// A folded variant on the tube of the walk that carries it, in tube
// coordinates. Placed by bp through the box that holds it, since tubemap-core
// may merge the coarsened nodes again and a box can stand for several.
interface DeviationMark {
  x0: number
  x1: number
  y: number
  height: number
}

// The box holding `bp` that this walk passes through; an insertion on a
// boundary between two boxes sits on whichever the walk visits
function boxAt(
  boxes: readonly ReferenceBox[],
  bp: number,
  visited: Map<number, number>,
) {
  const lo = lastAtMost(boxes, box => box.bp0, bp)
  return [boxes[lo], boxes[lo - 1]].find(
    box => box && visited.has(box.index) && box.bp0 <= bp && bp <= box.bp1,
  )
}

// Piece k of a bundled path gets the variants of piece k of each member walk
function deviationsByPath(graph: Graph, deviations: Map<string, Deviation[]>) {
  const piecesOf = new Map<string, Deviation[][]>()
  for (const [name, devs] of deviations) {
    const walk = pathOrigin(name).name
    const pieces = piecesOf.get(walk)
    if (pieces) {
      pieces.push(devs)
    } else {
      piecesOf.set(walk, [devs])
    }
  }
  const seen = new Map<string, number>()
  const byPath = new Map<string, Deviation[]>()
  for (const path of graph.paths ?? []) {
    const walk = pathOrigin(path.name).name
    const piece = seen.get(walk) ?? 0
    seen.set(walk, piece + 1)
    if (path.members) {
      const union = new Map<string, Deviation>()
      for (const member of path.members) {
        for (const d of piecesOf.get(member)?.[piece] ?? []) {
          union.set(`${d.start}-${d.end}`, d)
        }
      }
      byPath.set(path.name, [...union.values()])
    } else {
      byPath.set(path.name, deviations.get(path.name) ?? [])
    }
  }
  return byPath
}

export function deviationMarks(
  drawing: Pick<TubeMapDrawing, 'graph' | 'layout'>,
  deviations: Map<string, Deviation[]>,
) {
  const { graph, layout } = drawing
  const boxes = [...referenceBoxes(drawing).values()]
    .flat()
    .sort((a, b) => a.bp0 - b.bp0)
  const byPath = deviationsByPath(graph, deviations)
  const marks: DeviationMark[] = []
  for (const track of layout.tracks) {
    const devs = track.name ? byPath.get(track.name) : undefined
    if (devs?.length) {
      // a walk that loops through a box twice marks its first pass
      const visited = new Map<number, number>()
      for (const segment of track.path) {
        if (
          segment.node !== null &&
          segment.y !== undefined &&
          !visited.has(segment.node)
        ) {
          visited.set(segment.node, segment.y)
        }
      }
      for (const d of devs) {
        const box = boxAt(boxes, d.start, visited)
        if (box) {
          marks.push({
            x0: boxX(box, d.start),
            x1: boxX(box, d.end),
            y: visited.get(box.index)!,
            height: track.width,
          })
        }
      }
    }
  }
  return marks
}

// Dark on light and light on dark, since the tubes themselves carry every hue
export function deviationInk(darkMode?: boolean) {
  return darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)'
}

// A tick at least a px wide across the tube
export function drawDeviationMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly DeviationMark[],
  { x, y, width, darkMode }: TubeMapFrame,
) {
  if (marks.length === 0) {
    return
  }
  ctx.fillStyle = deviationInk(darkMode)
  ctx.beginPath()
  for (const m of marks) {
    const left = x(m.x0)
    const right = Math.max(x(m.x1), left + 1)
    if (right >= 0 && left <= width) {
      const top = y(m.y)
      ctx.rect(left, top, right - left, y(m.y + m.height) - top)
    }
  }
  ctx.fill()
}
