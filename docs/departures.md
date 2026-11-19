# Walk rows and departures

A walk-file cut shows one window of the reference, but a haplotype's sequence
does not always stay in it. The haplotype can leave the reference and rejoin it
far away, run past the edge of the window, or hold sequence the graph left out.
The cut lists each such place as a departure, so bandage-core can label each
walk row with the haplotype's full length and where the bp it does not draw are.
A short bar then does not read as a deletion.

## Readout words

| Readout                             | Meaning                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `out of view`                       | bp the cut trimmed at the edge of the window                                                         |
| `left out of graph`                 | bp of the haplotype that the graph lacks                                                             |
| `near chr22:20.3 Mb`                | bp the walk spends back on the reference, rejoining it near that position                            |
| `own sequence not drawn`            | bp of the haplotype's sequence that the cut did not read                                             |
| `no step on GRCh38 across 54 kb`    | the haplotype has no step in the window, so the row is a hairline between its departure's ends       |
| `≥ 0.5 kb · goes on near chr1:4 kb` | the walk runs past a flank, so its length is a lower bound                                           |
| `placement choice`                  | a departure ends on a node the reference passes more than once, and the file's writer chose the pass |
| `nodes not shown`, `· not compared` | the row holds a piece the cut did not load                                                           |

## Pieces not loaded

gfa-to-tabix abridges the heaviest walks in a tile, usually a satellite array,
and a cut that does not expand such a walk gets the bp of each piece but not its
nodes. bandage-core draws the piece in hollow, untinted grey: a bar in walk
rows, a `placeholder` node in a node layout, and a dashed box captioned
`nodes not shown` in the tube map. Ribbons, shared blocks and the shared row
order compare nodes, so they leave out a row with such a piece, and its readout
ends `· not compared`.

## What a host does

- Pass `departures` through to `loadGraph`. `GraphTables` requires them, and a
  source with none, such as GFA text, passes `departureTable()`
- Place each row's readout with `walkRowReadoutAt`, which cuts the text to the
  room beside the bar by whole parts
- Show each row's `departures` on hover
- When `rowsNeedingRoutes(rows)` is above zero, load those rows' `abridgedSteps`
  before relying on ribbons or the shared row order
- Draw a placeholder in a key as `NOT_LOADED_CSS` around `NOT_LOADED_FILL_CSS`,
  named `NOT_LOADED_TEXT`
- Write a GFA for another tool from a cut with every piece loaded.
  `graphTablesGFA` tags a placeholder's S line `nl:i:1`, which other tools
  ignore, so they read the line as a real segment
