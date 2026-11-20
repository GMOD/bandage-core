import { readFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync } from 'zlib'

import { laidOutGraph } from './figureData'
import { figureScene } from './figureScene'
import { fitTransform } from './pipeline'
import { bandScale, bandWidthPx } from './renderer/walkLanes'
import { curvePointAt } from './util/geometry'
import { axisScaleOf } from './viewport'

import type { AxisScale, BezierCurve } from './util/geometry'
import type { WalkLayer } from './walkEncoding'

interface Point {
  x: number
  y: number
}

// impg's syng graph of C4, as ggbandage's syng_overlay figure draws it: a ring
// of C4 copies with a short loop at its left, the HERV-K insert, and another
// on its tail
const SYNG = gunzipSync(
  readFileSync(join(__dirname, '..', 'test_data', 'syng', 'c4.syng.gfa.gz')),
).toString()
const WALKS = ['grch38', 'HG01978#2', 'HG01952#1']

// a layout's pane, as a figure lays it out and draws it, and the share of
// that fit a browser host may draw it at, zoomed out
const VIEWS = [
  [1200, 900, 1],
  [1000, 800, 1],
  [860, 640, 1],
  [750, 550, 1],
  [640, 460, 1],
  [560, 390, 1],
  [450, 320, 1],
  [1000, 800, 0.5],
  [750, 550, 0.6],
  [560, 390, 0.65],
] as const

const layouts = new Map<string, ReturnType<typeof laidOutGraph>>()

async function drawnAt(width: number, height: number, zoom: number) {
  const spec = { width, height }
  const key = `${width}x${height}`
  const laid = layouts.get(key) ?? laidOutGraph(SYNG, 'c4', undefined, spec)
  layouts.set(key, laid)
  const { graph, layout } = await laid
  const names = [...new Set((graph.paths ?? []).map(p => p.name))]
  const walks = WALKS.flatMap(prefix =>
    names
      .filter(name => name === prefix || name.startsWith(`${prefix}#`))
      .map((walk): WalkLayer => ({ walk, color: { field: 'progress' } })),
  )
  const scene = figureScene(graph, layout, { ...spec, walks })
  const fit = fitTransform(scene.bounds, width, height, false)
  const axis = axisScaleOf((fit?.scale ?? 0) * zoom, false)
  const lift = scene.lift
  const passes = lift?.walks.map(w => w.mostPasses) ?? []
  return {
    batch: scene.geometry(lift, axis),
    routes: lift?.walks.map(w => w.route) ?? [],
    nodePositions: layout.nodePositions,
    axis,
    bandPx: bandWidthPx(passes) * bandScale(passes),
  }
}

type Drawn = Awaited<ReturnType<typeof drawnAt>>

const screenOf =
  ({ scaleX, scaleY }: AxisScale) =>
  (p: Point) => ({ x: p.x * scaleX, y: p.y * scaleY })

// how far `p` lies from a polyline, both in screen px
function pxFrom(p: Point, line: readonly Point[]) {
  let nearest = Infinity
  for (let i = 0; i < line.length; i++) {
    const a = line[i]!
    const b = line[Math.min(i + 1, line.length - 1)]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length2 = dx * dx + dy * dy
    const t =
      length2 > 0
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2),
          )
        : 0
    nearest = Math.min(
      nearest,
      Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t),
    )
  }
  return nearest
}

// Each walk's thread on each node it draws: its points and its band's middle
// there, in screen px, keyed by node, walk and visit
function nodeThreads({ batch, axis }: Drawn) {
  const yToX = axis.scaleY / axis.scaleX
  const screen = screenOf(axis)
  const threads = new Map<
    string,
    { id: string; walk: number; thread: Point[]; centre: Point[] }
  >()
  for (const [id, run] of batch.nodeStrokeRuns) {
    for (const s of batch.nodeStrokes.slice(run.start, run.start + run.count)) {
      const normals = s.normals
      if (s.walk !== undefined && normals) {
        const offsets = s.offsets ?? s.points.map(() => s.offsetX ?? 0)
        threads.set(`${id} ${s.walk} ${s.visit ?? 0}`, {
          id,
          walk: s.walk,
          thread: s.points.map(screen),
          centre: s.points.map((p, k) =>
            screen({
              x: p.x - normals[k]!.nx * offsets[k]!,
              y: p.y - (normals[k]!.ny * offsets[k]!) / yToX,
            }),
          ),
        })
      }
    }
  }
  return threads
}

