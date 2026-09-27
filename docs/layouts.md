# Layouts

The plugin ships eight layouts:

- **Force-directed**: the graph's shape, from the OGDF FMMM engine in
  [Bandage](https://github.com/rrwick/Bandage), seeded along the reference to
  read left to right. The engine lays out unbranching runs, so a base-level cut
  of 15,000 nodes draws in a few seconds.
- **Variant map**: the reference as a line with one typed glyph per bubble.
  Clicking a glyph opens that bubble's graph.
- **Ordered**: x is reference order, so every node gets room and a bubble reads
  as a lens. It scrolls sideways.
- **Anchored**: x is reference bp, one row per stable rank, aligned under a
  linear view.
- **Sample rows**: x is reference bp, one row per contributing assembly.
- **Walk rows**: x is each walk's own bp, one bar per haplotype. Blue marks
  sequence the reference shares and purple sequence it lacks, so a repeat
  expansion reads as bar length. The Repeat picker tiles the bars by a repeat
  annotation's unit and marks the allele a genotyper called.
- **Tube map**: [sequenceTubeMap](https://github.com/vgteam/sequenceTubeMap)'s
  drawing, every path a coloured tube through boxed nodes, with columns in node
  order and node widths log-scaled.
- **Tube map on reference**: the same tubes with each column at the reference bp
  its node covers, so they line up with the tracks around them.

Variant map, Ordered and Anchored need an rGFA or a reference path; Walk rows
and Tube map need W or P lines, and Tube map on reference needs both.

## Tube maps

- Laid out by `@gmod/tubemap-core`, sequenceTubeMap's layout, from the P and W
  lines, reference first
- A reverse-strand walk runs through its boxes right to left
- On the reference axis each column boundary takes up to 24 px for its curves;
  inserted sequence covers no reference
- In a linear view's track the tubes squeeze to the track's height; drag it
  taller for wider tubes

### Reads

- GAF from `vg giraffe`, minigraph or GraphAligner, set as a gbz-base track's
  `reads` (or `readsLocation` + `readsIndex`)
- Step names have to be the cut's segment names: numeric ids, or
  `vg giraffe --named-coordinates` on a graph with renamed or chopped segments
- Indexed: `bgzip` and `tabix -p gaf` a GAF sorted by node id (`vg gamsort -G`);
  each cut queries its node id range. Needs a `@gmod/tabix` that reads the GAF
  preset
- Unindexed: plain or gzipped, read whole, up to 50 MB
- Up to 5000 reads a cut, sampled evenly past that; blues forward, reds reverse
- The cs tag's edits are drawn on the reads: substituted bases, `*` for an
  insertion, grey for a deletion, hidden when zoomed out

![The pggb E. coli subgraph as a tube map on both axes, and a GBZ cut of the MICB locus as a track of a linear view](../img/tube_map.png)

## Bubbles

The plugin reads `gfatools bubble` output from `<prefix>.bubbles.bed.gz` beside
the rGFA index, which HPRC's hosted graph has and `scripts/build_rgfa_tabix.sh`
in jbrowse-components writes. For a GBZ cut, a pggb file or a popped bubble, the
plugin derives bubbles from the ordered layout's layering. Node layouts draw
bubbles as halos, and the variant map draws them as glyphs.

![KIV-2, force-directed, with its bubbles marked](../img/force_kiv2.png)

A bubble's label opens its nodes on their own, with a button back to the window.
The popped graph derives its own bubbles, so a superbubble opens level by level.
The KIV-2 array opens to 29 segments:

![The KIV-2 array popped open](../img/force_kiv2_popped.png)

![Variant map of KIV-2](../img/variant_map_kiv2.png)

## Haplotype walks

A gbz-base cut carries the haplotypes' walks. A node draws thicker the more
walks carry it, as Bandage draws depth. Each route through a bubble carries a
label with its haplotypes and length, so the KIV-2 array reads as one copy count
per haplotype:

![KIV-2 over gbz-base, eight haplotypes, force-directed](../img/force_kiv2_gbz.png)

The Walk picker lifts one haplotype out: its route keeps its ink, the rest
fades, and a readout gives its length against the reference. HG00133 carries 116
kb more than GRCh38 through the array:

![HG00133's walk lifted out of the KIV-2 cut](../img/force_kiv2_walk.png)

## Genes on the graph

The session's gene track draws exons as dark stretches along the backbone and
pins each gene's name under its midpoint. In MHC class II, one 254-segment
superbubble covering the DRB block reads as HLA-DRB5's, and the indels after it
as HLA-DRB6's and HLA-DRB1's:

![MHC class II, force-directed, with genes on the backbone](../img/force_mhc.png)

## Demonstration loci

The layout screenshots use six HPRC release 2 windows from the
[HPRC tutorials](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc/). Each
cuts to under 300 nodes and shows a different kind of variation:

| Locus        | Window                         | What it shows                       |
| ------------ | ------------------------------ | ----------------------------------- |
| LPA KIV-2    | `chr6:160,525,000-160,655,000` | the kringle repeat, copy per loop   |
| MHC class II | `chr6:32,510,000-32,600,000`   | DRB haplotypes, dozens of alleles   |
| AMY1         | `chr1:103,690,000-103,780,000` | amylase copy number                 |
| C4           | `chr6:31,980,000-32,050,000`   | one bubble over the C4 duplication  |
| CFH          | `chr1:196,640,000-196,900,000` | an 84 kb deletion as a bare edge    |
| KIR          | `chr19:54,750,000-54,840,000`  | the KIR cluster, densest of the six |
