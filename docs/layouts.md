# Layouts

The plugin ships seven layouts:

- **Force-directed**: the graph's shape, from the OGDF FMMM engine in
  [Bandage](https://github.com/rrwick/Bandage), seeded along the reference to
  read left to right. The engine lays out unbranching runs, so a base-level cut
  of 15,000 nodes draws in a few seconds.
- **Ordered**: x is reference order, so every node gets room and a bubble reads
  as a lens. It scrolls sideways.
- **Anchored**: x is reference bp, one row per stable rank, aligned under a
  linear view.
- **Sample rows**: x is reference bp, one row per contributing assembly.
- **Walk rows**: x is each walk's own bp, one bar per haplotype, so a repeat
  expansion reads as bar length. Sequence shared with the reference takes the
  reference-position hue of the stretch the graph threads it through, and
  haplotype-only sequence is charcoal; under other colour schemes they are blue
  and purple. The Repeat picker tiles the bars by a repeat annotation's unit and
  marks the allele a genotyper called.
- **Tube map**: [sequenceTubeMap](https://github.com/vgteam/sequenceTubeMap)'s
  drawing, every path a coloured tube through boxed nodes, with columns in node
  order and node widths log-scaled.
- **Tube map on reference**: the same tubes with each column at the reference bp
  its node covers, so they line up with the tracks around them.

Ordered and Anchored need an rGFA or a reference path; Walk rows and Tube map
need W or P lines, and Tube map on reference needs both.

In a track of a linear view, a force-directed or ordered drawing has no bp axis
of its own. A strip along the top of the track draws each reference segment at
its bp, in the colour its node has in the graph, so under the reference-position
ramp a hue on the strip finds its node below. Hovering either one boxes the
node's reference span on the strip and draws a leader to the node; an allele's
span runs between its flanks. Hovering a bubble's name does the same for the
bubble's span. While the Walk picker lifts a haplotype, the reference segments
it skips fade on the strip as they do in the graph. A triangle at either end of
the strip says the graph draws reference past that edge of the window. The track
menu's **Reference strip at bp** turns the strip off.

![KIV-2's 68 kb allele hovered: the strip boxes the span between its flanks, and the linear view bands it](../img/force_kiv2_hover.png)

## Tube maps

- Laid out by `@gmod/tubemap-core`, sequenceTubeMap's layout, from the P and W
  lines, reference first
- A reverse-strand walk runs through its boxes right to left
- On the reference axis each column boundary takes up to 24 px for its curves;
  inserted sequence covers no reference
- In a linear view's track the tubes squeeze to the track's height; drag it
  taller for wider tubes
- In a view of its own, the session's genes draw in rows above the tubes, mapped
  through the reference's boxes, so on the own axis an exon is as wide as the
  boxes that carry it. The fit leaves as many rows as genes overlap at one
  point, up to four. A linear view has them in their own track, at their bp, and
  draws none over the tubes
- On the own axis in a linear view, a band runs from each reference node's bp on
  the ruler down to its box, as the LD display ties its matrix columns to their
  variants. The wedges between bands are the curves and inserted sequence, which
  cover no reference. Hovering a band picks out its node, and a cut too long for
  the track fans out from the stretch of ruler on screen
- On the own axis a box is as wide as the log of its length (2 bp is 8 px, 100
  bp 56, 1 kb 84, 22 kb 121), so no box is to scale, and the legend says so. The
  ruler under the tubes treats every box alike: a bracket with a tick at each
  end, the box's length where it fits inside, and positions at box boundaries,
  the ends of what is on screen first. On the reference axis the boxes are to
  scale, so its ruler is one line with round positions, and in a linear view the
  view's own ruler is the axis
- A box's outline fades below 12 px wide, so a zoomed-out cut shows its tubes
- On the own axis the fit stops at 5 px tubes: a longer cut opens at its left
  end and you pan along it, as in sequenceTubeMap, or zoom out for the whole cut
- **Fold variants** folds every variant under a size into the reference, after
  svSTM
  ([van den Brandt et al., EuroVis 2025](https://doi.org/10.2312/evs.20251091)):
  the reference between two larger ones is one box, and each walk marks what it
  carries there as a tick on its tube at the variant's bp, which the legend
  names with the fold's size. A human window is mostly SNPs, so MICB's 22 kb cut
  goes from 475 columns to 34 under 3 bp and to one box under 50, where it reads
  as a SNP strip per haplotype. A repeat array keeps one box per distinct copy
  route. Off by default, and off while reads are shown, since they are placed by
  the segments a fold merges

### Reads

GAF reads draw under the haplotypes of a gbz-base track in both tube map
layouts. The adapter names the file, and a `.gz` one takes the `.tbi` beside it:

```json
{
  "type": "GbzBaseSyntenyAdapter",
  "uri": "graph.gbz.db",
  "reads": "reads.gaf.gz",
  "assemblyNames": ["hg38"]
}
```

`vg giraffe` aligns reads to the same GBZ, building its distance and minimizer
indexes on the first run; sorting, bgzipping and indexing the GAF lets each cut
fetch only the reads over its nodes:

```console
vg giraffe -Z graph.gbz -f reads.fq -o gaf > reads.gaf
vg gamsort -G reads.gaf | bgzip > reads.gaf.gz
tabix -p gaf reads.gaf.gz
```

- GAF from minigraph or GraphAligner works too. Step names have to be the cut's
  segment names: numeric ids, or `vg giraffe --named-coordinates` on a graph
  with renamed or chopped segments
- A tabix GAF index keys each read by its lowest and highest node id, so it
  needs numeric ids. Without an index (`"reads": "reads.gaf"`, or a gzipped file
  in `readsLocation`), the plugin reads the file whole, up to 50 MB
- Only gbz-base tracks take reads; an rGFA track, or a GFA file opened with
  **Add → Graph genome view**, has no reads input
- Up to 5000 reads a cut, sampled evenly past that; blues forward, reds reverse.
  Beside reads the haplotype tubes turn grey, as sequenceTubeMap draws them, so
  no tube shares a read's colour
- The cs tag's edits are drawn on the reads: substituted bases, `*` for an
  insertion, grey for a deletion, hidden when zoomed out. The legend names the
  strands and each kind of edit in view

![The pggb E. coli subgraph as a tube map on both axes](../img/tube_map.png)

Eight HPRC haplotypes over MICB's exons 2–4, as a track under the RefSeq genes
and as a view:

![MICB's exons 2–4 as a tube map track, each reference node tied to its bp on the ruler](../img/tube_map_micb_track.png)

![MICB's exons 2–4 as a tube map on its own axis](../img/tube_map_micb.png)

sequenceTubeMap's cactus test graph with NA12879's reads under its three paths,
zoomed in far enough to letter each read's mismatches. The paths are vg generic
paths, which the legend names by contig; a haplotype index beside the database
(`gbz-haplotype-index --from-db cactus.gbz.db cactus.haplotype-index.db`) is
what names the two that are not the reference:

![GAF reads under the haplotypes of a tube map track, with their mismatches](../img/tube_map_reads.png)

## Bubbles

The plugin reads `gfatools bubble` output from `<prefix>.bubbles.bed.gz` beside
the rGFA index, which HPRC's hosted graph has and `scripts/build_rgfa_tabix.sh`
in jbrowse-components writes. For a GBZ cut, a pggb file or a popped bubble, the
plugin derives bubbles from the ordered layout's layering. With **Mark bubbles**
on, the node layouts draw each as a halo along its nodes, coloured by kind,
which the legend names. It is off by default, since at base level every SNP's
halo is a blob.

![KIV-2, force-directed, with its bubbles marked](../img/force_kiv2_bubbles.png)

A bubble's label opens its nodes on their own, with a button back to the window.
The popped graph derives its own bubbles, so a superbubble opens level by level.
The KIV-2 array opens to 27 segments:

![The KIV-2 array popped open](../img/force_kiv2_popped.png)

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

In a track, the reference strip shows what a lifted walk skips at its bp. GSTM1
is deleted on six of the eight haplotypes; with HG00133 lifted, the 18 kb it
lacks fades on the strip under the RefSeq gene, and its route takes the shortcut
past the faded loop:

![HG00133's walk lifted at GSTM1, its 18 kb deletion faded on the reference strip](../img/force_gstm1_walk.png)

Walk rows draw the same cut as one bar per haplotype. With the Repeat picker on
the curated VNTR track, each bar runs between the KIV-2 array's flanking
reference nodes and is tiled by its 5,548 bp kringle unit, so the copy number
reads off the bar: about 6 in GRCh38, 27 in HG00133. Purple is copies GRCh38
does not carry:

![KIV-2 walk rows, each bar tiled by the kringle unit](../img/walk_rows_kiv2.png)

Under the reference-position ramp, a copy's hue is the reference copy the graph
threads it through. In a tandem array that is the aligner's pick among
near-identical copies: at KIV-2, 13 of the 32 threaded copies take the hue of a
reference copy of the other repeat type. To colour each copy by the unit it
actually is, load
[jbrowse-plugin-tandem-repeat](https://github.com/GMOD/jbrowse-plugin-tandem-repeat)
and right-click a VCF 4.5 `<CNV:TR>` record stating each allele's copies.

## Genes on the graph

The session's gene track draws exons as dark stretches along the backbone and
pins each gene's name under its midpoint. A tube map in a view of its own draws
genes in rows above the tubes instead, and one in a linear view leaves them to
the gene track (see Tube maps). In MHC class II, one 254-segment superbubble
covering the DRB block reads as HLA-DRB5's, and the indels after it as
HLA-DRB6's and HLA-DRB1's:

![MHC class II, force-directed, with genes on the backbone](../img/force_mhc.png)

The view draws genes only on a backbone of the assembly it read them for. A
backbone names a sample by PanSN (`GRCh38#0#chr6`), never an assembly. A walk
names the cut's assembly where its sample or haplotype is that assembly's name,
a session alias, the prefix the graph track's `assemblyNameToPanSN` maps it to,
or a reference assembly's well-known sample (hg38 is GRCh38, hs1 is CHM13). A
path graph opens with x along that walk, else along the first one, which is the
walk a gbz-base cut follows: the adapter's `referenceSample`, the database's
only reference sample, or vg's generic `_gbwt_ref`. The graph track's config
puts that walk, like an rGFA's fixed backbone, on the cut's assembly, so it
takes the genes whatever its name. Once "Draw x along" picks another walk, the
genes stay only where that walk names their assembly. A sample-level name
(`HG002`) names no haplotype of a diploid, and a bare (`chr6`) or generic name
names none.
