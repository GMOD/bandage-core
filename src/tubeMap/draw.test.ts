import fs from 'fs'
import path from 'path'

import { trackColors, tubeMapPicture } from './draw'
import { FORWARD_READ_COLORS, REVERSE_READ_COLORS } from './reads'
import { parseGaf } from '../gaf/parseGaf'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { tubeMapLayout } from '../layout/tubeMapLayout'
import { anchorGraph } from '../pathAnchoring'

const dir = path.join(__dirname, '../../test_data/cactus')
const GFA = fs.readFileSync(path.join(dir, 'cactus_240_280.gfa'), 'utf8')
const GAF = fs.readFileSync(path.join(dir, 'cactus_240_280.gaf'), 'utf8')

function drawing() {
  const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')
  return tubeMapLayout({ ...graph, reads: parseGaf(GAF) })!.tubeMap!
}

test('a haplotype takes its path colour and a read its strand palette', () => {
  const { layout, pathColors } = drawing()
  const colors = trackColors(layout, pathColors)
  for (const track of layout.tracks) {
    const palette = track.is_reverse ? REVERSE_READ_COLORS : FORWARD_READ_COLORS
    expect(colors.get(track.id)).toBe(
      track.type === 'read'
        ? palette[track.id % palette.length]
        : pathColors[track.id],
    )
  }
})

test('every shape is filled from the colour of the track it names', () => {
  const tubeMap = {
    ...drawing(),
    pathColors: ['#000001', '#000002', '#000003'],
  }
  const { layout } = tubeMap
  const colors = trackColors(layout, tubeMap.pathColors)
  const [haplotypes, reads] = tubeMapPicture(tubeMap).layers
  const fills = (type: string) =>
    [...layout.shapes.rectangles, ...layout.shapes.verticalRectangles]
      .filter(r => r.type === type)
      .map(r => colors.get(r.id))
  expect(haplotypes!.rects.map(r => r.color)).toEqual(fills('haplotype'))
  expect(reads!.rects.map(r => r.color)).toEqual(fills('read'))
  expect(haplotypes!.shapes.length).toBeGreaterThan(0)
  for (const shape of haplotypes!.shapes) {
    expect(shape.color).toBe(tubeMap.pathColors[shape.track!])
  }
  const readPalette = [...FORWARD_READ_COLORS, ...REVERSE_READ_COLORS]
  expect(reads!.shapes.length).toBeGreaterThan(0)
  for (const shape of reads!.shapes) {
    expect(readPalette).toContain(shape.color)
  }
})
