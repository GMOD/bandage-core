import { panSNHaplotype, panSNSample } from '../pansn'
import { pathOrigin } from '../pathAnchoring'

import type { GenePin } from './genePins'

// An identifier standing in where a gene has no symbol: an Ensembl stable id
// (ENSG00000289697, ENSMUSG…, with or without its version, and the _PAR_Y of
// a copy on Y's pseudoautosomal regions), NCBI's LOC and RefSeq accessions
// (LOC105378878, NR_046018), with or without a version, each with or without
// the `gene-` a GFF3 ID puts before it, or the `chr1:101-200` a BED row with
// no name is given
const ACCESSION =
  /^(?:gene-)?(?:ENS[A-Z]*[GT]\d{6,}(?:\.\d+)?(?:_PAR_Y)?|LOC\d+(?:\.\d+)?|[NX][MR]_\d+(?:\.\d+)?|\S+:\d+-\d+)$/

export function hasGeneSymbol(name: string) {
  return name.trim() !== '' && !ACCESSION.test(name)
}

// The ones a drawing may name: those with a symbol, or every one where none
// has
export function nameable<T>(items: readonly T[], nameOf: (item: T) => string) {
  const symbolled = items.filter(item => hasGeneSymbol(nameOf(item)))
  return symbolled.length > 0 ? symbolled : items
}

export interface NamedGenePin {
  pin: GenePin
  // the chip's words before any note of how much of the gene is drawn
  name: string
}

const haplotypeOf = (refName: string) =>
  panSNHaplotype(refName) ?? panSNSample(refName)

const whose = (pin: GenePin) =>
  `${pin.gene.name} · ${haplotypeOf(pin.gene.refName)}`

// The genes over a node, for its hover: every one, named or not, a copy off
// the reference with its haplotype
export function genesOverNode(pins: readonly GenePin[], nodeId: string) {
  return pins.flatMap(pin =>
    pin.nodeIds.has(nodeId)
      ? [pin.onReference ? pin.gene.name : whose(pin)]
      : [],
  )
}

// Of two copies of a gene off the reference, the one more shown walks step,
// then the one on the contig whose name sorts first, then the one starting
// first on it
function carriedBefore(a: GenePin, b: GenePin) {
  return a.walks !== b.walks
    ? a.walks > b.walks
    : a.gene.refName !== b.gene.refName
      ? a.gene.refName < b.gene.refName
      : a.gene.start < b.gene.start
}

// Which genes a drawing names, and how. A copy on the reference whose
// stretch the drawn nodes anchored on it mostly do not hold is named nowhere:
// its sequence is drawn where an earlier copy the reference passed is pinned,
// and its name would sit on the few nodes of its own. A haplotype's copy it
// walks mostly over other contigs' nodes is not on its own sequence, its own
// nodes being the variants along the way: it is named nowhere where the
// reference carries the gene, and otherwise as a copy no walk is lifted for.
// A gene with no symbol
// is named nowhere, unless no gene in the drawing has one. A gene the
// reference carries is named on the reference alone. A
// copy on a lifted walk's own sequence is named too, with its haplotype. A
// gene only shown haplotypes carry is named once, on the copy chosen by
// carriedBefore, with its haplotype while any walk is lifted. Every other copy
// keeps its exons and its hover, and no name.
export function namedGenePins(
  pins: readonly GenePin[],
  liftedWalks: readonly string[] = [],
) {
  const lifted = new Set(liftedWalks.map(name => pathOrigin(name).name))
  const onReference = new Set(
    pins.flatMap(pin =>
      pin.onReference && pin.anchored >= 0.5 ? [pin.gene.name] : [],
    ),
  )
  const named = nameable(
    pins.filter(
      pin =>
        pin.anchored >= 0.5 ||
        (!pin.onReference && !onReference.has(pin.gene.name)),
    ),
    pin => pin.gene.name,
  )
  const onLift = (pin: GenePin) =>
    !pin.onReference && pin.anchored >= 0.5 && lifted.has(pin.gene.refName)
  const namedElsewhere = new Set(
    named.flatMap(pin =>
      pin.onReference || onLift(pin) ? [pin.gene.name] : [],
    ),
  )
  const offReference = new Map<string, GenePin>()
  for (const pin of named) {
    const { name } = pin.gene
    const best = offReference.get(name)
    if (
      !pin.onReference &&
      !namedElsewhere.has(name) &&
      (!best || carriedBefore(pin, best))
    ) {
      offReference.set(name, pin)
    }
  }
  return named.flatMap(pin =>
    pin.onReference
      ? [{ pin, name: pin.gene.name }]
      : onLift(pin)
        ? [{ pin, name: whose(pin) }]
        : offReference.get(pin.gene.name) === pin
          ? [{ pin, name: lifted.size > 0 ? whose(pin) : pin.gene.name }]
          : [],
  )
}
