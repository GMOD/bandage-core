import { genesFromText } from './geneFiles'
import { featuresOnBackbone, graphBackbone, refNameBinding } from '../reference'

import type { GeneFormat } from './geneFiles'
import type { GeneModel } from './genePins'
import type { Graph } from '../types'

// A gene file read through its index, as @gmod/tabix's TabixIndexedFile reads
// one
export interface IndexedGeneFile {
  getReferenceSequenceNames(): Promise<string[]>
  getLines(
    refName: string,
    start: number,
    end: number,
    o: { lineCallback: (line: string) => void },
  ): Promise<unknown>
}

// A GFF3 or BED file: its whole text, or its index. A file that names a
// backbone contig otherwise, with or without `chr`, says how under
// `refNames`: `{ chr6: 'NC_000006.12' }`.
export type GeneSource = ({ text: string } | { indexed: IndexedGeneFile }) & {
  format?: GeneFormat
  refNames?: Record<string, string>
}

export interface BackboneGenes {
  genes: GeneModel[]
  // the file's sequence names and the backbone's contigs, when no name binds
  // to a contig, so a host can say which name to give under `refNames`
  unbound?: { names: string[]; contigs: string[] }
}

// The genes a file holds on a graph's backbone, renamed onto it. An indexed
// file is read over each backbone contig alone, under the name that binds to
// it.
export async function backboneGenes(
  graph: Graph,
  source: GeneSource,
): Promise<BackboneGenes> {
  const backbone = graphBackbone(graph)
  if (!backbone) {
    return { genes: [] }
  }
  const bind = refNameBinding(
    backbone.contigs.map(c => c.refName),
    source.refNames,
  )
  let names: string[]
  let features: GeneModel[]
  if ('indexed' in source) {
    names = await source.indexed.getReferenceSequenceNames()
    const lines: string[] = []
    for (const contig of backbone.contigs) {
      const name = names.find(n => bind(n) === contig.refName)
      if (name !== undefined) {
        await source.indexed.getLines(name, contig.start, contig.end, {
          lineCallback: line => lines.push(line),
        })
      }
    }
    features = genesFromText(lines.join('\n'), source.format)
  } else {
    features = genesFromText(source.text, source.format)
    names = [...new Set(features.map(f => f.refName))]
  }
  return {
    genes: featuresOnBackbone(features, backbone, source.refNames),
    unbound: names.some(name => bind(name) !== undefined)
      ? undefined
      : { names, contigs: backbone.contigs.map(c => c.contig) },
  }
}