// A thread follows the drawn ink of every node its walk takes, at any pane
// size or zoom: the middle of its walk's band runs within a quarter of the
// band's width of the node's drawn line, so no loop the walk takes is cut to a
// chord or pulled off its node, and whether a thread goes round a loop does
// not change with the view. A folded node draws nothing and holds no thread.
test.each(VIEWS)(
  "every thread on C4's syng graph runs along the node it walks, laid out at %i by %i px and drawn at %f of its fit",
  async (width, height, zoom) => {
    const drawn = await drawnAt(width, height, zoom)
    const screen = screenOf(drawn.axis)
    const threads = [...nodeThreads(drawn).values()]
    const strays = threads.flatMap(({ id, walk, centre }) => {
      const line = (drawn.nodePositions[id] ?? []).map(screen)
      const furthest = centre.reduce(
        (most, c) => Math.max(most, pxFrom(c, line)),
        0,
      )
      return furthest > drawn.bandPx / 4
        ? [`${id} walk ${walk}: ${furthest}`]
        : []
    })
    expect(threads.length).toBeGreaterThan(1000)
    expect(strays).toEqual([])
  },
)

// Every screen px cell over a drawing, holding how far it lies from the
// nearest drawn node or link, in px
function inkDistances({ batch, nodePositions, axis, bandPx }: Drawn) {
  const screen = screenOf(axis)
  const folded = batch.collapsed?.nodes
  const ink: Point[][] = []
  for (const [id, line] of Object.entries(nodePositions)) {
    if (!folded?.has(id)) {
      ink.push(line.map(screen))
    }
  }
  for (const { walk, curves } of batch.edgeCurves) {
    if (walk === undefined) {
      ink.push(sampled(curves).map(screen))
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const line of ink) {
    for (const p of line) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  const margin = 2 * bandPx
  const x0 = Math.floor(minX - margin)
  const y0 = Math.floor(minY - margin)
  const w = Math.ceil(maxX + margin) - x0
  const h = Math.ceil(maxY + margin) - y0
  const far = new Float64Array(w * h).fill(Infinity)
  for (const line of ink) {
    for (let i = 0; i < line.length; i++) {
      const a = line[i]!
      const b = line[Math.min(i + 1, line.length - 1)]!
      const steps = Math.ceil(2 * Math.hypot(b.x - a.x, b.y - a.y)) + 1
      for (let k = 0; k <= steps; k++) {
        const x = Math.floor(a.x + ((b.x - a.x) * k) / steps) - x0
        const y = Math.floor(a.y + ((b.y - a.y) * k) / steps) - y0
        far[y * w + x] = 0
      }
    }
  }
  // each cell takes the nearest of its neighbours behind it in a sweep, plus
  // the step to it, sweeping forward and then back
  const relax = (x: number, y: number, behind: readonly number[][]) => {
    for (const [dx, dy, cost] of behind) {
      const nx = x + dx!
      const ny = y + dy!
      far[y * w + x] =
        nx >= 0 && nx < w && ny >= 0 && ny < h
          ? Math.min(far[y * w + x]!, far[ny * w + nx]! + cost!)
          : far[y * w + x]!
    }
  }
  const before = [
    [-1, 0, 1],
    [0, -1, 1],
    [-1, -1, Math.SQRT2],
    [1, -1, Math.SQRT2],
  ]
  const after = before.map(([dx, dy, cost]) => [-dx!, -dy!, cost!])
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      relax(x, y, before)
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      relax(x, y, after)
    }
  }
  return (p: Point) => {
    const x = Math.floor(p.x) - x0
    const y = Math.floor(p.y) - y0
    return x >= 0 && x < w && y >= 0 && y < h ? far[y * w + x]! : Infinity
  }
}

