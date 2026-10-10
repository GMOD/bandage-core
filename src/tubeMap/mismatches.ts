import { forward, getXCoordinateOfBaseWithinNode } from '@jbrowse/tubemap-core'

import type { Track, TubeMapLayout } from '@jbrowse/tubemap-core'

// Where a read differs from the nodes it runs through, in tube coordinates:
// the marks sequenceTubeMap's drawMismatches puts on a read's tube. Each mark
// spans the bases it covers and sits on the tube of the read that carries it
// (`y` is the tube's top, `height` its width), so a painter only maps them
// through the frame.
interface MarkBase {
  readId: number
  y: number
  height: number
}

export type TubeMapMismatch =
  | (MarkBase & {
      kind: 'insertion'
      x: number
      seq?: string
      // at the read's first or last base, where an aligner clips rather than
      // inserts; sequenceTubeMap hides these unless soft clips are shown
      softClip: boolean
    })
  | (MarkBase & { kind: 'deletion'; x0: number; x1: number; length: number })
  | (MarkBase & { kind: 'substitution'; x0: number; x1: number; seq: string })

// A read's path holds one visit per entry of its sequence, in order, between
// the passes it makes over the columns it skips. Merging rewrites sequence and
// sequenceNew together, so entry i is visit i, even where a loop revisits a node.
function readMismatches(read: Track, layout: TubeMapLayout) {
  const marks: TubeMapMismatch[] = []
  const entries = read.sequenceNew ?? []
  const visits = read.path.filter(segment => segment.node !== null)
  entries.forEach((entry, i) => {
    const nodeIndex = layout.nodeMap.get(forward(entry.nodeName))
    const node = nodeIndex === undefined ? undefined : layout.nodes[nodeIndex]
    const y = visits[i]?.y
    if (node && y !== undefined) {
      const base = { readId: read.id, y, height: read.width }
      // A base past a merged node's end has no x.
      const at = (pos: number) => getXCoordinateOfBaseWithinNode(node, pos)
      for (const mm of entry.mismatches) {
        const x0 = at(mm.pos)
        if (x0 !== null) {
          if (mm.type === 'insertion') {
            const softClip =
              (i === 0 && mm.pos === read.firstNodeOffset) ||
              (i === entries.length - 1 && mm.pos === read.finalNodeCoverLength)
            marks.push({
              ...base,
              kind: 'insertion',
              x: x0,
              seq: mm.seq,
              softClip,
            })
          } else if (mm.type === 'deletion' && mm.length !== undefined) {
            const x1 = at(mm.pos + mm.length)
            if (x1 !== null) {
              marks.push({
                ...base,
                kind: 'deletion',
                x0,
                x1,
                length: mm.length,
              })
            }
          } else if (mm.type === 'substitution' && mm.seq !== undefined) {
            const x1 = at(mm.pos + mm.seq.length)
            if (x1 !== null) {
              marks.push({ ...base, kind: 'substitution', x0, x1, seq: mm.seq })
            }
          }
        }
      }
    }
  })
  return marks
}

export function tubeMapMismatches(layout: TubeMapLayout) {
  return layout.reads.flatMap(read => readMismatches(read, layout))
}
