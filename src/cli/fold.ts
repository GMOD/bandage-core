/// <reference types="node" />

import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { foldVariants } from '../foldVariants'
import { writeRgfa } from '../gfa/writeRgfa'
import { loadGraph } from '../pipeline'
import { decodeText } from './decodeText'

// bandage-fold: a graph with every variant under --below bp folded into the
// reference, as rGFA. Indexed by gfa-to-tabix, the result is a graph track's
// coarse tier, which draws what the same fold of a fine cut draws:
//
//   bandage-fold graph.gfa.gz --below 10000 | gfa-to-tabix - -o graph.tier10000
//
// A path GFA folds on the coordinates its paths give each segment, and its
// walks are dropped: a tier carries none. A segment the path placing it reads
// reversed is written forward with its links flipped, so the output re-reads
// as the graph that was folded.

const USAGE =
  'usage: bandage-fold <graph.gfa[.gz] | -> --below <bp> [--reference <path>] [-o out.gfa]'

async function readInput(location: string) {
  return decodeText(await readFile(location === '-' ? '/dev/stdin' : location))
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      below: { type: 'string' },
      out: { type: 'string', short: 'o' },
      reference: { type: 'string' },
    },
  })
  const below = Number(values.below)
  const input = positionals[0]
  if (!input || !(below > 0)) {
    throw new Error(USAGE)
  }
  const graph = loadGraph(await readInput(input), input, {
    referencePath: values.reference,
  })
  const folded = foldVariants({ ...graph, paths: undefined }, below)
  const text = writeRgfa(folded)
  if (values.out) {
    await writeFile(values.out, text)
  } else {
    process.stdout.write(text)
  }
  process.stderr.write(
    `${graph.nodes.length} segments, ${graph.edges.length} links -> ${folded.nodes.length} segments, ${folded.edges.length} links\n`,
  )
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
