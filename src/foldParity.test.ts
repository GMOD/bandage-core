// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { foldVariants } from './foldVariants'
import { writeRgfa } from './gfa/writeRgfa'
import { loadGraph } from './pipeline'

// gfa-to-tabix's `fold` ports foldVariants, and its CI holds the port to a
// pinned bandage-core. These hold foldVariants to the gfa-to-tabix release
// push.yml pins, so a change to one fold the other lacks fails here.

const BINARY = process.env.GFA_TO_TABIX ?? 'gfa-to-tabix'
const probe = spawnSync(BINARY, ['--version'], { encoding: 'utf8' })
const VERSION = probe.status === 0 ? probe.stdout.trim() : undefined

const THRESHOLDS = [5, 50, 500, 5000]
const GRAPHS = 300

type Strand = '+' | '-'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Segment {
  name: string
  sequence: string
  start: number
  length: number
  rank: number
}

// Rank 0 backbones with deletions across them, and alleles of a few segments
// each on other sequences and ranks, hung between backbone or allele segments
// either way round, some beside a twin of equal lengths so that ties come up,
// with every link written in either of its two spellings
function randomRgfa(seed: number, tag = '') {
  const rand = mulberry32(seed)
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rand() * (hi - lo + 1))
  const pick = <T>(items: T[]) => items[int(0, items.length - 1)]!
  const chance = (p: number) => rand() < p
  const length = () =>
    chance(0.15) ? int(1, 8000) : Math.max(1, pick(THRESHOLDS) + int(-2, 2))
  const lengths = (count: number) => Array.from({ length: count }, length)

  const ids = Array.from({ length: 200 }, (_, i) => i + 1)
  shuffle(ids, int)
  const segments: Segment[] = []
  const chains: Segment[][] = []
  const links: string[] = []
  const flip = (s: Strand): Strand => (s === '+' ? '-' : '+')
  const link = (a: Segment, sa: Strand, b: Segment, sb: Strand) => {
    links.push(
      chance(0.5)
        ? `L\t${a.name}\t${sa}\t${b.name}\t${sb}\t0M`
        : `L\t${b.name}\t${flip(sb)}\t${a.name}\t${flip(sa)}\t0M`,
    )
  }
  const chain = (sequence: string, rank: number, sizes: number[]) => {
    let start = rank === 0 ? 0 : int(0, 3) * 10_000
    const run = sizes.map(size => {
      const segment = {
        name: `${tag}s${ids[segments.length]}`,
        sequence: `${tag}${sequence}`,
        start,
        length: size,
        rank,
      }
      start += size
      segments.push(segment)
      return segment
    })
    for (let i = 1; i < run.length; i++) {
      link(run[i - 1]!, '+', run[i]!, '+')
    }
    chains.push(run)
    return run
  }

  const backbones = Array.from({ length: int(1, 2) }, (_, k) =>
    chain(
      chance(0.7) ? `ref#chr${k + 1}` : `chr${k + 1}`,
      0,
      lengths(int(3, 9)),
    ),
  )
  for (const backbone of backbones) {
    for (let d = int(0, 2); d > 0; d--) {
      const i = int(0, backbone.length - 3)
      const j = int(i + 2, backbone.length - 1)
      link(backbone[i]!, '+', backbone[j]!, chance(0.85) ? '+' : '-')
    }
  }

  for (let n = int(2, 9); n > 0; n--) {
    const host = chance(0.6) ? pick(backbones) : pick(chains)
    const i = int(0, host.length - 1)
    const left = host[i]!
    const right = chance(0.1)
      ? pick(segments)
      : host[Math.min(host.length - 1, i + int(0, 3))]!
    const reversed = chance(0.3)
    const sizes = lengths(int(1, 4))
    for (let copies = chance(0.3) ? 2 : 1; copies > 0; copies--) {
      const allele = chain(`asm${int(1, 4)}#chr`, int(1, 3), sizes)
      const [first, last] = [allele[0]!, allele.at(-1)!]
      if (!chance(0.08)) {
        link(left, '+', reversed ? last : first, reversed ? '-' : '+')
      }
      if (!chance(0.08)) {
        link(reversed ? first : last, reversed ? '-' : '+', right, '+')
      }
      if (allele.length > 2 && chance(0.2)) {
        link(allele[1]!, '+', pick(segments), chance(0.5) ? '+' : '-')
      }
    }
  }

  for (let n = int(0, 2); n > 0; n--) {
    const a = pick(segments)
    link(a, chance(0.5) ? '+' : '-', chance(0.1) ? a : pick(segments), '+')
  }
  if (chance(0.1)) {
    links.push(pick(links))
  }

  const sLines = segments.map(
    s =>
      `S\t${s.name}\t*\tLN:i:${s.length}\tSN:Z:${s.sequence}\tSO:i:${s.start}\tSR:i:${s.rank}`,
  )
  shuffle(sLines, int)
  shuffle(links, int)
  return [...sLines, ...links]
}

