const flip = (strand: string | undefined) => (strand === '-' ? '+' : '-')
const side = (strand: string | undefined) => (strand === '-' ? '-' : '+')

// One key for a link whichever of its two spellings an L line uses:
// `L a + b +` is `L b - a -`. A GFA that states a link twice, or once each
// way round, keeps its first L line for it, as gfa-to-tabix reads a GFA.
export function linkKey(
  source: string,
  strand1: string | undefined,
  target: string,
  strand2: string | undefined,
) {
  const stated = `${source}\t${side(strand1)}\t${target}\t${side(strand2)}`
  const turned = `${target}\t${flip(strand2)}\t${source}\t${flip(strand1)}`
  return stated < turned ? stated : turned
}
