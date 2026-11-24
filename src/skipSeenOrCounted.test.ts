import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { deletionDrawing, deletionEdges } from './deletionEdges'
import { figureScene } from './figureScene'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { drawnMarks, graphKey } from './graphKey'
import { layoutEngine } from './layoutEngines'
import { anchorGraph } from './pathAnchoring'
import {
  engineSettingsOf,
  fitTransform,
  forceLayout,
  loadGraph,
} from './pipeline'
import { buildGeometry } from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { axisScaleOf } from './viewport'

import type { DeletionEdge } from './deletionEdges'
import type { GraphTables } from './gfa/graphTables'
import type { SmallSites } from './levelOfDetail'
import type { RenderBatch } from './renderer/types'
import type { Graph, NodeSegment } from './types'

const bases = (bp: number) => 'A'.repeat(bp)
const FLANK = 40_000
const MODES: SmallSites[] = ['hidden', 'nodes']

// 8 haplotypes beside the reference, `carriers` of them skipping r2, whose
// middle the layout lays `bow` units off the line between its ends
function site(bp: number, carriers: number, bow: number) {
  const graph = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          `S\tr1\t${bases(FLANK)}`,
          `S\tr2\t${bases(bp)}`,
          `S\tr3\t${bases(FLANK)}`,
          'L\tr1\t+\tr2\t+\t0M',
          'L\tr2\t+\tr3\t+\t0M',
          'L\tr1\t+\tr3\t+\t0M',
          `W\tref\t0\tchr\t0\t${2 * FLANK + bp}\t>r1>r2>r3`,
          ...Array.from(
            { length: 8 },
            (_, i) =>
              `W\th${i}\t1\tchr\t0\t*\t${i < carriers ? '>r1>r3' : '>r1>r2>r3'}`,
          ),
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const positions: Record<string, NodeSegment[]> = {
    'r1+': [
      { x: 0, y: 0 },
      { x: FLANK, y: 0 },
    ],
    'r2+': [
      { x: FLANK, y: 0 },
      { x: FLANK + bp / 2, y: bow },
      { x: FLANK + bp, y: 0 },
    ],
    'r3+': [
      { x: FLANK + bp, y: 0 },
      { x: 2 * FLANK + bp, y: 0 },
    ],
  }
  return { graph, positions }
}

// each skip of a drawing as its key accounts for it: drawn dashed over the
// nodes, or counted in the not-drawn line, whose bp every counted skip is under
function accountOf(
  graph: Graph,
  layout: { nodePositions: Record<string, NodeSegment[]> },
  batch: RenderBatch,
  skips: DeletionEdge[],
) {
  const marks = drawnMarks([batch])
  const line = graphKey(graph, layout, { marks })
    .find(section => section.id === 'too-small')
    ?.entries.map(entry => entry.text)
    .join(' ')
  const under = Number(
    /under ([\d,]+) bp/.exec(line ?? '')?.[1]?.replaceAll(',', '') ?? 0,
  )
  return skips.map(d => {
    const run = batch.edgeCurveRuns.get(d.edgeIndex)
    const stroke = run ? batch.edgeCurves[run.start] : undefined
    return {
      at: `${d.refName}:${d.start}`,
      bp: d.bp,
      dashed: stroke?.skip === true && stroke.dashed === true,
      counted: marks.foldedSkips.has(d.edgeIndex),
      under,
    }
  })
}

const isTyped = (
  value: unknown,
): value is { typed: string; values: (number | null)[] } =>
  typeof value === 'object' &&
  value !== null &&
  'typed' in value &&
  typeof value.typed === 'string' &&
  'values' in value &&
  Array.isArray(value.values)

const typedArrays: Record<string, (values: number[]) => ArrayLike<number>> = {
  Int32Array: values => Int32Array.from(values),
  Float64Array: values => Float64Array.from(values),
  Uint8Array: values => Uint8Array.from(values),
}

