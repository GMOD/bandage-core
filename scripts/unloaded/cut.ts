import { WalkReader, walksKept } from '@jbrowse/graph-walks'
import { LocalFile } from 'generic-filehandle2'

export interface Window {
  start: number
  end: number
}

export const openWalks = (path: string) =>
  WalkReader.open(path, url => new LocalFile(url))

export type Reader = ReturnType<typeof openWalks>

export function flag(name: string) {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? undefined : process.argv[at + 1]
}

export const parseWindow = (text: string): Window => {
  const [start = 0, end = 0] = text.replaceAll(',', '').split('-').map(Number)
  return { start, end }
}

export const windowText = ({ start, end }: Window) => `${start}-${end}`

/**
 * A window's tables as the plugin's walk rows cut them: no budget on steps,
 * the walks of `haplotypes` (every walk when undefined), and with `loaded`
 * every abridged piece read in full. `gaps` passes the cut's stretches too.
 */
export async function cutTables(
  reader: Reader,
  refName: string,
  region: Window,
  o: { haplotypes?: string[]; loaded?: boolean; gaps?: boolean } = {},
) {
  const { graph, kept, fragments, departures, gaps } = await reader.cut(
    refName,
    region,
    {
      stepBudget: Infinity,
      byteBudget: Infinity,
      departureByteBudget: Infinity,
      nodeLimit: Infinity,
      keep: walksKept(o.haplotypes, refName),
      ...(o.loaded ? { expand: () => true } : {}),
    },
  )
  return o.gaps
    ? graph.tables(kept, fragments, departures, gaps)
    : graph.tables(kept, fragments, departures)
}
