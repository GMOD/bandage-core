import type { GeneModel } from './genePins'

type Interval = GeneModel['exons'][number]

// Top-level types that are a gene or stand for one. NCBI's GFF also puts
// alignments, repeats and regulatory regions at the top level, named by uuid.
const GENE_TYPE = /(gene|gene_segment|RNA|transcript)$/i

const isGene = (type: string) =>
  GENE_TYPE.test(type) || type === 'CDS' || type === 'exon'

export function mergedIntervals(intervals: Interval[]) {
  const out: Interval[] = []
  for (const iv of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1)
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end)
    } else {
      out.push({ ...iv })
    }
  }
  return out
}

function strandOf(s: string | undefined) {
  return s === '+' ? 1 : s === '-' ? -1 : 0
}

function unescape(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function attributes(column: string) {
  const out = new Map<string, string>()
  for (const pair of column.split(';')) {
    const eq = pair.indexOf('=')
    if (eq > 0) {
      out.set(pair.slice(0, eq).trim(), unescape(pair.slice(eq + 1).trim()))
    }
  }
  return out
}

interface Gff3Row {
  refName: string
  type: string
  start: number
  end: number
  strand: number
  attrs: Map<string, string>
}

function gff3Row(line: string): Gff3Row | undefined {
  const cols = line.split('\t')
  const start = Number(cols[3])
  const end = Number(cols[4])
  if (cols.length < 9 || !Number.isInteger(start) || !Number.isInteger(end)) {
    return undefined
  }
  return {
    refName: cols[0]!,
    type: cols[2]!,
    start: start - 1,
    end,
    strand: strandOf(cols[6]),
    attrs: attributes(cols[8]!),
  }
}

// GFF3 lines as genes: each top-level feature with the exons of every
// transcript under it merged, found by climbing `Parent`, or by `gene_id` for a
// line with neither `ID` nor `Parent`. A gene with no exons is one exon, its
// whole span. GFF's 1-based closed spans become 0-based half-open.
export function genesFromGff3Lines(lines: Iterable<string>): GeneModel[] {
  const rows: Gff3Row[] = []
  for (const line of lines) {
    if (line.startsWith('##FASTA')) {
      break
    }
    const row = line.startsWith('#') ? undefined : gff3Row(line)
    if (row) {
      rows.push(row)
    }
  }
  const parentOf = new Map<string, string>()
  for (const { attrs } of rows) {
    const id = attrs.get('ID')
    const parent = attrs.get('Parent')?.split(',')[0]
    if (id && parent) {
      parentOf.set(id, parent)
    }
  }
  const rootOf = (row: Gff3Row) => {
    let id = row.attrs.get('Parent')?.split(',')[0] ?? row.attrs.get('ID')
    if (!id) {
      return row.attrs.get('gene_id')
    }
    const seen = new Set<string>()
    while (id && parentOf.has(id) && !seen.has(id)) {
      seen.add(id)
      id = parentOf.get(id)
    }
    return id
  }
  const groups = new Map<string, { top?: Gff3Row; rows: Gff3Row[] }>()
  rows.forEach((row, i) => {
    const root = rootOf(row) ?? `#${i}`
    const key = `${row.refName}\t${root}`
    const group = groups.get(key) ?? groups.set(key, { rows: [] }).get(key)!
    group.rows.push(row)
    if (!row.attrs.has('Parent') && !group.top) {
      group.top = row
    }
  })
  const genes: GeneModel[] = []
  for (const [key, { top, rows }] of groups) {
    if (top && !isGene(top.type)) {
      continue
    }
    const first = top ?? rows[0]!
    const start = top?.start ?? Math.min(...rows.map(r => r.start))
    const end = top?.end ?? Math.max(...rows.map(r => r.end))
    const a = first.attrs
    const exons = rows
      .filter(r => r.type === 'exon')
      .map(r => ({ start: r.start, end: r.end }))
    genes.push({
      name:
        a.get('Name') ??
        a.get('gene_name') ??
        a.get('gene') ??
        a.get('gene_id') ??
        key.split('\t')[1]!,
      refName: first.refName,
      start,
      end,
      strand: first.strand,
      exons: exons.length ? mergedIntervals(exons) : [{ start, end }],
    })
  }
  return genes
}

// BED3 to BED12 as genes, one per name and contig: rows sharing a name, the
// transcripts of one gene, have their blocks merged. A row with no blocks is
// one exon, its whole span.
export function genesFromBed(text: string): GeneModel[] {
  const genes = new Map<string, GeneModel>()
  for (const line of text.split('\n')) {
    const cols = line.replace(/\r$/, '').split('\t')
    const start = Number(cols[1])
    const end = Number(cols[2])
    if (
      /^(#|track|browser)/.test(line) ||
      cols.length < 3 ||
      !Number.isInteger(start) ||
      !(end > start)
    ) {
      continue
    }
    const refName = cols[0]!
    const name = cols[3] || `${refName}:${start + 1}-${end}`
    const sizes = cols[10]
      ?.split(',')
      .filter(s => s !== '')
      .map(Number)
    const starts = cols[11]
      ?.split(',')
      .filter(s => s !== '')
      .map(Number)
    const blocks =
      sizes?.length && sizes.length === starts?.length
        ? sizes.map((size, i) => ({
            start: start + starts[i]!,
            end: start + starts[i]! + size,
          }))
        : [{ start, end }]
    const key = `${refName}\t${name}`
    const gene = genes.get(key)
    if (gene) {
      gene.start = Math.min(gene.start, start)
      gene.end = Math.max(gene.end, end)
      gene.exons = mergedIntervals([...gene.exons, ...blocks])
    } else {
      genes.set(key, {
        name,
        refName,
        start,
        end,
        strand: strandOf(cols[5]),
        exons: mergedIntervals(blocks),
      })
    }
  }
  return [...genes.values()]
}

// A BED file's second and third columns are numbers; a GFF3 file's second is
// its source
export function genesFromText(text: string) {
  const first = text
    .split('\n', 1000)
    .find(l => l.trim() !== '' && !/^(#|track|browser)/.test(l))
  const cols = first?.split('\t') ?? []
  return /^\d+$/.test(cols[1] ?? '') && /^\d+$/.test(cols[2] ?? '')
    ? genesFromBed(text)
    : genesFromGff3Lines(text.split(/\r?\n/))
}