const revive = (_key: string, value: unknown) => {
  const make = isTyped(value) ? typedArrays[value.typed] : undefined
  return isTyped(value) && make ? make(value.values.map(v => v ?? NaN)) : value
}

// the hosted HPRC walks' cut of chr2:90,391,794-90,397,920 with eight
// haplotypes, as graph-walks reads it
function hostedWindow() {
  const fixture: { refName: string; tables: GraphTables } = JSON.parse(
    gunzipSync(
      readFileSync(
        join(__dirname, '../test_data/hosted/sv-mul-1k-10k.tables.json.gz'),
      ),
    ).toString(),
    revive,
  )
  return loadGraph(fixture.tables, fixture.refName, {
    referencePath: 'GRCh38',
  })
}

describe('every skip is drawn dashed over the nodes or counted in the key, never neither and never both', () => {
  test.each([0, 1.5, 2.5])(
    'a 475 bp skip whose skipped node bows %d px off its chord, at every span from 2 to 19 px, every share of walks and either small-sites mode',
    bowPx => {
      for (const smallSites of MODES) {
        for (const carriers of [1, 3, 5, 7]) {
          for (const px of [2, 2.9, 3.1, 4, 4.9, 5.1, 6, 8, 12, 17, 19]) {
            const scale = px / 475
            const { graph, positions } = site(475, carriers, bowPx / scale)
            const drawing = deletionDrawing(graph, deletionEdges(graph), true)
            const batch = buildGeometry({
              ...layoutGeometryInputs({ nodePositions: positions }, drawing),
              graph,
              nodeById: new Map(graph.nodes.map(n => [n.id, n])),
              colorScheme: 'uniform',
              contigThickness: 6,
              connectorThickness: 2,
              drawPaths: false,
              nodeWidth: 'walks',
              edgeWidth: 'walks',
              smallSites,
              axis: { scaleX: scale, scaleY: scale },
            })
            const [skip] = accountOf(
              graph,
              { nodePositions: positions },
              batch,
              drawing.shown,
            )
            expect({
              smallSites,
              carriers,
              px,
              counted: skip!.counted,
            }).toEqual({ smallSites, carriers, px, counted: !skip!.dashed })
            expect(skip!.dashed || skip!.under > 475).toBe(true)
          }
        }
      }
    },
  )

  test('on the hosted HPRC walks at chr2:90,391,794-90,397,920, laid by FMMM, fitted to 1090 x 329 px and zoomed in twice and four times, in either small-sites mode, where each counted short skip keeps its plain link under the nodes', async () => {
    const graph = hostedWindow()
    const pane = { width: 1090, height: 329 }
    const { result: layout } = await forceLayout(
      graph,
      engineSettingsOf({ engine: 'fmmm' }),
      layoutEngine,
      pane,
    )
    for (const smallSites of MODES) {
      const scene = figureScene(graph, layout, { smallSites })
      const fit = fitTransform(scene.bounds, pane.width, pane.height, false)!
      expect(scene.drawnDeletions.shown).toHaveLength(32)
      for (const zoom of [1, 2, 4]) {
        const batch = scene.geometry(
          undefined,
          axisScaleOf(zoom * fit.scale, false),
        )
        const skips = accountOf(
          graph,
          layout,
          batch,
          scene.drawnDeletions.shown,
        )
        expect(skips.filter(s => s.dashed === s.counted)).toEqual([])
        expect(skips.filter(s => s.counted && s.bp >= s.under)).toEqual([])
        expect(batch.collapsed?.shortSkips.size).toBeGreaterThan(0)
        expect(
          Array.from(batch.collapsed?.shortSkips.keys() ?? []).filter(edge => {
            const run = batch.edgeCurveRuns.get(edge)
            const stroke = run ? batch.edgeCurves[run.start] : undefined
            return !stroke || stroke.skip || stroke.along
          }),
        ).toEqual([])
      }
    }
  }, 120_000)
})
