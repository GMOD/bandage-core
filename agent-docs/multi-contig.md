# Multi-contig backbones: parked

Status on 2026-11-20: the `multi-contig` branch is parked. Don't land it until
someone loads a file that needs it.

## The problem

- An rGFA can tag rank 0 segments on more than one contig (`SN`). Each contig
  counts its offset (`SO`) from 0.
- The layouts that use reference bp as x (`auto`, `samplerows`, `walkrows`,
  `tubemapref`) place a backbone node at x = offset, whatever its contig. So
  chr1 and chr2 are drawn over the same x.
- The reference strip, the position ramp and `orientToReference` read the same
  single bp axis, so they have the same bug.

## The branch

- Branch `multi-contig`, worktree `.claude/worktrees/multi-contig`, tip
  `bb75e97`, based on `b9c0345` (14.1.0). 10 commits, about 1,600 lines across
  48 files, mostly tests.
- It lays the contigs end to end on x, ordered by name, with a gap of 2% of the
  bp they cover. `referenceContigs` on `LayoutResult` gives each contig's
  offset, and `axisLocus` maps an x back to a contig and bp. A window takes an
  optional `refName` that picks its contig.
- `docs/adr/0004-contigs-lie-end-to-end-on-the-reference-axis.md` on the branch
  records the options and the decision. It is marked proposed and was never
  accepted.
- On 2026-11-20 it rebased onto `b7ffbc7` with no conflicts. Typecheck, lint,
  format and the full suite passed (1874 tests, 10 skipped). A graph with one
  contig lays out exactly as before.
- Consumer repos still compile against it, because the changed signatures only
  widen.

## Why it's parked

- Of 1,807 GFA files under `~`, 375 are rGFA, and only two have rank 0 segments
  on more than one contig:
  - `~/work/hprc-sv/hprc-v2.1-mc-grch38.sv.gfa.gz`: 195 contigs, 759k segments.
  - `~/Downloads/Jbrowse2_V5_Customs/HzPanV6.gfa.gz`: 116 contigs, 55M segments.
- Both are whole-genome Minigraph-Cactus graphs, too big for any host to lay out
  whole. Hosts show them one region at a time.
- A region cut picks up a second contig only if some path in the graph joins two
  contigs. In the HPRC graph no connected component holds rank 0 segments of
  more than one contig, because Minigraph-Cactus builds each chromosome as its
  own graph. HzPanV6 was not checked; it was too big to check quickly.
- The branch's two-contig fixtures (`test_data/rgfa_two_contigs*.gfa`) are
  synthetic.
- Not seen yet, but possible:
  - a small genome loaded whole, such as a bacterium and its plasmids
  - a plain minigraph graph, which is not split by chromosome and may join
    chromosomes

## Next step instead

- Add the guard the ADR lists as "Refuse". When the backbone is on more than one
  contig:
  - the reference-bp modes are not `available`
  - `auto` falls through to the force layout
- The hook is `hasBackbone` and its neighbours in `src/layoutModes.ts`. The
  backbone's contigs come from `src/reference.ts` (`BackboneContig`).

## If the branch comes back

- Rebase it, then decide on ADR 4 and mark it accepted or rejected.
- Contig order is code-unit order, so `chr10` sorts before `chr2`. Switch to
  natural order before hosts read `referenceContigs`, because changing it later
  moves every contig after the first. It lives in three places: `backboneAxis`,
  `referenceOrder` and `referenceSeeds`.
- Hosts (the jbrowse plugin, BandageJS) must read x through `referenceContigs`
  and `axisLocus`. Until they do, any bp they read on a second contig is too
  high by that contig's offset.
- Nothing labels the contigs. A host can draw a label at each contig's
  `start + offset`.
- A tagged graph with walks lays out its walk rows along one contig, and there
  is no picker to choose which.
- First find a real file that needs it, and add it as a fixture.

## Rerunning the data check

Count rank 0 contigs per file:

```sh
zcat FILE.gfa.gz | awk -F'\t' '$1=="S"{r="";s="";for(i=4;i<=NF;i++){if($i=="SR:i:0")r=1;if($i~/^SN:Z:/)s=substr($i,6)} if(r&&s!="")a[s]=1} END{n=0;for(k in a)n++;print n}'
```

Count connected components that hold rank 0 segments of more than one contig. A
result of 0 means no region cut can pick up a second contig:

```sh
zcat FILE.gfa.gz | awk -F'\t' 'function f(x){while(p[x]!=x){p[x]=p[p[x]];x=p[x]} return x} $1=="S"{p[$2]=$2;r=0;for(i=4;i<=NF;i++){if($i~/^SN:Z:/)s=substr($i,6);if($i=="SR:i:0")r=1} if(r)sn[$2]=s;next} $1=="L"{a=f($2);b=f($4);if(a!=b)p[a]=b} END{for(n in sn){c=f(n);k=c SUBSEP sn[n];if(!(k in seen)){seen[k]=1;m[c]++}} for(c in m)if(m[c]>1)multi++;print multi+0}'
```
