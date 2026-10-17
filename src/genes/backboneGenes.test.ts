import { backboneGenes } from './backboneGenes'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { anchorGraph } from '../pathAnchoring'

import type { IndexedGeneFile } from './backboneGenes'

const graph = anchorGraph(
  convertGFAToGraph(
    parseGFA(
      [
        'S\t1\tAAAAAAAAAA',
        'S\t2\tCCCCCCCCCC',
        'S\t3\tTTTTTTTTTT',
        'L\t1\t+\t2\t+\t0M',
        'L\t2\t+\t3\t+\t0M',
        'W\tGRCh38\t0\tchr6\t1000\t1030\t>1>2>3',
      ].join('\n'),
    ),
  ),
  'GRCh38',
)

const bed = (refName: string) => `${refName}\t1002\t1008\tGENE1`

test("a file's genes land on the backbone under its contig's name", async () => {
  const { genes, unbound } = await backboneGenes(graph, { text: bed('chr6') })
  expect(genes.map(g => [g.name, g.refName])).toEqual([
    ['GENE1', 'GRCh38#0#chr6'],
  ])
  expect(unbound).toBeUndefined()
})

test('a file naming no backbone contig says what it names, until refNames binds it', async () => {
  const unnamed = await backboneGenes(graph, { text: bed('NC_000006.12') })
  expect(unnamed).toEqual({
    genes: [],
    unbound: { names: ['NC_000006.12'], contigs: ['chr6'] },
  })
  const named = await backboneGenes(graph, {
    text: bed('NC_000006.12'),
    refNames: { chr6: 'NC_000006.12' },
  })
  expect(named.genes).toHaveLength(1)
  expect(named.unbound).toBeUndefined()
})

test('an indexed file is read over the backbone contig alone', async () => {
  const reads: [string, number, number][] = []
  const indexed: IndexedGeneFile = {
    getReferenceSequenceNames: async () => ['chr1', 'chr6'],
    getLines: async (refName, start, end, { lineCallback }) => {
      reads.push([refName, start, end])
      lineCallback(bed(refName))
    },
  }
  const { genes } = await backboneGenes(graph, { indexed })
  expect(reads).toEqual([['chr6', 1000, 1030]])
  expect(genes.map(g => g.refName)).toEqual(['GRCh38#0#chr6'])
})

test('a graph with no backbone has no genes to read', async () => {
  const bare = convertGFAToGraph(parseGFA('S\t1\tACGT'))
  expect(await backboneGenes(bare, { text: bed('chr6') })).toEqual({
    genes: [],
  })
})
