import {
  genesFromBed,
  genesFromGff3Lines,
  genesFromText,
  mergedIntervals,
} from './geneFiles'

const row = (...cols: (string | number)[]) => cols.join('\t')
const gff = (
  refName: string,
  type: string,
  start: number,
  end: number,
  strand: string,
  attributes: string,
) => row(refName, 'test', type, start, end, '.', strand, '.', attributes)

test('mergedIntervals joins overlapping and touching intervals', () => {
  expect(
    mergedIntervals([
      { start: 50, end: 60 },
      { start: 0, end: 10 },
      { start: 5, end: 20 },
      { start: 20, end: 30 },
    ]),
  ).toEqual([
    { start: 0, end: 30 },
    { start: 50, end: 60 },
  ])
})

test("genesFromGff3Lines merges a RefSeq gene's transcripts' exons", () => {
  const genes = genesFromGff3Lines([
    '##gff-version 3',
    gff('chr6', 'gene', 101, 400, '-', 'ID=LPA;gene_id=LPA'),
    gff('chr6', 'transcript', 101, 400, '-', 'ID=NM_1;Parent=LPA;gene_id=LPA'),
    gff('chr6', 'exon', 101, 150, '-', 'ID=e1;Parent=NM_1;gene_id=LPA'),
    gff('chr6', 'CDS', 120, 150, '-', 'ID=c1;Parent=NM_1;gene_id=LPA'),
    gff('chr6', 'exon', 301, 400, '-', 'ID=e2;Parent=NM_1;gene_id=LPA'),
    gff('chr6', 'transcript', 131, 400, '-', 'ID=NM_2;Parent=LPA;gene_id=LPA'),
    gff('chr6', 'exon', 131, 200, '-', 'ID=e3;Parent=NM_2;gene_id=LPA'),
  ])
  expect(genes).toEqual([
    {
      name: 'LPA',
      refName: 'chr6',
      start: 100,
      end: 400,
      strand: -1,
      exons: [
        { start: 100, end: 200 },
        { start: 300, end: 400 },
      ],
    },
  ])
})

test('genesFromGff3Lines climbs Parent to the gene and names it by Name', () => {
  const genes = genesFromGff3Lines([
    gff('1', 'chromosome', 1, 1000, '.', 'ID=chromosome:1'),
    gff('1', 'exon', 11, 20, '+', 'Parent=transcript:T1'),
    gff('1', 'mRNA', 11, 50, '+', 'ID=transcript:T1;Parent=gene:G1'),
    gff('1', 'gene', 11, 50, '+', 'ID=gene:G1;Name=ABC%3B1;gene_id=G1'),
    gff('1', 'gene', 101, 150, '.', 'ID=gene:G2;gene_id=G2'),
    '##FASTA',
    gff('1', 'gene', 201, 250, '+', 'ID=gene:G3'),
  ])
  expect(genes).toEqual([
    {
      name: 'ABC;1',
      refName: '1',
      start: 10,
      end: 50,
      strand: 1,
      exons: [{ start: 10, end: 20 }],
    },
    {
      name: 'G2',
      refName: '1',
      start: 100,
      end: 150,
      strand: 0,
      exons: [{ start: 100, end: 150 }],
    },
  ])
})

test("genesFromGff3Lines skips the rest of NCBI's top level", () => {
  const genes = genesFromGff3Lines([
    gff('NC_1', 'region', 1, 5000, '+', 'ID=NC_1:1..5000'),
    gff('NC_1', 'enhancer', 11, 50, '.', 'ID=id-3f1c9a'),
    gff('NC_1', 'cDNA_match', 11, 50, '+', 'ID=aln1'),
    gff('NC_1', 'pseudogene', 101, 200, '+', 'ID=gene-P1;Name=P1'),
    gff('NC_1', 'ncRNA_gene', 301, 400, '-', 'ID=gene-N1;Name=N1'),
    gff('NC_1', 'CDS', 501, 600, '+', 'ID=cds-C1;Name=C1'),
    gff('NC_1', 'tRNA', 701, 780, '+', 'ID=rna-T1;gene=trnA'),
  ])
  expect(genes.map(g => g.name)).toEqual(['P1', 'N1', 'C1', 'trnA'])
})

// bedtools writes `.` in an empty name column
test('genesFromBed keeps rows named `.` apart', () => {
  const genes = genesFromBed(
    [row('chr6', 100, 200, '.'), row('chr6', 5000, 5100, '.')].join('\n'),
  )
  expect(genes.map(g => [g.name, g.start, g.end])).toEqual([
    ['chr6:101-200', 100, 200],
    ['chr6:5001-5100', 5000, 5100],
  ])
})

test('genesFromBed reads blocks and merges rows that share a name', () => {
  const genes = genesFromBed(
    [
      'track name=mine',
      '# a comment',
      row('chr6', 100, 400, 'G', 0, '+', 100, 400, 0, 2, '50,100,', '0,200,'),
      row('chr6', 150, 500, 'G', 0, '+', 150, 500, 0, 1, '100,', '0,'),
      row('chr6', 1000, 1100),
      '',
    ].join('\n'),
  )
  expect(genes).toEqual([
    {
      name: 'G',
      refName: 'chr6',
      start: 100,
      end: 500,
      strand: 1,
      exons: [
        { start: 100, end: 250 },
        { start: 300, end: 400 },
      ],
    },
    {
      name: 'chr6:1001-1100',
      refName: 'chr6',
      start: 1000,
      end: 1100,
      strand: 0,
      exons: [{ start: 1000, end: 1100 }],
    },
  ])
})

test('genesFromText tells BED from GFF3 by its columns', () => {
  expect(genesFromText(`track x\n${row('chr1', 0, 10, 'A')}\n`)[0]?.name).toBe(
    'A',
  )
  expect(
    genesFromText(
      `##gff-version 3\n${gff('chr1', 'gene', 1, 10, '+', 'ID=B')}\n`,
    )[0]?.name,
  ).toBe('B')
  expect(genesFromText('')).toEqual([])
})
