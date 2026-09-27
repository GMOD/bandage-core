# Layouts

The LPA KIV-2 window of the HPRC release 2 graph in the **force-directed
layout**: the GRCh38 backbone runs left to right, coloured by position the way
the rGFA segments track above it is, and the kringle repeat array is the knot of
loops in the middle. Each bubble the graph holds is haloed along its own nodes
and labelled by what it is; the label opens the bubble on its own.

![KIV-2, force-directed, with its bubbles marked](../img/force_kiv2.png)

Clicking the array's label opens its 29 segments in the same layout, with a
button back to the window. A popped graph derives its own bubbles, so a
superbubble opens level by level:

![The KIV-2 array popped open](../img/force_kiv2_popped.png)

Over a gbz-base database the cut carries the haplotypes' walks. A node draws
thicker the more of them carry it, Bandage's depth as width, and every route
through a bubble is labelled at the far point of its loop for the haplotypes
that take it and how long it is, so the array reads as one copy count per
haplotype:

![KIV-2 over gbz-base, eight haplotypes, force-directed](../img/force_kiv2_gbz.png)

Picking one walk lifts it out of the drawing. HG00133's route through the window
keeps its ink and the other haplotypes fade; the readout says it carries 116 kb
more than GRCh38 through the array:

![HG00133's walk lifted out of the KIV-2 cut](../img/force_kiv2_walk.png)

MHC class II, where one 254-segment superbubble covers the DRB haplotype block
and a run of small indels follows it. The session's gene track is drawn onto the
graph: exons as dark stretches along the backbone nodes that carry them, and
each gene's name pinned under the backbone at its midpoint, so the superbubble
reads as HLA-DRB5's and the indels as HLA-DRB6's and HLA-DRB1's:

![MHC class II, force-directed, with genes on the backbone](../img/force_mhc.png)

The KIV-2 window as a **variant map**, the reference as one line with one typed
glyph per bubble:

![Variant map of KIV-2](../img/variant_map_kiv2.png)

It ships six layouts:

- **Force-directed**: the graph's shape, computed by the OGDF FMMM engine from
  [Bandage](https://github.com/rrwick/Bandage), seeded along the reference and
  turned to read left to right. The engine lays out unbranching runs rather than
  nodes, so a base-level cut of 15,000 nodes draws in a few seconds. The Walk
  picker lifts one haplotype out: its route keeps its ink, the rest fades, and a
  readout gives its length against the reference.
- **Variant map** (rGFA or a reference path): the reference as a line, one typed
  glyph per bubble, click to open a bubble's graph, and again for a bubble
  inside it.
- **Ordered** (rGFA or a reference path): x is reference order rather than bp,
  so every node gets room and a bubble reads as a lens. Scrolls sideways.
- **Anchored** (rGFA or a reference path): x is reference bp, one row per stable
  rank, aligned under a linear view.
- **Sample rows**: x is reference bp, one row per contributing assembly.
- **Walk rows** (W or P lines): x is each walk's own bp, one bar per haplotype,
  sequence the reference also carries in blue and sequence it does not in
  purple, so a repeat expansion reads as bar length. The Repeat picker tiles the
  bars by a repeat annotation's unit and marks the allele a genotyper called.

The bubbles come from `gfatools bubble` output beside the rGFA index
(`<prefix>.bubbles.bed.gz`), which HPRC's hosted graph has and
`scripts/build_rgfa_tabix.sh` in jbrowse-components writes, or, for a graph with
no index, a GBZ cut, a pggb file or a popped bubble, from the graph itself off
the ordered layout's layering. Every node layout marks them as halos; the
variant map draws them as glyphs.

## Demonstration loci

Six HPRC release 2 windows, the ones the
[HPRC tutorials](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc/) walk
through, are the standing test set for layout screenshots. Each cuts to under
300 nodes and shows a different kind of variation:

| Locus        | Window                         | What it shows                       |
| ------------ | ------------------------------ | ----------------------------------- |
| LPA KIV-2    | `chr6:160,525,000-160,655,000` | the kringle repeat, copy per loop   |
| MHC class II | `chr6:32,510,000-32,600,000`   | DRB haplotypes, dozens of alleles   |
| AMY1         | `chr1:103,690,000-103,780,000` | amylase copy number                 |
| C4           | `chr6:31,980,000-32,050,000`   | one bubble over the C4 duplication  |
| CFH          | `chr1:196,640,000-196,900,000` | an 84 kb deletion as a bare edge    |
| KIR          | `chr19:54,750,000-54,840,000`  | the KIR cluster, densest of the six |

[docs/layout-experiments.md](layout-experiments.md) draws all six in every
layout the plugin has and in the ones proposed to replace them, and
`scripts/layout-lab/` reproduces the figures.