function sampled(curves: readonly BezierCurve[]) {
  return curves.flatMap(c =>
    Array.from({ length: 9 }, (_, k) => curvePointAt(c, k / 8)),
  )
}

// A thread follows the drawn ink of every link its walk takes too: a lane
// along a link, or through a run of folded sites along the run as it is
// drawn, keeps within three quarters of its band of a drawn node or link,
// its band's half plus the quarter its middle may stray
test.each(VIEWS)(
  "every thread on C4's syng graph runs along the links it walks, laid out at %i by %i px and drawn at %f of its fit",
  async (width, height, zoom) => {
    const drawn = await drawnAt(width, height, zoom)
    const screen = screenOf(drawn.axis)
    const fromInk = inkDistances(drawn)
    const reach = (3 * drawn.bandPx) / 4 + 1.5
    let lanes = 0
    const strays: string[] = []
    for (const { walk, curves } of drawn.batch.edgeCurves) {
      if (walk !== undefined) {
        lanes++
        const furthest = sampled(curves)
          .map(screen)
          .reduce((most, p) => Math.max(most, fromInk(p)), 0)
        if (furthest > reach) {
          strays.push(`walk ${walk}: ${furthest}`)
        }
      }
    }
    expect(lanes).toBeGreaterThan(1000)
    expect(strays).toEqual([])
  },
)

// Each thread, node after node in the order its walk takes them; a node with
// no thread of the walk's visit, folded or not drawn, breaks it
function threadsAlongWalks(drawn: Drawn) {
  const byVisit = nodeThreads(drawn)
  return drawn.routes.flatMap((pieces, walk) => {
    const visits = new Map<string, number>()
    const stretches: { thread: Point[]; centre: Point[] }[] = []
    for (const piece of pieces) {
      let open: { thread: Point[]; centre: Point[] } | undefined
      for (const id of piece) {
        const visit = visits.get(id) ?? 0
        visits.set(id, visit + 1)
        const stroke = byVisit.get(`${id} ${walk} ${visit}`)
        const last = open?.centre.at(-1)
        const turned =
          !!stroke &&
          !!last &&
          pxFrom(last, [stroke.centre.at(-1)!]) <
            pxFrom(last, [stroke.centre[0]!])
        const thread = turned ? stroke.thread.toReversed() : stroke?.thread
        const centre = turned ? stroke.centre.toReversed() : stroke?.centre
        if (open && thread && centre) {
          for (let k = 0; k < thread.length; k++) {
            open.thread.push(thread[k]!)
            open.centre.push(centre[k]!)
          }
        } else if (thread && centre) {
          open = { thread: thread.slice(), centre: centre.slice() }
          stretches.push(open)
        } else {
          open = undefined
        }
      }
    }
    return stretches.map(stretch => ({ walk, ...stretch }))
  })
}

// A thread runs the way its walk does, even round the inside of a turn
// tighter than its band: along its walk, over each node and the short link to
// the next, it never runs back against its band's middle, short steps of it
// added up, by as much as half a px
test.each(VIEWS)(
  "no thread on C4's syng graph folds back on its walk, laid out at %i by %i px and drawn at %f of its fit",
  async (width, height, zoom) => {
    const drawn = await drawnAt(width, height, zoom)
    const back: string[] = []
    for (const { walk, thread, centre } of threadsAlongWalks(drawn)) {
      let backwards = 0
      for (let k = 1; k < thread.length; k++) {
        const cx = centre[k]!.x - centre[k - 1]!.x
        const cy = centre[k]!.y - centre[k - 1]!.y
        const length = Math.hypot(cx, cy)
        const along =
          length > 0 && length < drawn.bandPx
            ? ((thread[k]!.x - thread[k - 1]!.x) * cx +
                (thread[k]!.y - thread[k - 1]!.y) * cy) /
              length
            : 0
        backwards = along < 0 ? backwards + along : 0
        if (backwards < -0.5) {
          back.push(
            `walk ${walk} at ${Math.round(thread[k]!.x)},${Math.round(thread[k]!.y)}: ${backwards}`,
          )
        }
      }
    }
    expect(back).toEqual([])
  },
)
