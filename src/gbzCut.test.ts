import { HPRC_GBZ, cutGbzRegion, gbzLocations, parseRegion } from './gbzCut'

test('`hprc` keeps an index the source names', () => {
  expect(gbzLocations({ db: 'hprc', index: 'mine.db' })).toEqual({
    db: HPRC_GBZ.db,
    index: 'mine.db',
  })
  expect(gbzLocations({ db: 'hprc' })).toEqual(HPRC_GBZ)
  expect(gbzLocations({ db: 'a.gbz.db' })).toEqual({
    db: 'a.gbz.db',
    index: undefined,
  })
})

test('a region reads its bounds, commas and all', () => {
  expect(parseRegion(' chr6:160,614,798-160,647,758 ')).toEqual({
    refName: 'chr6',
    start: 160_614_798,
    end: 160_647_758,
  })
})

test('a region may name a contig with colons', () => {
  expect(parseRegion('HLA:01:5-10')).toEqual({
    refName: 'HLA:01',
    start: 5,
    end: 10,
  })
})

test('a region that ends at or before its start is refused', () => {
  expect(() => parseRegion('chr1:100-50')).toThrow('ends at or before')
  expect(() => parseRegion('chr1:100-100')).toThrow('ends at or before')
})

const noPaths = { paths: () => Promise.resolve([]) } as never

test.each([
  ['CHM13', 'CHM13'],
  ['_gbwt_ref', '_gbwt_ref'],
  ['hg38', 'GRCh38'],
  [undefined, 'GRCh38'],
])(
  'a cut asked for %s on a GRCh38 graph resolves against %s',
  async (asked, sample) => {
    await expect(
      cutGbzRegion(
        { base: noPaths, referenceSamples: ['GRCh38'] },
        { region: 'chr1:1-10', referenceSample: asked },
      ),
    ).rejects.toThrow(`${sample} has no indexed path named chr1`)
  },
)

test('a cut on a graph naming no reference sample needs one asked for', async () => {
  await expect(
    cutGbzRegion(
      { base: noPaths, referenceSamples: [] },
      { region: 'chr1:1-10' },
    ),
  ).rejects.toThrow('names no reference sample')
})
