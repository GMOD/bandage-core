# A coarse tier for whole-chromosome views

`bandage-fold` writes a graph with every variant under `--below` bp folded into
the reference. Indexed by [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix),
it is the coarse tier a graph track draws once zoomed out past the fine index.

```console
gfa-to-tabix fold graph.rgfa.gz --below 10000 -o graph.fold10000
```

[`gfa-to-tabix fold`](https://github.com/GMOD/gfa-to-tabix#fold) is a port of
`foldVariants`, byte-identical to `bandage-fold | gfa-to-tabix -` on the
fixtures `scripts/parity-fold.sh` runs, in one pass with no node. `bandage-fold`
reads the whole graph into one string, which Node caps at 512 MB, so it cannot
fold a whole human pangenome.

gfa-to-tabix's CI holds its port to a pinned bandage-core, and
`src/foldParity.test.ts` holds `foldVariants` to the gfa-to-tabix release pinned
in `.github/workflows/push.yml`, failing when a few hundred random rGFA graphs
fold differently. Locally it runs against the `gfa-to-tabix` on PATH or named by
`GFA_TO_TABIX`, and skips without one.

```console
npx -p @jbrowse/bandage-core bandage-fold graph.rgfa.gz --below 10000 \
  | gfa-to-tabix - -o graph.fold10000
```

Both take the same options:

- `--reference SAMPLE` names a plain GFA's backbone path; an rGFA states its own
- `-` reads stdin; `bandage-fold` also takes `-o out.gfa`, where
  `gfa-to-tabix fold` takes `-o prefix` and writes the index
- gfa-to-tabix's `--layout anchored|contig` should match the fine index, so a
  tier window returns what a fine window does: an anchored window inside a large
  bubble returns the whole bubble, a contig one only what links reach from it

The fold keeps the backbone, every allele whose own length or the reference it
replaces reaches `--below`, and the shortest way from each one's ends back to
the backbone. The reference between kept alleles becomes one segment.

The graph track folds each cut it draws the same way, at ten of the linear
view's pixels (`FOLD_PX` in jbrowse-plugin-graphgenomeviewer), and folding a
fold again at a larger size folds the original at that size. So a tier folded at
N and handed over at N / 10 bp per pixel draws what the fine cut drew just below
the handover, and zooming across it changes nothing on screen. In the track's
config, `coarse: { uri: "graph.fold10000", aboveBpPerPx: 1000 }` is that
handover.
