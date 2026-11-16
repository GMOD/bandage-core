import { panSNHaplotype, panSNSample } from '../pansn'
import { pathOrigin } from '../pathAnchoring'

import type { GenePin } from './genePins'

// An identifier standing in where a gene has no symbol: an Ensembl stable id
// (ENSG00000289697, ENSMUSG…, with or without its version), NCBI's LOC and
// RefSeq accessions (LOC105378878, NR_046018), or the `chr1:101-200` a BED
// row with no name is given
const ACCESSION =
  /^(?:ENS[A-Z]*[GT]\d{6,}(?:\.\d+)?|LOC\d+|[NX][MR]_\d+(?:\.\d+)?|\S+:\d+-\d+)$/

export function hasGeneSymbol(name: string) {
  return !ACCESSION.test(name)
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

// Which genes a drawing names, and how. A gene with no symbol is named
// nowhere, unless no gene in the drawing has one. A gene the reference carries is named on the reference alone. A
// copy on a lifted walk's own sequence is named too, with its haplotype. A
// gene only shown haplotypes carry is named once, on the copy chosen by
// carriedBefore, with its haplotype while any walk is lifted. Every other copy
// keeps its exons and its hover, and no name.
export function namedGenePins(
  pins: readonly GenePin[],
  liftedWalks: readonly string[] = [],
) {
  const lifted = new Set(liftedWalks.map(name => pathOrigin(name).name))
  const symbolled = pins.filter(pin => hasGeneSymbol(pin.gene.name))
  const nameable = symbolled.length > 0 ? symbolled : pins
  const onLift = (pin: GenePin) =>
    !pin.onReference && lifted.has(pin.gene.refName)
  const namedElsewhere = new Set(
    nameable.flatMap(pin =>
      pin.onReference || onLift(pin) ? [pin.gene.name] : [],
    ),
  )
  const offReference = new Map<string, GenePin>()
  for (const pin of nameable) {
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
  return nameable.flatMap(pin =>
    pin.onReference
      ? [{ pin, name: pin.gene.name }]
      : onLift(pin)
        ? [{ pin, name: whose(pin) }]
        : offReference.get(pin.gene.name) === pin
          ? [{ pin, name: lifted.size > 0 ? whose(pin) : pin.gene.name }]
          : [],
  )
}
