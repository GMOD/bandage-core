// Write the GFA of one bubble's segments, so a bubble picked off the variant
// map can be drawn on its own: PangyPlot's "pop a bubble", done as a cut.
//   node popbubble.mjs <in.gfa> <out.gfa> s1,s2,...
import { readFileSync, writeFileSync } from 'node:fs'
const [inFile, outFile, idList] = process.argv.slice(2)
const keep = new Set(idList.split(','))
const out = []
for (const line of readFileSync(inFile, 'utf8').split('\n')) {
  const f = line.split('\t')
  if (f[0] === 'S' && keep.has(f[1])) out.push(line)
  else if (f[0] === 'L' && keep.has(f[1]) && keep.has(f[3])) out.push(line)
  else if (f[0] === 'H') out.push(line)
}
writeFileSync(outFile, out.join('\n') + '\n')
console.log(`${out.length} lines`)
