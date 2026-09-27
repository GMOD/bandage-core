import { isBackbone } from './anchoredNodes'
import { panSNContig, panSNHaplotype, panSNSample } from './pansn'

import type { Graph } from './types'

// A graph's backbone names the sample it lies on (`GRCh38#0#chr6`), not an
// assembly, and a bare contig (`chr6`) is in every human assembly at once. A
// host binds genes and links to an assembly only where the backbone's PanSN
// prefix is that assembly's name, one of its aliases, or its well-known sample.

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
  // The PanSN prefixes every contig shares, sample then haplotype: `GRCh38`,
  // `GRCh38#0`. Empty for bare contig names, or where the samples differ.
  prefixes: string[]
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

function sharedPrefixes(refNames: string[]) {
  return [panSNSample, panSNHaplotype].flatMap(prefixOf => {
    const prefixes = new Set(
      refNames.map(n => (n.includes('#') ? prefixOf(n) : undefined)),
    )
    const [only] = prefixes
    return prefixes.size === 1 && only ? [only] : []
  })
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
    ? { contigs, prefixes: sharedPrefixes(contigs.map(c => c.refName)) }
    : undefined
}

// The first assembly named by one of the backbone's prefixes, through its name
// or an alias, else through the well-known sample of one of those. A backbone
// of bare contig names has no prefix, so it binds to none.
export function backboneAssembly<T extends AssemblyNames>(
  backbone: Backbone | undefined,
  assemblies: T[],
): T | undefined {
  const prefixes = new Set(backbone?.prefixes.map(p => p.toLowerCase()))
  const names = (a: T) => [a.name, ...(a.aliases ?? [])]
  const named = (candidates: (string | undefined)[]) =>
    candidates.some(n => n !== undefined && prefixes.has(n.toLowerCase()))
  return (
    assemblies.find(a => named(names(a))) ??
    assemblies.find(a => named(names(a).map(wellKnownSample)))
  )
}

// Which of `refNames` a feature's refName names: the one it equals, else the
// only one whose contig it is. A contig two refNames share names neither.
export function refNameBinding(refNames: Iterable<string>) {
  const exact = new Set(refNames)
  const byContig = new Map<string, string | undefined>()
  for (const refName of exact) {
    const contig = panSNContig(refName)
    byContig.set(contig, byContig.has(contig) ? undefined : refName)
  }
  return (name: string) => (exact.has(name) ? name : byContig.get(name))
}

// The features on the backbone, each renamed to the backbone's refName for it,
// so an assembly's `chr6` becomes the graph's `GRCh38#0#chr6`
export function featuresOnBackbone<T extends { refName: string }>(
  features: readonly T[],
  backbone: Backbone,
): T[] {
  const bind = refNameBinding(backbone.contigs.map(c => c.refName))
  return features.flatMap(f => {
    const refName = bind(f.refName)
    return refName === undefined
      ? []
      : [refName === f.refName ? f : { ...f, refName }]
  })
}
