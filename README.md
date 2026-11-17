# @jbrowse/bandage-core

TypeScript library that lays out and draws pangenome graphs, used by
[jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
and [BandageJS](https://github.com/cmdcolin/BandageJS). It imports no React,
MobX or JBrowse code. BandageJS's
[`src/main.ts`](https://github.com/cmdcolin/BandageJS/blob/main/src/main.ts) is
the worked example.

```
npm install @jbrowse/bandage-core
```

## Reading a graph

- `loadGraph` reads GFA or rGFA text. The caller decompresses a `.gfa.gz` first
- `loadGraph` also takes `GraphTables`, the typed arrays that
  [@jbrowse/graph-walks](https://github.com/GMOD/graph-walks) 7 cuts from a
  [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix) 5 walk file, format 8
  (`.walks.gz` beside its `.idx` directory), for a region on the reference.
  graph-walks 7 refuses a format 7 file, which gfa-to-tabix 5 rebuilds. A worker
  can transfer them without copying, and `graphTablesGFA` writes their nodes,
  links and walks as GFA
- A link a GFA states more than once, either way round, is read once, as its
  first L line states it, as gfa-to-tabix reads it
- `openGbz` and `cutGbzRegion` cut a window from a
  [gbz-base](https://github.com/jltsiren/gbz-base) database (`.gbz.db`) to GFA
  text

### Departures

A walk-file cut's tables carry `departures`: every place over the window where a
haplotype's consecutive steps on the reference are not adjacent there, with the
breakpoint and strand of each end, the haplotype's own bp between them (`ownBp`,
from `hapStart` on its contig), the part of that the graph lacks (`missingBp`)
and how many times the reference passes each end's node. `src/gfa/departures.ts`
reads them.

- Walk rows draw the facts and make no call on what a departure is. A haplotype
  with no step in the window is a `stepless` row, a hairline under the reference
  between its departure's ends:
  `no step on GRCh38 across 54 kb · 120 kb of its own, 3 kb left out of graph`.
  A haplotype that walks the window draws no row for its other contigs'
  departures over it; its first row counts them:
  `· 20 departures on 4 other contigs`
- A gap between two pieces of a walk splits into the bp the cut trimmed
  (`out of view`), the bp the departures inside it say the graph lacks
  (`left out of graph`), and the rest: the walk's own sequence the cut did not
  read (`own sequence not drawn`), or, where the walk goes back to the
  reference, `near chr22:20.3 Mb`, where it rejoins. The readout states them as
  parts of the row's bp:
  `5361 kb (+5360 kb), of which 5096 kb left out of graph, 178 kb near chr22:12.0 Mb, 86 kb out of view`
- A walk reaching one flank reads as a lower bound. Its contig ends inside the
  window only where its last step there is on the reference, with no departure
  at that step and nothing the cut trimmed past it. A departure there says where
  the walk goes on: `≥ 500 bp · goes on near chr1:4 kb · 4 kb of its own`. A
  walk whose only step is a flank has no bp in the window and says just how it
  goes on or that its contig ends at the window. A cut with no context stands
  the reference's outermost nodes in for the flanks, so a walk that stops inside
  reads the same way there rather than as a whole walk shorter than the
  reference
- A row whose departure has an end on a node the reference passes more than once
  says `placement choice`: the file's writer chose that pass
- A run off the reference is the walk's own sequence only where the source
  counts no node the reference passes more than once (`revisited` 0 on the
  tables and the Graph built from them: the walk file's header, or a GFA's own
  walks); elsewhere it may be a copy of a repeat the reference holds. Where the
  count is above 0, or the source cannot state it (a gbz-base cut), every amount
  that would read `of its own`, `its own` or `own sequence not drawn` reads
  `off GRCh38's path` instead. `walkRowRuns` and `walkRows` take a `revisited`
  option that overrides the source's
- Each row's `departures` lists those its runs do not draw as steps, for a
  host's hover
- A piece of a walk the cut did not load draws exactly as the loaded piece does:
  its steps on the reference where they lie, and each run of steps off the
  tile's reference as a bar off the path of its bp, a `WalkRun` with `unloaded`.
  The row states `unloadedBp`, and `abridgedSteps` the steps of its unloaded
  pieces, for a host to load or offer to load
- A bar off the path (charcoal under the reference ramp) is sequence off the
  reference path as far as the cut has read it
- A step the walk file states on the reference at a pass the cut does not hold
  draws off the path too, as a `WalkRun` with `fromElsewhere`, and reads as the
  reference's sequence, never the walk's own:
  `its own 2.5 kb and 1.0 kb GRCh38 from elsewhere in place of GRCh38's 3.0 kb`,
  or as a part of the row's bp, `, of which 1.0 kb GRCh38 from elsewhere`. The
  key then reads `off GRCh38#0's path, or GRCh38#0 from elsewhere`
- Ribbons, shared blocks and the shared row order compare nodes, which a run not
  loaded does not name, so they leave out a row holding one;
  `rowsNeedingRoutes(rows)` says how many rows they left out, for a host to load
  before relying on them. While one is on, such a row's readout ends
  `· not compared`, and the key says `Fetching node-level detail for N rows`
  within the host's fetch limit, or that it leaves them out beyond it
- `walkRowReadoutAt` places a row's readout for every host: its full text, the
  text drawn, which is cut to the room beside the bar by whole parts with `…`,
  whether it was cut, and where it sits
- In a node layout such a run is a node with `placeholder`, drawn hollow in an
  untinted grey at its bp under every color scheme, so it reads as neither
  sequence, an exon nor an allele off the reference. A host's key draws it as
  `NOT_LOADED_CSS` around `NOT_LOADED_FILL_CSS` and names it `NOT_LOADED_TEXT`,
  as `figureSvg`'s key does. Its length is written on its loop, or stacked off
  the loop's middle with a leader, longest first, while fewer stacked lengths
  stand than the pane rations node labels, and only where its box lies whole on
  the pane. Placeholders whose middles lie nearer one another than a label is
  tall take one length between them, the longest's, whether or not their loops
  could hold it, and two lengths of one text stand at least a line apart;
  `layoutLabels` returns the placeholders left without one as `unlabelled`, and
  a host hands that to `graphKey`, which writes `N unlabelled, X or less each`
  under the entry. A loop of loaded nodes, what a drawn walk steps on between
  two steps on the reference (`walkLoops`), writes its length where it is drawn
  long enough to hold it and its bp at the reference's px a bp comes to
  `SMALL_SITE_PX`, the measure a site small in bp folds by, so a loop of a few
  bp writes none at overview and writes it at the zoom where such a site is
  drawn. The length covers no ink but the loop's own stroke, that of the loops
  drawn over it included, running under it once: it stands at the first spot
  along the loop from its middle where that holds, else off the loop's middle
  with a leader at the nearest spot whose box covers no node's or link's ink,
  else nowhere, and the key does not count it. It goes after the placeholders
  and before every other label; a loop sharing half the bp of a longer one is
  drawn over it, and the longer writes the span of their lengths,
  `20.5–20.9 kb`. `layoutLabels` reads the walks from its `graph` and the ink
  from its `drawnBatch`, the batch the pane paints, and writes no loop's length
  without one. In the tube map, where loading turns one box into its nodes, it
  is a box with a dashed outline and no tint, captioned
  `300 bp · nodes not shown`. `loadGraph`'s `maxNodes` counts placeholders,
  which graph-walks' `nodeLimit` does not, and its refusal says how many there
  are. `graphTablesGFA` tags a placeholder's S line `nl:i:1`, which only
  bandage-core reads back: another tool ignores the tag and takes the line for a
  real segment off the reference. A GFA meant for another tool must be written
  from a cut with every piece loaded
- `GraphTables` mirrors graph-walks 7's, and `typecheck/graphWalks.ts` holds the
  two equal. `departures` is required, so tables from a reader that states none
  fail to compile; a source with none, such as GFA text or a gbz-base cut,
  passes `departureTable()`

## Laying out and drawing

- `loadBandage` loads Bandage's FMMM engine, compiled to WASM in
  [@jbrowse/graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout), and
  `forceLayout` runs it. The other layouts are ordered, anchored, sample rows,
  walk rows and tube map
- Under the stress engine, which lays the reference straight, `forceLayout`
  moves each node off the reference out of the reference's ink at the smallest
  fit a host opens a graph at, so alleles denser than the pixels sit beside the
  line on their links (`clearOfReference`). FMMM bends the reference, where a
  push along each node's own normal fanned loops into blobs round the bends and
  stood alleles off the line as teeth, so under FMMM `forceLayout` leaves every
  node where the engine laid it
- A host passes `forceLayout` the size in px it will fit the drawing to, the
  pane it hands `fitTransform`: under the stress engine the gap kept between the
  reference and what lies beside it, and under `compress` the shortest loop off
  it, are sized in px at that fit. The layout is the same for the same fit, and
  a host that states none gets one sized for the default figure's width and a
  JBrowse track's default height
- A host whose key stands down the pane's right edge takes that size from
  `fitBesideKey`, the pane less the key's column, and hands its width and height
  to `fitTransform` as well as `forceLayout`, so no node or gene pin lies under
  the key, whose column `layoutLabels` keeps every label out of
- A host that cuts more graph than its window shows, as a linear view's track
  holds one cut while its view pans across it, places the drawing with
  `cutScale` and `followTransform` rather than `fitTransform`.
  `referenceProfile` reads the reference as the layout drew it, piece by piece
  in bp order. `cutScale` is the cut's scale at the view's width: the widest
  stretch of the reference that any window that wide inside the cut takes in
  spans the pane, capped so what the windows inside the cut show is no taller
  than the pane: `shownBounds`, the reference over the cut and what hangs from
  it inside the cut, but not a loop off where the cut's edge runs through a
  reference node, which no window shows whole and which may run past the pane as
  a departure's tail does. It reads the cut, its layout, the view's width and
  the pane, never where the view is, so at one width every window the cut holds
  is drawn at one scale, and a zoom changes it smoothly. `followTransform` then
  only translates: the reference in the window lies where the window puts its bp
  across the pane, as nearly as a rigid drawing can in the least-squares sense
  over the bp the window holds, moved no further than keeps the window's stretch
  inside the pane's edges (not its padding, so the slide is even wherever it
  fits). A pan is a pure slide, a zoom magnifies about the window's reference,
  and a window is drawn no wider than the pane
- How a drawing a window places meets the pane's height is the host's
  `trackFit`, named as JBrowse names a track's sizing. `fit`, the default
  (`DEFAULT_TRACK_FIT`), is the capped scale above: the whole cut is scaled into
  the height. `fixed` draws at the window's scale alone (`windowScale`), so a
  zoom magnifies it; `windowTranslateY` keeps the window's own reference on the
  pane, and `edgeOverruns` says where the drawing crosses the pane's top or
  bottom, for the host to mark. `grow` draws as `fixed` does in a pane as tall
  as the cut at that scale (`grownHeight`), up to the host's cap
- `buildGeometry` and `Canvas2DRenderer` draw to a canvas, with hit testing and
  label placement. The library also finds bubbles and deletion edges and colors
  paths
- A link's head says which way it is read. Along a run of links that all point
  one way, each node between two of them having those two links and no other,
  one at each end, the run keeps one head per `LINK_HEAD_SPACING_PX` of its
  length on screen and at least one, each at the joint nearest an even share of
  that length, so a long chain of short nodes never beats out a rhythm that
  reads as a skip's dashes. A link at a node with more links, a skip, and a link
  turning strand against the reference keep their heads
- A force layout runs each skip through a route node and the skip follows it.
  Where most of a dashed skip's route lies within `ALONG_STRETCH_PX` of the
  stretch of reference it skips, from its first foot through the skipped nodes
  as laid to its last, its dashes would lie over the very nodes it skips, so it
  is drawn instead as an arch between its feet whose apex clears that stretch,
  on the side away from where the skipped nodes lean off its chord. A skip too
  short on screen for its dashes keeps its route
- A departure's tail, own steps of a haplotype on its way to or from a place
  past the cut, ends in a dark tab past each free end no drawn link meets, the
  reference strip's tab laid along the node: the graph runs on from there past
  what the drawing holds. The key names it `graph runs on past what is drawn`,
  and `figureData`'s `arrows` table lists it with `runsOn`
- `walkLift` lifts a walk out of the drawing, `facetLifts` and `facetGrid` draw
  one panel per walk, and `walkKey` describes each walk in words
- `graphBackbone`, `backboneAssembly` and `assemblyWalk` find which assembly a
  backbone lies on. `featuresOnBackbone` renames that assembly's genes onto the
  backbone's refNames, and `genePins` pins only those
- `layoutLabels` names a gene at its pin, or, where the pane does not show the
  pin, at the nearest point of the gene the pane shows; a gene the pane shows
  none of is not named. A copy on the reference whose stretch the reference
  walks over nodes it passed before, as a collapsed repeat's later copies, keeps
  its exons and no name (`GenePin.anchored`). A gene partly in the cut says how
  much of it the drawing holds, each amount in its own unit: `8.2 kb of 1.4 Mb`

## Small sites

- At overview a drawing shows the graph's structure, not every SNP. By default
  (`smallSites: 'hidden'`) `buildGeometry` leaves out a site too small to draw
  at the current scale: an off-reference piece (the nodes off the reference
  joined to each other, with the links that attach them) or a skip, drawn under
  `SMALL_SITE_PX`: its own nodes and links, and the reference between where it
  attaches as that is drawn, its nodes and its own links there, in px at the
  scale. `smallSites: 'nodes'` draws everything
- A site is measured as the drawing shows it, whatever its bp: a force layout
  draws a short node at a least length and a link at a set length, so a 1 bp
  allele the layout draws several px across stays drawn, and a skip is measured
  along the reference it skips, never by how close the layout set its ends. A
  link is measured along the curve drawn. Identical sites laid alike fold
  together; laid differently, each folds at the scale its own drawing comes to
  `SMALL_SITE_PX`
- A piece laid inside the reference's stroke shows no length of its own, so it
  is measured by its bp at the reference's px per bp, and folds where that is
  under `SMALL_SITE_PX`: every point of its nodes' laid lines and of its links'
  curves lies within half the stroke's width of the laid line of a reference
  node wholly between its attachments, or of a point where one of its links
  meets the reference, the width being the least drawn width of those reference
  nodes and the ones its links meet. It folds only where at the deepest zoom its
  bp comes to `SMALL_SITE_PX` and a point of its nodes' laid lines lies out of
  that stroke, so zooming in draws it again; a piece laid on the reference's own
  line, which no zoom draws apart from it, stays drawn
- A not-loaded placeholder is drawn at that least length whatever its bp, so a
  piece holding one is measured by the smaller of its drawn length and its bp at
  the reference's px per bp, the drawn length of the reference's nodes over
  their bp. A small one folds with whatever hangs only from it, and its length
  label with it. Larger placeholders are structure and stay
- A departure's steps to or from a place past the cut, whose other end the cut
  does not hold, fold only where every one of them is a not-loaded placeholder,
  measured by their bp alone at the reference's px per bp; zooming in draws them
  again like any site
- Nothing on the reference is folded, nor a link turning the reference back on
  itself, nor what no shown walk steps. Nor is a piece that turns strand, whose
  attachments all touch the same end of their reference nodes; a piece reaching
  a reference node the cut did not load or a second reference sequence; a piece
  holding a loaded node of a departure's steps to or from a place past the cut,
  whose other end the cut does not hold, which is structure going out of view;
  or anything of no bp. A skip is measured by how far apart on the reference its
  ends are
- Folded sites whose spans on the reference overlap or touch make one run, and
  the reference through a run, its nodes and its own links from one outer
  attachment to the other, is drawn as one even stroke at the thinner of the two
  drawn reference nodes at the run's ends, each part in its own position colour;
  `collapsed.through` and `collapsed.bridges` hold what it covers. A drawn node
  outside every run keeps its own thickness, so the key's node thickness holds
  of every node drawn on its own
- With walks lifted, every lifted walk crossing a run of folded sites, by
  whatever route, runs one lane along the run as it is drawn, from where it
  leaves the drawn node before the run to where it enters the one after, with no
  head there, and the reference nodes inside the run are drawn only by those
  lanes
- The fold depends only on the layout and the scale: zooming in past the
  threshold draws each site again, a pan reuses what the zoom derived, and under
  a steady zoom each node changes state once at most
- The key ends with one line, only where something is folded in the view it
  keys: `N nodes and M skips under B bp not drawn`, counting each folded node
  and skip link of a site whose place lies in the view once, B being the largest
  such site's bp and one more, so every one of them is under it
- Folded nodes push no label aside
- The batch's `collapsed` holds the fold: `findHoveredNode` and
  `findHoveredEdge` take it as a required argument, so a point at a folded site
  finds the reference, and `layoutLabels` takes its nodes as `folded`, which
  carry no label. `figureData` lists each folded site in its `sites` table
  (where it attaches to the reference, the nodes and links folded, and how many
  of the shown haplotypes step it) and states the mode and threshold in
  `meta.smallSites`; with `'nodes'` it adds neither
- An exon is outlined only on a node the drawing strokes: `exonStretches` takes
  `nodesNotDrawn(batch)`, the fold's nodes and, with walks lifted, the reference
  nodes inside a folded site that only the lanes crossing it draw, and leaves
  their stretches out, as `figureSvg` does and `figureData`'s `exons` table does
  for any of its panels. The gene stays pinned and listed over the node
- The key keys the pane: every row, the not-drawn line among them, says what the
  pane shows, and nothing drawn in the pane, under the key included, escapes it.
  A host whose pane shows part of its drawing, after a pan or zoom or as a
  linear view's track cut past its window, hands `drawnMarks` `keyedView`, the
  whole pane under the reference strip in layout units, the key's own column
  included; a host that clips its drawing, as a track following its window clips
  it at the key's column, hands it the width it paints. A mark counts only where
  one of its strokes meets that view, and a folded site only where its place
  lies in it; the node thicknesses keyed are the thickest and thinnest nodes
  stroked there, keyed whenever the drawing's node strokes vary in thickness
  anywhere, as the batch states for nodes a viewport culled too; an exon is
  keyed only where its outline meets the view on a node the drawing strokes.
  `figureSvg` and `figureData` show the whole drawing, so their key keys all of
  it. A host that grows its pane to show every row of its key sizes the pane by
  the key as a layout or a setting leaves it, never by the key of each view, so
  a pan or zoom never moves the pane; a view's key taller than that scrolls in
  its column
- In either state a lifted lane's stroke is never thinner than
  `MIN_LANE_STROKE_PX`, however far a walk's many passes thin its threads

## Threading by pass

A haplotype that goes round a repeat steps the same nodes again on each trip.
Lifted with `color: { field: 'pass' }`, its lane splits into one thread per
visit at each node it steps again, and each thread takes the colour of the pass
it is on, so the trips round the repeat can be followed one by one.

- `passesOf(walk, lengthOf)` reads the passes off the walk alone. The first pass
  starts at the first node the walk steps again later, and a new pass starts
  wherever the walk comes back to a node it already stepped during the current
  pass. Only steps on nodes the walk steps more than once take a pass's colour;
  the rest of the haplotype keeps its own lane colour
- Each pass carries `repeatBp`, its bp on nodes the walk steps more than once;
  `againBp`, the part of that on nodes the walk read earlier; `reversedBp`, the
  part of `againBp` read on the other strand from the walk's own first read of
  each node; and `reversed`, true where `reversedBp` is more than half of
  `againBp`. These are data only. The frame is each node's first read by this
  walk, not the reference's strand or the way the node is drawn, so two passes
  both `reversed` can run opposite ways on the page. The drawing says which way
  a thread runs by the heads along it, not by a word
- Up to six passes get a thread, a colour and a name each, `pass 1` and on, or
  the layer's `passNames`. The graph shows the name alone; the key and the bar
  give it with the bp the pass steps again, as `pass 3 · 61 bp`, so a pass that
  is one small shared node is not taken for a copy. Past six they share one
  colour and one count; where the band is too thin to keep the threads apart
  they fuse into one band
- A pass's colour is the first of Okabe and Ito's, then Tol's, that stands at
  least `PASS_FROM_WALK` in OKLab from every lifted walk's lane colours, a
  ramp's at each stop, and at least `PASS_FROM_PASS` from every pass colour
  taken before it, its own walk's or an earlier walk's. Where no colour left
  keeps both, as with several walks coloured by pass lifted together, it takes
  the one that breaks them least
- Each pass is named on the graph through `layoutLabels`, keyed in `graphKey`,
  and shown along a bar of the haplotype's own length (`passBars`,
  `passBarTree`) that colours only the stretches the walk steps again, under a
  solid line over each of a pass's stretches, a dotted hairline joining them and
  the pass's name over its longest
- Heads along a lane point the way its walk runs: wherever a lane reads a node
  against the way the node is drawn, whatever the lane's colouring, and along
  every thread of a lane coloured by pass. They are placed once over the whole
  walk, so a pan shows the same heads. A head inside its lane is black or white,
  whichever contrasts more with the lane; a head wider than its lane, as on a
  thread, stands on a white halo in its lane's colour darkened just enough to
  keep WCAG's 3:1 contrast with white. The canvas renderer draws them, so every
  host shows them
- A graph that keeps each copy of a repeat as its own nodes gives a walk nothing
  to step twice, so it shows no passes. Minigraph-Cactus folds little, but not
  nothing: on the hosted amylase cut HG00128#1 steps thousands of nodes twice. A
  layer's `passes` states them in the walk's own bp instead, as another graph of
  the same haplotype that folds the copies gives them; stated passes never move
  passes the walk shows
- Pass count is not gene copy number. A pass is a trip round whatever nodes the
  graph shares between copies: a copy the graph keeps apart adds no pass, a
  repeat it folds outside the gene adds passes, and the walk alone does not say
  where a unit starts, so a copy missing its first nodes shifts the boundaries
  after it
- In `figureData`, a lifted walk's node and link rows carry `pass`, the thread's
  slot across its band; `visit`, which of the walk's visits to the node the
  thread draws; and `walkPass`, the walk's pass that visit is on. The `passes`
  table holds each pass with its bp above, `passRuns` the bar's stretches, and
  `labels` rows of kind `pass` the names on the graph. A faceted figure keeps
  each panel's threads but names no pass, draws no bar and gives no `passes`,
  `passRuns` or pass `labels` rows

## Figures

- `figureSvg` draws a graph and its lifted walks to a standalone SVG. The
  `bandage-figure` CLI makes one from a JSON spec with no browser:
  `npx -p @jbrowse/bandage-core bandage-figure spec.json -o figure.svg`. See
  [docs/figures.md](docs/figures.md)
- A host exporting what its pane shows hands `figureSvg` the pane's size and its
  transform as `frame`: the figure then draws at that transform on a pane of
  exactly that size, the drawing cut at its edges as the host's pane cuts it,
  and its key lists only what that pane shows, where it would otherwise fit the
  whole drawing. Facet panels fit their own
- `figureData` returns what `figureSvg` would draw as columnar tables, for
  another graphics system to draw;
  [ggbandage](https://github.com/GMOD/ggbandage) draws them in ggplot2

## Coarse tier: `bandage-fold`

`bandage-fold` writes an rGFA with every variant under `--below` bp folded into
the reference. Indexed by gfa-to-tabix, the output is the coarse tier a graph
track draws once zoomed out past the fine index, so a whole chromosome fits.
[`gfa-to-tabix fold`](https://github.com/GMOD/gfa-to-tabix/blob/main/docs/subcommands.md#fold)
documents the fold and the handover from the fine index.

```console
npx -p @jbrowse/bandage-core bandage-fold graph.rgfa.gz --below 10000 \
  | gfa-to-tabix - -o graph.fold10000
```

- The input is a GFA or rGFA, plain or gzipped, or `-` for stdin. `-o out.gfa`
  writes a file in place of stdout
- `--reference PATH` names a plain GFA's backbone path. In an rGFA, the segments
  tagged `SR:i:0` form the backbone
- The fold keeps the backbone, every allele whose own length or the reference it
  replaces reaches `--below`, and the shortest way from each one's ends back to
  the backbone. It joins the reference between kept alleles into one segment
- `bandage-fold` drops paths and walks from the output. It writes forward a
  segment that a plain GFA's path reads reversed, and flips its links to match,
  so the output re-reads as the graph that was folded
- gfa-to-tabix's `--layout anchored|contig` should match the fine index's. An
  anchored window inside a large bubble then returns the whole bubble in both
  tiers, and a contig one only what links reach from it
- The graph track folds each cut it draws at ten pixels (`FOLD_PX` in
  jbrowse-plugin-graphgenomeviewer), and folding a fold again at a larger size
  closely matches folding the original at that size. A tier folded at N and
  handed over at N / 10 bp per pixel, such as
  `coarse: { uri: "graph.fold10000", aboveBpPerPx: 1000 }`, therefore draws
  nearly what the fine cut drew
- Node caps a string at 512 MB, and `bandage-fold` reads the whole graph into
  one, so it cannot fold a whole human pangenome. `gfa-to-tabix fold`, a port of
  the same fold, writes the index in one pass:
  `gfa-to-tabix fold graph.rgfa.gz --below 10000 -o graph.fold10000`

## Developing

```
pnpm install
pnpm test          # unit tests
pnpm build         # dist/ with declarations
```

- The FMMM engine and its wasm build are in
  [graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout)
- CI also packs the core and runs the typecheck and tests of
  [BandageJS](https://github.com/cmdcolin/BandageJS) and
  [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
  against it. For an API change, push the consumer's matching change to a
  `core-next` branch in that consumer's repo, which CI tests in place of `main`
  until the release
- `src/foldParity.test.ts` folds a few hundred random rGFA graphs with
  `foldVariants` and with the gfa-to-tabix release that
  `.github/actions/gfa-to-tabix` pins, and fails when they fold differently.
  Locally the test runs the `gfa-to-tabix` on PATH or named by `GFA_TO_TABIX`,
  and skips without one. In the other direction, gfa-to-tabix's
  `scripts/parity-fold.sh` checks that `gfa-to-tabix fold` writes the same bytes
  as `bandage-fold | gfa-to-tabix -`, and its CI tests the port against a pinned
  bandage-core
- Release with `pnpm version patch`: it lints, tests, stamps `src/version.ts`,
  writes the changelog with git-cliff and pushes the `v*` tag. `publish.yml`
  then runs CI, consumers included, and publishes to npm with trusted publishing
  only if it passes. When a consumer fails, push its side to `core-next` and
  rerun the failed jobs

## See also

- [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer) -
  JBrowse 2 plugin that browses these graphs by locus
- [BandageJS](https://github.com/cmdcolin/BandageJS) - browser viewer for GFA
  files, walk files and gbz-base databases
- [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix) - indexes a GFA by
  reference position, writing the `.walks.gz` walk files
- [@jbrowse/graph-walks](https://github.com/GMOD/graph-walks) - range-request
  reader for walk files
- [@jbrowse/graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout) -
  Bandage's FMMM layout as wasm
- [@jbrowse/graph-stress-layout](https://github.com/GMOD/graph-stress-layout) -
  stress layout that keeps the reference straight
- [@gmod/gbz-base](https://github.com/GMOD/gbz-base-js) - range-request reader
  for `.gbz.db` databases
- [ggbandage](https://github.com/GMOD/ggbandage) - Bandage-style graph figures
  as ggplot2 layers
- [@jbrowse/tubemap-core](https://github.com/GMOD/tubemap-core) -
  sequenceTubeMap's layout, without the DOM

Tutorials on [jbrowse.org](https://jbrowse.org/jb2/docs/tutorials/):

- [HPRC part 1: graph alleles and haplotypes](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc/)
- [HPRC part 3: repeat lengths](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc_repeats/)

## License

Both Bandage and OGDF are GPL, which is why this package is GPL-3.0-or-later.