function shuffle<T>(items: T[], int: (lo: number, hi: number) => number) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = int(0, i)
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
}

function bandageFold(gfa: string, below: number) {
  const graph = loadGraph(gfa, 'parity.gfa')
  return writeRgfa(foldVariants({ ...graph, paths: undefined }, below))
}

function run(args: string[], stdin: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(BINARY, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(`${BINARY} ${args.join(' ')} exited ${code}: ${stderr}`),
        )
      }
    })
    child.stdin.end(stdin)
  })
}

function rows(prefix: string) {
  return ['segs', 'links'].map(kind =>
    new TextDecoder().decode(
      gunzipSync(readFileSync(`${prefix}.${kind}.bed.gz`)),
    ),
  )
}

// The rows `gfa-to-tabix -` files bandage-fold's output under, and the rows
// `gfa-to-tabix fold` writes for the same graph
async function bothFolds(gfa: string, below: number, dir: string, tag: string) {
  const js = path.join(dir, `${tag}.js`)
  const rs = path.join(dir, `${tag}.rs`)
  await Promise.all([
    run(['-', '--layout', 'contig', '-o', js], bandageFold(gfa, below)),
    run(
      ['fold', '-', '--below', `${below}`, '--layout', 'contig', '-o', rs],
      gfa,
    ),
  ])
  return { js: rows(js), rs: rows(rs) }
}

function segment(
  name: string,
  sequence: string,
  start: number,
  length: number,
  rank: number,
) {
  return `S\t${name}\t*\tLN:i:${length}\tSN:Z:${sequence}\tSO:i:${start}\tSR:i:${rank}`
}

function link(a: string, sa: Strand, b: string, sb: Strand) {
  return `L\t${a}\t${sa}\t${b}\t${sb}\t0M`
}

const gfa = (lines: string[]) => [...lines, ''].join('\n')

// One graph per behaviour that took care to port, so a failure names it.
// Each folds at 1000 bp.
const GOLDEN = {
  // a 6 kb allele hung reversed between r2 and r3, its own links and the
  // backbone's written on the minus strand: the merged runs' links must land
  // on the merged segments' outer ends
  'reverse-strand links': gfa([
    segment('r1', 'ref#chr', 0, 1000, 0),
    segment('r2', 'ref#chr', 1000, 1000, 0),
    segment('r3', 'ref#chr', 2000, 1000, 0),
    segment('r4', 'ref#chr', 3000, 1000, 0),
    segment('x1', 'a#chr', 0, 3000, 1),
    segment('x2', 'a#chr', 3000, 3000, 1),
    link('r2', '-', 'r1', '-'),
    link('r2', '+', 'r3', '+'),
    link('r4', '-', 'r3', '-'),
    link('r2', '+', 'x2', '-'),
    link('x2', '-', 'x1', '-'),
    link('x1', '-', 'r3', '+'),
  ]),
  // a 4 kb allele whose second segment a kept link leaves: it merges into
  // two runs, and the backbone either side of it into one each
  'run merging': gfa([
    segment('r1', 'ref#chr', 0, 1000, 0),
    segment('r2', 'ref#chr', 1000, 1000, 0),
    segment('r3', 'ref#chr', 2000, 1000, 0),
    segment('r4', 'ref#chr', 3000, 1000, 0),
    segment('a1', 'a#chr', 0, 1000, 1),
    segment('a2', 'a#chr', 1000, 1000, 1),
    segment('a3', 'a#chr', 2000, 1000, 1),
    segment('a4', 'a#chr', 3000, 1000, 1),
    segment('small', 'b#chr', 0, 10, 1),
    link('r1', '+', 'r2', '+'),
    link('r2', '+', 'r3', '+'),
    link('r3', '+', 'r4', '+'),
    link('r1', '+', 'a1', '+'),
    link('a1', '+', 'a2', '+'),
    link('a2', '+', 'a3', '+'),
    link('a3', '+', 'a4', '+'),
    link('a4', '+', 'r4', '+'),
    link('a2', '+', 'r4', '+'),
    link('r2', '+', 'small', '+'),
    link('small', '+', 'r3', '+'),
  ]),
  // big's ends each have two equally near ways back to the backbone; the
  // fold keeps the lower id, s10 over s9, though s9 comes first
  'ties to the lowest id': gfa([
    segment('r1', 'ref#chr', 0, 1000, 0),
    segment('r2', 'ref#chr', 1000, 1000, 0),
    segment('s9', 'p#chr', 0, 10, 1),
    segment('s10', 'q#chr', 0, 10, 1),
    segment('m', 'u#chr', 0, 5, 2),
    segment('t9', 'v#chr', 0, 10, 1),
    segment('t10', 'w#chr', 0, 10, 1),
    segment('big', 'x#chr', 0, 5000, 3),
    link('r1', '+', 'r2', '+'),
    link('r1', '+', 't9', '+'),
    link('r1', '+', 't10', '+'),
    link('t9', '+', 'm', '+'),
    link('t10', '+', 'm', '+'),
    link('m', '+', 'big', '+'),
    link('big', '+', 's9', '+'),
    link('big', '+', 's10', '+'),
    link('s9', '+', 'r2', '+'),
    link('s10', '+', 'r2', '+'),
  ]),
}

