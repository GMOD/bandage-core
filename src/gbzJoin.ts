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

const stepsOf = (walk: Walk) => walk.fields[6]!.match(/[<>][^<>]+/g) ?? []

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

// `a` carried on by the steps of `b` past `a.end`, where `b` starts inside or
// at the end of `a`; undefined when no step of `b` starts exactly at `a.end`,
// which two pieces of one walk always share
function extend(a: Walk, b: Walk, lengths: Map<string, number>) {
  if (b.end <= a.end) {
    return a
  }
  const steps = stepsOf(b)
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

// Whether the graph has an edge from one walk step (`>5`) to the next (`<8`)
export type HasEdge = (from: string, to: string) => Promise<boolean>

// Pieces of one walk, by start, with each pair that overlaps joined into one,
// and each pair that meets where the graph links them: a haplotype split into
// two paths at one coordinate meets there with no edge between them
async function joinPieces(
  pieces: Walk[],
  lengths: Map<string, number>,
  hasEdge: HasEdge,
) {
  const joined: Walk[] = []
  for (const piece of pieces.sort((a, b) => a.start - b.start)) {
    const last = joined.at(-1)
    const joins =
      last !== undefined &&
      (piece.start < last.end ||
        (piece.start === last.end &&
          (await hasEdge(stepsOf(last).at(-1)!, stepsOf(piece)[0]!))))
    const extended = joins ? extend(last, piece, lengths) : undefined
    if (extended) {
      joined[joined.length - 1] = extended
    } else {
      joined.push(piece)
    }
  }
  return joined
}

const flip = (sign: string) => (sign === '+' ? '-' : '+')

// The link each step of a walk takes, in both of the ways an L line can write
// it. Where two pieces met in no cut's nodes, no cut wrote the link between
// them.
function* stepLinks(walk: Walk) {
  const steps = stepsOf(walk).map(step => ({
    id: step.slice(1),
    sign: step.startsWith('>') ? '+' : '-',
  }))
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1]!
    const b = steps[i]!
    yield {
      forward: `L\t${a.id}\t${a.sign}\t${b.id}\t${b.sign}\t0M`,
      reverse: `L\t${b.id}\t${flip(b.sign)}\t${a.id}\t${flip(a.sign)}\t0M`,
    }
  }
}

// Each segment and link once, every cut's reference walk (its first W line)
// ahead of the haplotype walks, the pieces of each walk joined, the
// reference's among them since a cut's context can reach the other fragment,
// and each cut's `unknown#N` walks numbered on from the cut before's, since
// gbz-base numbers them per cut. Unnamed walks start every cut at 0, so their
// pieces cannot be joined.
export async function joinCuts(gfas: string[], hasEdge: HasEdge) {
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
  const byName = new Map<string, Walk[]>()
  for (const walk of [
    ...walksByCut.flatMap(walks => walks.slice(0, 1)),
    ...walksByCut.flatMap(walks => walks.slice(1)),
  ]) {
    const pieces = byName.get(walk.name)
    if (pieces) {
      pieces.push(walk)
    } else {
      byName.set(walk.name, [walk])
    }
  }
  const walks = (
    await Promise.all(
      [...byName.values()].map(pieces => joinPieces(pieces, lengths, hasEdge)),
    )
  ).flat()
  const links = new Set(cuts.flatMap(cut => ofType(cut, 'L')))
  for (const walk of walks) {
    for (const link of stepLinks(walk)) {
      if (!links.has(link.forward) && !links.has(link.reverse)) {
        links.add(link.forward)
      }
    }
  }
  const lines = new Set([
    ...ofType(cuts[0]!, 'H'),
    ...cuts.flatMap(cut => ofType(cut, 'S')),
    ...links,
    ...walks.map(walk => walk.fields.join('\t')),
  ])
  return `${[...lines].join('\n')}\n`
}
