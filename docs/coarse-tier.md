# bandage-fold: a coarse tier for whole-chromosome views

`bandage-fold` reads a GFA or rGFA (`.gfa` or `.gfa.gz`, or `-` for stdin) and
writes an rGFA with every variant under `--below` bp folded into the reference.
Indexed by [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix), the output is
the coarse tier a graph track draws once zoomed out past the fine index.

```console
npx -p @jbrowse/bandage-core bandage-fold graph.rgfa.gz --below 10000 \
  | gfa-to-tabix - -o graph.fold10000
```

- `--reference SAMPLE` names a plain GFA's backbone path; an rGFA states its own
- `-o out.gfa` writes a file in place of stdout
- Node caps a string at 512 MB, and `bandage-fold` reads the whole graph into
  one, so it cannot fold a whole human pangenome. For that, run
  [`gfa-to-tabix fold`](https://github.com/GMOD/gfa-to-tabix/blob/main/docs/subcommands.md#fold),
  a port of the same fold that writes the index in one pass:
  `gfa-to-tabix fold graph.rgfa.gz --below 10000 -o graph.fold10000`
- gfa-to-tabix's `--layout anchored|contig` should match the fine index, so a
  tier window returns what a fine window does: an anchored window inside a large
  bubble returns the whole bubble, a contig one only what links reach from it

## What the fold keeps

- The fold keeps the backbone, every allele whose own length or the reference it
  replaces reaches `--below`, and the shortest way from each one's ends back to
  the backbone
- The fold joins the reference between kept alleles into one segment
- `bandage-fold` writes forward a segment that a plain GFA's path reads
  reversed, and flips its links to match, so the output re-reads as the graph
  that was folded
- The output has no paths or walks

## Handing over from the fine index

The graph track folds each cut it draws the same way, at ten of the linear
view's pixels (`FOLD_PX` in jbrowse-plugin-graphgenomeviewer), and folding a
fold again at a larger size closely matches folding the original at that size. A
tier folded at N and handed over at N / 10 bp per pixel therefore draws nearly
what the fine cut drew just below the handover. In the track's config,
`coarse: { uri: "graph.fold10000", aboveBpPerPx: 1000 }` sets that handover.

The tier and the fine cut can differ where the way back from a big allele to the
reference runs through a small allele: one fold can keep part of it that the
other drops.

## Parity with gfa-to-tabix

- gfa-to-tabix's `scripts/parity-fold.sh` checks that `gfa-to-tabix fold` writes
  the same bytes as `bandage-fold | gfa-to-tabix -`, and its CI tests the port
  against a pinned bandage-core
- `src/foldParity.test.ts` here folds a few hundred random rGFA graphs with
  `foldVariants` and with the gfa-to-tabix release that
  `.github/actions/gfa-to-tabix` pins, and fails when they fold differently.
  Locally the test runs the `gfa-to-tabix` on PATH or named by `GFA_TO_TABIX`,
  and skips without one
