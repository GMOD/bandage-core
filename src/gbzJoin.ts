// One GFA from gbz-base cuts of consecutive reference fragments. A haplotype
// bridging the gap between two fragments comes back from both cuts, each piece
// the run inside its own cut's nodes, so the two can overlap without matching.

interface Walk {
  fields: string[]
  name: string
  start: number
  end: number
}

const UNKNOWN_SAMPLE = 'unknown'

function parseWalk(line: string): Walk {
  const fields = line.split('\t')
  return {
    fields,
    name: fields.slice(1, 4).join('\t'),
    start: +fields[4]!,
    end: +fields[5]!,
  }
}

function segmentLengths(lines: string[]) {
  const lengths = new Map<string, number>()
  for (const line of lines) {
    if (line.startsWith('S\t')) {
      const [, id, sequence, ...tags] = line.split('\t')
      const ln = tags.find(tag => tag.startsWith('LN:i:'))
      lengths.set(
        id!,
        sequence === '*' && ln ? +ln.slice('LN:i:'.length) : sequence!.length,
      )
    }
  }
  return lengths
}

// `a` carried on by the steps of `b` past `a.end`, where `b` starts inside
// `a`; undefined when no step of `b` starts exactly at `a.end`, which two
// pieces of one walk always share
function extend(a: Walk, b: Walk, lengths: Map<string, number>) {
  if (b.end <= a.end) {
    return a
  }
  const steps = b.fields[6]!.match(/[<>][^<>]+/g) ?? []
  let pos = b.start
  for (const [i, step] of steps.entries()) {
    if (pos === a.end) {
      const fields = [...a.fields]
      fields[5] = String(b.end)
      fields[6] = a.fields[6]! + steps.slice(i).join('')
      return { ...a, fields, end: b.end }
    }
    const length = lengths.get(step.slice(1))
    if (pos > a.end || length === undefined) {
      return undefined
    }
    pos += length
  }
  return undefined
}

// Pieces of one walk, by start, with each overlapping pair joined into one
function joinPieces(pieces: Walk[], lengths: Map<string, number>) {
  const joined: Walk[] = []
  for (const piece of pieces.sort((a, b) => a.start - b.start)) {
    const last = joined.at(-1)
    const extended =
      last && piece.start < last.end ? extend(last, piece, lengths) : undefined
    if (extended) {
      joined[joined.length - 1] = extended
    } else {
      joined.push(piece)
    }
  }
  return joined
}

// Each segment and link once, every cut's reference walk (its first W line)
// ahead of the haplotype walks, overlapping pieces of one walk joined, and
// each cut's `unknown#N` walks numbered on from the cut before's, since gbz-base
// numbers them per cut
export function joinCuts(gfas: string[]) {
  if (gfas.length <= 1) {
    return gfas[0] ?? ''
  }
  const cuts = gfas.map(gfa => gfa.split('\n').filter(line => line !== ''))
  const ofType = (cut: string[], type: string) =>
    cut.filter(line => line.startsWith(`${type}\t`))
  const lengths = segmentLengths(cuts.flat())
  let unknownOffset = 0
  const walksByCut = cuts.map(cut => {
    const walks = ofType(cut, 'W').map(parseWalk)
    const offset = unknownOffset
    for (const walk of walks.filter(w => w.fields[1] === UNKNOWN_SAMPLE)) {
      const haplotype = +walk.fields[2]! + offset
      walk.fields[2] = String(haplotype)
      walk.name = walk.fields.slice(1, 4).join('\t')
      unknownOffset = Math.max(unknownOffset, haplotype)
    }
    return walks
  })
  const references = walksByCut.flatMap(walks => walks.slice(0, 1))
  const byName = new Map<string, Walk[]>()
  for (const walk of walksByCut.flatMap(walks => walks.slice(1))) {
    const pieces = byName.get(walk.name)
    if (pieces) {
      pieces.push(walk)
    } else {
      byName.set(walk.name, [walk])
    }
  }
  const lines = new Set([
    ...ofType(cuts[0]!, 'H'),
    ...cuts.flatMap(cut => ofType(cut, 'S')),
    ...cuts.flatMap(cut => ofType(cut, 'L')),
    ...[
      ...references,
      ...[...byName.values()].flatMap(pieces => joinPieces(pieces, lengths)),
    ].map(walk => walk.fields.join('\t')),
  ])
  return `${[...lines].join('\n')}\n`
}
