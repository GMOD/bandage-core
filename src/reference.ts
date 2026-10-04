import { isBackbone } from './anchoredNodes'
import {
  isGenericSample,
  panSNContig,
  panSNHaplotype,
  panSNSample,
} from './pansn'

import type { Graph, PathOrigin } from './types'

// A graph's backbone names the sample it lies on (`GRCh38#0#chr6`), not an
// assembly, and a bare contig (`chr6`) is in every human assembly at once. A
// backbone binds to an assembly where its PanSN prefix is that assembly's name,
// one of its aliases, or its well-known sample. One that names no sample binds
// only where the host knows the assembly otherwise, as a track's config does.

export interface BackboneContig {
  // as the graph names it, `GRCh38#0#chr6`
  refName: string
  // as an assembly names it, `chr6`
  contig: string
  start: number
  end: number
}

export interface Backbone {
  contigs: BackboneContig[]
  // The PanSN prefixes that name the backbone, sample then haplotype:
  // `GRCh38`, `GRCh38#0`. The sample drops out where the graph walks another
  // haplotype of it, as a diploid's `HG002` names `HG002#1` and `HG002#2`.
  prefixes: string[]
  // Whether the contigs name one real sample: false where every contig is bare
  // (`chr6`) or generic (`_gbwt_ref#0#chr6`), or where the samples differ
  named: boolean
}

export interface AssemblyNames {
  name: string
  aliases?: string[]
}

// The sample a reference assembly's graphs name it by, keyed by the assembly's
// name in lower case: HPRC writes `CHM13` where UCSC's assembly is `hs1`.
export const WELL_KNOWN_SAMPLES: ReadonlyMap<string, string> = new Map([
  ['hg38', 'GRCh38'],
  ['hg19', 'GRCh37'],
  ['hs1', 'CHM13'],
  ['t2t-chm13', 'CHM13'],
  ['chm13v2', 'CHM13'],
])

export function wellKnownSample(assemblyName: string) {
  return WELL_KNOWN_SAMPLES.get(assemblyName.toLowerCase())
}

function sampleOf(refName: string) {
  const sample = refName.includes('#') ? panSNSample(refName) : undefined
  return sample === undefined || isGenericSample(sample) ? undefined : sample
}

// `HG002#1`, or the sample of a two-part name, which states no haplotype
function haplotypeOf(refName: string) {
  return panSNHaplotype(refName) ?? panSNSample(refName)
}

// Each sample's haplotypes among the graph's walks and node refNames
function graphHaplotypes(graph: Graph) {
  const refNames = new Set((graph.anchorPaths ?? []).map(p => p.name))
  for (const node of graph.nodes) {
    if (node.stable) {
      refNames.add(node.stable.refName)
    }
  }
  const bySample = new Map<string, Set<string>>()
  for (const refName of refNames) {
    const sample = sampleOf(refName)
    if (sample !== undefined) {
      const haplotypes =
        bySample.get(sample) ?? bySample.set(sample, new Set()).get(sample)!
      haplotypes.add(haplotypeOf(refName))
    }
  }
  return bySample
}

function backboneFrom(
  contigs: BackboneContig[],
  haplotypes: Map<string, Set<string>>,
): Backbone {
  const samples = new Set(contigs.map(c => sampleOf(c.refName)))
  const [sample] = samples
  if (samples.size !== 1 || sample === undefined) {
    return { contigs, prefixes: [], named: false }
  }
  const own = new Set(contigs.map(c => haplotypeOf(c.refName)))
  const unique = [...(haplotypes.get(sample) ?? [])].every(h => own.has(h))
  const shared = new Set(contigs.map(c => panSNHaplotype(c.refName)))
  const [haplotype] = shared
  return {
    contigs,
    prefixes: [
      ...(unique ? [sample] : []),
      ...(shared.size === 1 && haplotype ? [haplotype] : []),
    ],
    named: true,
  }
}

// The rank-0 nodes' refNames and the span each covers
export function graphBackbone(graph: Graph): Backbone | undefined {
  const spans = new Map<string, BackboneContig>()
  for (const node of graph.nodes) {
    if (isBackbone(node)) {
      const { refName, start } = node.stable
      const end = start + node.length
      const span = spans.get(refName)
      if (span) {
        span.start = Math.min(span.start, start)
        span.end = Math.max(span.end, end)
      } else {
        spans.set(refName, {
          refName,
          contig: panSNContig(refName),
          start,
          end,
        })
      }
    }
  }
  const contigs = [...spans.values()]
  return contigs.length
    ? backboneFrom(contigs, graphHaplotypes(graph))
    : undefined
}

