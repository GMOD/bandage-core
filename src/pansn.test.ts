import { panSNFields, parsePanSN } from './pansn'

test('parsePanSN reads sample and haplotype, tolerating bare contig names', () => {
  expect(parsePanSN('HG01433.2#2#CM086507.1')).toEqual({
    sample: 'HG01433.2',
    haplotype: 2,
  })
  expect(parsePanSN('K12#1#chr')).toEqual({ sample: 'K12', haplotype: 1 })
  expect(parsePanSN('chr1')).toEqual({ sample: 'chr1', haplotype: undefined })
  expect(parsePanSN('grape##chr1')).toEqual({
    sample: 'grape',
    haplotype: undefined,
  })
})

test('panSNFields reads three fields, the contig keeping any # past them', () => {
  expect(panSNFields('HG002#1#chr6#2')).toEqual({
    sample: 'HG002',
    haplotype: 1,
    contig: 'chr6#2',
  })
  expect(panSNFields('chm13#chr1')).toBeUndefined()
  expect(panSNFields('chr1')).toBeUndefined()
})