// Known divergence. foldVariants breaks ties by node id, the segment name with
// the strand of the first link naming it appended, so whether `p` or `p,1` is
// the lower turns on how the big-p link is spelled. gfa-to-tabix compares
// names, keeping `p` either way, as foldVariants' "does not depend on the
// order nodes arrived in" promises. Flip these to plain tests once it does.
const tieBySpelling = (bigToP: string) =>
  gfa([
    segment('r1', 'ref#chr', 0, 1000, 0),
    segment('r2', 'ref#chr', 1000, 1000, 0),
    segment('p', 'p#chr', 0, 10, 1),
    segment('p,1', 'q#chr', 0, 10, 1),
    segment('big', 'x#chr', 0, 5000, 2),
    link('r1', '+', 'r2', '+'),
    link('r1', '+', 'big', '+'),
    bigToP,
    link('big', '+', 'p,1', '+'),
    link('p', '+', 'r2', '+'),
    link('p,1', '+', 'r2', '+'),
  ])
const TIE_BY_SPELLING = tieBySpelling(link('p', '-', 'big', '-'))

test('a tie does not turn on how a link is spelled', () => {
  for (const bigToP of [
    link('big', '+', 'p', '+'),
    link('p', '-', 'big', '-'),
  ]) {
    expect(bandageFold(tieBySpelling(bigToP), 1000)).toMatch(/^S\tp\t/m)
  }
})

describe('golden folds', () => {
  test.each(Object.entries(GOLDEN))('%s', (_, graph) => {
    expect(bandageFold(graph, 1000)).toMatchSnapshot()
  })
})

const where = 'GFA_TO_TABIX or PATH'

test.runIf(process.env.CI)(`CI has a gfa-to-tabix on ${where}`, () => {
  expect(VERSION).toBeDefined()
})

describe.skipIf(!VERSION)(
  VERSION
    ? `foldVariants matches ${VERSION} fold`
    : `foldVariants against gfa-to-tabix: skipped, none on ${where}`,
  () => {
    let dir: string
    beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'fold-parity-'))
    })
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    test.each(Object.entries(GOLDEN))('%s', async (name, graph) => {
      const { js, rs } = await bothFolds(
        graph,
        1000,
        dir,
        name.replace(/\W/g, '_'),
      )
      expect(rs).toEqual(js)
    })

    test('a tie does not turn on how a link is spelled', async () => {
      const { js, rs } = await bothFolds(TIE_BY_SPELLING, 1000, dir, 'spelling')
      expect(rs).toEqual(js)
    })

    test(`${GRAPHS} random rGFA graphs at ${THRESHOLDS.join(', ')} bp`, async () => {
      const seeds = Array.from({ length: GRAPHS }, (_, seed) => seed)
      const all = gfa(seeds.flatMap(seed => randomRgfa(seed, `g${seed}_`)))
      const failures = await Promise.all(
        THRESHOLDS.map(async below => {
          const batch = await bothFolds(all, below, dir, `all-${below}`).catch(
            () => undefined,
          )
          return batch && sameRows(batch)
            ? []
            : await failingSeeds(seeds, below, dir)
        }),
      )
      expect(failures.flat().slice(0, 3).join('\n\n')).toBe('')
    })
  },
)

const sameRows = ({ js, rs }: { js: string[]; rs: string[] }) =>
  js.join('') === rs.join('')

// Each graph on its own, which only a failed batch pays for
async function failingSeeds(seeds: number[], below: number, dir: string) {
  const failures: string[] = []
  for (const seed of seeds) {
    const graph = gfa(randomRgfa(seed))
    const folds = await bothFolds(graph, below, dir, `${seed}-${below}`).catch(
      (e: unknown) => String(e),
    )
    if (typeof folds === 'string' || !sameRows(folds)) {
      failures.push(
        `randomRgfa(${seed}) folded at ${below} bp\n${graph}\n${typeof folds === 'string' ? folds : rowDiff(folds)}`,
      )
    }
  }
  return failures
}

function rowDiff({ js, rs }: { js: string[]; rs: string[] }) {
  const a = js.join('').split('\n')
  const b = rs.join('').split('\n')
  return [
    ...a
      .filter(row => !b.includes(row))
      .map(row => `bandage-fold only: ${row}`),
    ...b
      .filter(row => !a.includes(row))
      .map(row => `gfa-to-tabix fold only: ${row}`),
  ].join('\n')
}