// `GRCh38 chr6`: the window's contig, else the backbone's one contig, after the
// sample a named backbone lies on. Undefined where there is no one contig, so
// a range never follows a bare sample.
export function referenceLabel(graph: Graph, region?: { refName: string }) {
  const backbone = graphBackbone(graph)
  const contig = region
    ? panSNContig(region.refName)
    : backbone?.contigs.length === 1
      ? backbone.contigs[0]!.contig
      : undefined
  const sample = backbone?.named
    ? panSNSample(backbone.contigs[0]!.refName)
    : undefined
  return contig && (sample ? `${sample} ${contig}` : contig)
}

// The assembly the backbone's haplotype names by its name or an alias, else
// the one its sample names, else the one whose well-known sample it is. A
// backbone with no prefix binds to none.
export function backboneAssembly<T extends AssemblyNames>(
  backbone: Backbone | undefined,
  assemblies: T[],
): T | undefined {
  const names = (a: T) => [a.name, ...(a.aliases ?? [])]
  const naming = (prefix: string) => (a: T) =>
    names(a).some(n => n.toLowerCase() === prefix.toLowerCase())
  const prefixes = [...(backbone?.prefixes ?? [])].reverse()
  const sample = backbone?.prefixes.find(p => !p.includes('#'))?.toLowerCase()
  for (const prefix of prefixes) {
    const assembly = assemblies.find(naming(prefix))
    if (assembly) {
      return assembly
    }
  }
  return sample === undefined
    ? undefined
    : assemblies.find(a =>
        names(a).some(n => wellKnownSample(n)?.toLowerCase() === sample),
      )
}

// The first of the graph's walks that a backbone along it would bind to
// `assembly`, for putting x on the assembly a cut was made for
export function assemblyWalk(
  graph: Graph,
  assembly: AssemblyNames,
): PathOrigin | undefined {
  const haplotypes = graphHaplotypes(graph)
  return graph.anchorPaths?.find(walk =>
    backboneAssembly(
      backboneFrom(
        [
          {
            refName: walk.name,
            contig: panSNContig(walk.name),
            start: walk.start,
            end: walk.start + walk.length,
          },
        ],
        haplotypes,
      ),
      [assembly],
    ),
  )
}

// The names a file from outside the graph may give a contig: its own, and the
// same with or without UCSC's `chr`, the mitochondrion as M or MT either way
export function contigNames(contig: string) {
  const bare = contig.replace(/^chr/i, '')
  const forms = !bare ? [] : /^(M|MT)$/i.test(bare) ? ['M', 'MT'] : [bare]
  return [...new Set([contig, ...forms.flatMap(f => [f, `chr${f}`])])]
}

// Which of `refNames` a feature's refName names: the one it equals, else the
// only one whose contig it names, by any of contigNames or the name `aliases`
// gives that contig (`{ chr6: 'NC_000006.12' }`). A name two refNames share
// names neither.
export function refNameBinding(
  refNames: Iterable<string>,
  aliases: Record<string, string> = {},
) {
  const exact = new Set(refNames)
  const byName = new Map<string, string | undefined>()
  for (const refName of exact) {
    const contig = panSNContig(refName)
    const alias = aliases[contig]
    for (const name of new Set([
      ...contigNames(contig),
      ...(alias ? [alias] : []),
    ])) {
      byName.set(name, byName.has(name) ? undefined : refName)
    }
  }
  return (name: string) => (exact.has(name) ? name : byName.get(name))
}

// An assembly's features on a backbone that binds to it, each renamed to the
// backbone's refName for it, so the assembly's `chr6` becomes the graph's
// `GRCh38#0#chr6`. genePins and tubeMapGenes take only the renamed.
export function featuresOnBackbone<T extends { refName: string }>(
  features: readonly T[],
  backbone: Backbone,
  aliases?: Record<string, string>,
): T[] {
  const bind = refNameBinding(
    backbone.contigs.map(c => c.refName),
    aliases,
  )
  return features.flatMap(f => {
    const refName = bind(f.refName)
    return refName === undefined
      ? []
      : [refName === f.refName ? f : { ...f, refName }]
  })
}
