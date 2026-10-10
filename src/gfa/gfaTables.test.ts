import { readFileSync } from 'node:fs'

import { convertGFAToGraph } from './gfaConverter'
import { gfaTables } from './gfaTables'
import { graphFromTables } from './graphTables'
import { parseGFA } from '../gfa-core/index'

function expectSameGraph(text: string) {
  const tables = gfaTables(text)
  expect(tables).toBeDefined()
  const fromTables = graphFromTables(tables!, 'cut')
  const fromText = convertGFAToGraph(parseGFA(text), 'cut')
  expect(fromTables).toStrictEqual(fromText)
  expect([...(fromTables.pathVisits?.keys() ?? [])]).toEqual([
    ...(fromText.pathVisits?.keys() ?? []),
  ])
}

const gfa = (...lines: string[]) => `${lines.join('\n')}\n`

test('a gbz-base cut reads as the text converts', () => {
  expectSameGraph(
    gfa(
      'H\tVN:Z:1.1\tRS:Z:GRCh38',
      'S\t10\tACGT',
      'S\t11\tA',
      'S\t12\tCC',
      'S\t13\tGGGG',
      'L\t10\t+\t11\t+\t0M',
      'L\t10\t+\t12\t+\t0M',
      'L\t11\t+\t13\t+\t0M',
      'L\t12\t+\t13\t+\t0M',
      'L\t13\t-\t10\t-\t0M',
      'W\tGRCh38\t0\tchr6\t100\t109\t>10>11>13',
      'W\tHG002\t1\tCM1.1\t5\t15\t>10>12>13',
      'W\tHG002\t2\tCM2.1\t0\t10\t<13<11<10',
      'W\tHG002\t1\tCM1.1\t40\t49\t>10>11>13',
    ),
  )
})

test('ids that are not plain decimal, undeclared segments and CRLF', () => {
  expectSameGraph(
    [
      'S\t007\tAC\r',
      'S\t7\tA\r',
      'S\tseg_a\t*\tLN:i:30\r',
      'S\t12345678901234567890\tAAA\r',
      'L\t007\t+\t7\t-\t*\r',
      'L\t7\t-\tghost\t+\t*\r',
      'W\tS1\t1\tc\t*\t*\t>007<7>seg_a>12345678901234567890>99\r',
      'W\tS2\t0\tc#x\t3\t*\t<seg_a>7\r',
    ].join('\n'),
  )
})

test('an rGFA keeps its stable coordinates', () => {
  expectSameGraph(readFileSync('test_data/ecoli_rgfa_slice.gfa', 'utf8'))
  expectSameGraph(
    gfa(
      'S\ts1\t*\tLN:i:5\tSN:Z:chr1:1-100\tSO:i:0\tSR:i:0',
      'S\ts2\t*\tLN:i:5\tSN:Z:chr1:1-100',
    ),
  )
})

test('a GFA the tables cannot hold converts as text', () => {
  const base = ['S\t1\tA', 'S\t2\tC', 'L\t1\t+\t2\t+\t0M']
  for (const extra of [
    'P\tp1\t1+,2+\t*',
    'S\t1\tA',
    'S\t3\tA\tSM:Z:K12.1',
    'S\t3\tA\tdp:i:4',
    'S\t3\t4\t*',
    'E\te1\t1+\t2+\t0\t1$\t0\t1\t*',
    'W\tS1\t1\tc\t0\t2\t>',
  ]) {
    expect(gfaTables(gfa(...base, extra))).toBeUndefined()
  }
})
