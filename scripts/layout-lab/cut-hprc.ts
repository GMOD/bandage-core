// dump-subgraph.ts plus the adapter's hop rule (RgfaTabixAdapter.getSubgraph),
// so a cut matches what the view draws at its default subgraphContext of 1.
//
//   node scripts/layout-lab/cut-hprc.ts <prefix> GRCh38 chr6 160525000 160655000 out.gfa 1
//
// <prefix> is a LOCAL tabix pair without its suffix; @gmod/tabix's `path` does
// not fetch urls, so download the four files from jbrowse.org/demos/hprc first.
import fs from 'node:fs'
import { TabixIndexedFile } from '@gmod/tabix'
import {
  formatSubgraph,
  linkKey,
  parseLinkLine,
  parseSegmentLine,
} from '../../src/RgfaTabixAdapter/rgfaBed.ts'
import type {
  RgfaLink,
  RgfaSegment,
} from '../../src/RgfaTabixAdapter/rgfaBed.ts'
const [uri, panSN, refName, start, end, out, hopsArg] = process.argv.slice(2)
const hops = Number(hopsArg ?? 1)
const segs = new TabixIndexedFile({ path: `${uri}.segs.bed.gz` })
const linksFile = new TabixIndexedFile({ path: `${uri}.links.bed.gz` })
const segments = new Map<string, RgfaSegment>()
const links = new Map<string, RgfaLink>()
const names = await segs.getReferenceSequenceNames()
const tabixRefName =
  names.find(n => n === `${panSN}#0#${refName}`) ??
  names.find(n => n.startsWith(`${panSN}#`) && n.endsWith(`#${refName}`)) ??
  names.find(n => n === refName)
if (!tabixRefName) throw new Error('no refName')
const addLinksOver = async (ref: string, s: number, e: number) => {
  const reached: RgfaSegment[] = []
  await linksFile.getLines(ref, s, e, {
    lineCallback: line => {
      const link = parseLinkLine(line)
      links.set(linkKey(link), link)
      for (const seg of [link.sourceSegment, link.targetSegment]) {
        if (!segments.has(seg.id)) {
          segments.set(seg.id, seg)
          reached.push(seg)
        }
      }
    },
  })
  return reached
}
await segs.getLines(tabixRefName, Number(start), Number(end), {
  lineCallback: line => {
    const s = parseSegmentLine(line)
    segments.set(s.id, s)
  },
})
let frontier = (
  await addLinksOver(tabixRefName, Number(start), Number(end))
).filter(s => s.rank > 0)
for (let h = 0; h < hops; h++) {
  const reached = await Promise.all(
    frontier.map(s => addLinksOver(s.refName, s.start, s.end)),
  )
  frontier = reached.flat().filter(s => s.rank > 0)
}
fs.writeFileSync(out!, `${formatSubgraph(segments, links)}\n`)
console.log(out, segments.size, 'segments,', links.size, 'links')
