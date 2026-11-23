# Walk rows and departures

A walk row is a bar for one haplotype, showing how much sequence it has across
the region you are viewing. When bandage-core reads a region from a walk file,
it also gets each haplotype's departures: the places where the haplotype stops
following the reference, and where it starts following it again. Every deletion,
insertion, inversion and duplication is a departure.

- When both ends of a departure are inside the region, the bar shows the variant
  directly
- When one end is outside the region, the bar stops early. From the departure,
  bandage-core writes beside the bar where the haplotype goes next and how long
  it is, so the short bar does not look like a deletion
- Each bar is the haplotype's own sequence at one scale for every row, not the
  ruler's: a bar holding an insertion is longer than the region, and one with a
  deletion shorter. A bar starts at the left edge where the haplotype comes into
  the region there, and under the reference row's base it starts at where it
  starts inside the region
- A haplotype that crosses the region more than once, as a contig with a
  duplication or an inversion can, is one bar from its first base in the region
  to its last. What it does outside the region in between is a thin gap, and a
  stretch it walks against the reference's direction runs its colors backwards

## A deletion at GSTM1

In the HPRC graph, HG002#2, HG00097#1, HG00097#2 and HG01960#2 lack 18 kb of
GRCh38 around GSTM1, from chr1:109,683,912 to 109,702,357.

In the region chr1:109,680,000-109,700,000, the deletion starts inside the
region and ends 2.4 kb past it. The four bars stop after 3.9 kb, and the text
beside each reads `≥ 3.9 kb · goes on near chr1:109.7 Mb · 0 bp of its own`. At
least 3.9 kb of the haplotype is in view, it follows the reference again near
109.7 Mb, and it has no sequence of its own in between, so this is a deletion.

![Walk rows for chr1:109,680,000-109,700,000. GRCh38, HG01960#1 and HG002#1 run the full 20 kb. HG00097#1, HG00097#2, HG002#2 and HG01960#2 stop after 3.9 kb, each labelled "≥ 3.9 kb · goes on near chr1:109.7 Mb · 0 bp of its own"](../img/departure_gstm1_cut.svg)

In the wider region chr1:109,680,000-109,720,000, both ends of the deletion are
inside the region, and the four bars are drawn 18 kb shorter than GRCh38:

![Walk rows for chr1:109,680,000-109,720,000. GRCh38, HG01960#1 and HG002#1 run 40 kb. The four other rows run 22 kb, labelled "22 kb (−18 kb)", their color jumping from orange to cyan where they skip the deleted sequence](../img/departure_gstm1_whole.svg)

## The text beside a bar

In a bar, the rainbow colors are positions on the reference, and charcoal is
sequence off the reference. White chevrons pointing left mark a stretch the
haplotype walks against the reference's direction, where its colors run
backwards.

| Text                                              | Meaning                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `≥ 3.9 kb`                                        | at least this much of the haplotype is in view, and it continues past the edge of the region                                                                                                                                                                                                    |
| `4910 kb of its contig`                           | a bar that crosses the region more than once or leaves it in between: its contig from its first base in the region to its last, not a length over the region                                                                                                                                    |
| `goes on near chr1:109.7 Mb`                      | where the haplotype follows the reference again, outside the region                                                                                                                                                                                                                             |
| `comes from near chr22:11.8 Mb`                   | where the haplotype was on the reference before the start of the bar                                                                                                                                                                                                                            |
| `turns back out of the window`                    | the haplotype comes into the region and leaves it on the same side                                                                                                                                                                                                                              |
| `0 bp of its own`, `120 kb of its own`            | the haplotype's sequence between leaving the reference and following it again; 0 bp is a deletion                                                                                                                                                                                               |
| `no step on GRCh38 across 54 kb`                  | the haplotype skips the whole region, so it is drawn as a thin line between where it leaves and returns                                                                                                                                                                                         |
| `contig starts inside the window`                 | the haplotype's contig begins at the bar's end                                                                                                                                                                                                                                                  |
| `9.2 Mb before it not drawn or left out of graph` | the haplotype's contig goes on before the bar's end, in sequence that is missing from the graph or in pieces that never follow the reference                                                                                                                                                    |
| `no more of the contig on GRCh38's path`          | the graph holds none of the haplotype's contig past the bar's end on the reference                                                                                                                                                                                                              |
| `of which 4.0 kb reversed`                        | the bar's bp walked against the reference's direction, drawn with chevrons                                                                                                                                                                                                                      |
| `//` across a gap                                 | a gap longer than the region, drawn a quarter of the region long; the text beside the bar gives its length                                                                                                                                                                                      |
| `left out of graph`                               | sequence of the haplotype that is missing from the graph                                                                                                                                                                                                                                        |
| `out of view`                                     | sequence past the edge of the region                                                                                                                                                                                                                                                            |
| `near chr22:20.3 Mb`, inside a gap                | sequence the haplotype spends on another part of the reference, returning near that position, as between two passes over the region                                                                                                                                                             |
| `own sequence not drawn`                          | sequence of the haplotype that was not loaded with the region                                                                                                                                                                                                                                   |
| `off GRCh38's path`                               | replaces `of its own` and `own sequence not drawn` when the walk file counts reference nodes the reference passes more than once, as in a collapsed repeat; sequence off the reference may then be a copy of that repeat. `walkRows` takes a `revisited` option that overrides the file's count |
| `1.0 kb GRCh38 from elsewhere`                    | reference sequence the haplotype follows at another pass of the reference, outside the region; it is drawn off the path, and counted as reference sequence                                                                                                                                      |
| `· 20 departures on 4 other contigs`              | on a haplotype's first row: departures in the region from its other contigs, which are not given separate rows                                                                                                                                                                                  |
| `placement choice`                                | the haplotype leaves or returns at a node the reference passes more than once, and the file's writer picked which pass                                                                                                                                                                          |
| `nodes not shown`, `· not compared`               | part of the haplotype was loaded as a length only (see below)                                                                                                                                                                                                                                   |

## Parts loaded as a length only

Where some haplotypes pass through very many nodes, usually in a satellite
array, gfa-to-tabix stores those haplotypes' nodes separately. A viewer that
does not ask for them gets only the length of each such part. bandage-core draws
it hollow and grey: as a bar in walk rows, a node in the graph layouts, and a
dashed box labelled `nodes not shown` in the tube map. bandage-core builds
ribbons, shared blocks and the shared row order by comparing nodes, so it leaves
these haplotypes out of them and ends the text beside their bars with
`· not compared`.

## For a host app

- Pass `departures` to `loadGraph` with the rest of the tables. The field is
  required, so for a source with no departures, such as GFA text, pass
  `departureTable()`
- Place the text beside each bar with `walkRowReadoutAt`, which shortens it to
  fit by dropping whole parts
- Show each row's `departures` in its hover text
- When `rowsNeedingRoutes(rows)` is above zero, load those rows' `abridgedSteps`
  before relying on ribbons or the shared row order
- In a key, draw the hollow grey as `NOT_LOADED_CSS` around
  `NOT_LOADED_FILL_CSS`, labelled `NOT_LOADED_TEXT`
- Load every part before writing a GFA for another tool. `graphTablesGFA` tags a
  part loaded as a length only with `nl:i:1` on its S line, which other tools
  ignore, so they would read it as a real segment
