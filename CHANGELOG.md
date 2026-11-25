## [14.8.0](https://github.com/GMOD/bandage-core/compare/v14.7.0...v14.8.0) (2026-11-25)

### Other Changes

- A figure's liftFade sets the opacity of everything off the lifted walks, 0.3 where absent: the lift carries it to the batch, so the renderer's faded layer, the key's faded inks and the figure data's alphas follow it, and a host drawing thin nodes can keep a branch no lifted walk takes in sight ([e0b5139](https://github.com/GMOD/bandage-core/commit/e0b513966234e73a0c7750979d9d38b58151bb8d))

## [14.7.0](https://github.com/GMOD/bandage-core/compare/v14.6.0...v14.7.0) (2026-11-25)

### Other Changes

- The graph key counts the haplotypes asked for that the cut holds no step of, as those with no step on the reference here and those with no walk here, so a window where none of the chosen haplotypes is drawn no longer reads as all of them matching the reference ([46f97cc](https://github.com/GMOD/bandage-core/commit/46f97cca6c20929ba350150425bc3e9b78b35eb9))
- Thickness by walks is the passes the walks make, on one linear scale for nodes and links, so the widths at a fork add up and a skip one walk of nine takes draws at one walk where it drew 4.4 px; a skip under uniform links is as thick as a link, its dashes alone saying it skips; the key keys nodes and links by walks as one thickness of every walk, half and one, and says when walks with nodes not loaded leave the thickness undrawn ([d3adc52](https://github.com/GMOD/bandage-core/commit/d3adc52cca7e2bb54a6aa0ce857cba39b8a8ee0f))
- A node no walk steps, in a graph with walks, has no pass: its depth is 0 where it was floored at 1, so thickness by walks draws it as a hairline keyed "0 walks" and not as one walk, and by depth it draws at the scale's floor ([de105e4](https://github.com/GMOD/bandage-core/commit/de105e495e30bf8e6335bb0949d0db550d8d8e45))
- An allele far shorter than the reference it replaces is padded to half that reference by route nodes on its links, drawn dashed along them, so a 13 bp or 2 bp allele in place of kilobases no longer lets the force layout close the reference on it as a loop, the drawing of an insertion ([5d82415](https://github.com/GMOD/bandage-core/commit/5d82415081eee9221ce5fd860080497e371394e8))
- A skip too short on screen for full dashes is a low arch a level above its chord, dashed shorter, where it followed a route node never shorter than the layout's least node into a curl larger than the reference it skips, drawn as a plain stroke keyed "short skip"; every skip is one dashed mark under one key entry, and the reference's nodes carry no length label, whose "539 bp" beside such a curl at SV-del-100k+ read as the size of a 3 kb skip ([3857ee0](https://github.com/GMOD/bandage-core/commit/3857ee08b27dcb552647e853282a74334a13d530))
- A site folds where its bp at the reference's px a bp is under 3 px and comes back at the deepest zoom, whatever length the force layout drew it, so a 312 bp insertion the layout drew a few px long at a 100 kb window is drawn and a few-bp site it drew as a large curl folds; the key's "under N bp not drawn" is that threshold, so every site at or over N is drawn ([01dc30b](https://github.com/GMOD/bandage-core/commit/01dc30b29d31c82fcf70a23991c72be42fda7aaa))
- The renderer's paint-order tests tell two skips apart by their walks, now that every skip under uniform links is as thick as a link and a short one is dashed like the rest ([e5426ce](https://github.com/GMOD/bandage-core/commit/e5426cec87133bf18c44dfbdbc36a930343e468b))
- A reference node some shown walk reads against the reference carries heads pointing against the reference's direction, keyed "walked against GRCh38's direction", so an inversion no longer draws like a bypassed loop; which walks do is exact from each visit's strand against the reference's there, and a hover names them ([76ed94b](https://github.com/GMOD/bandage-core/commit/76ed94b38387730fec8873a81adc853ec1c16f43))
- The thickness, padded-allele, fold and inversion changes pass lint and the formatter: no type assertions in the padded feet, and the visit loop reads its slot once ([c3f7030](https://github.com/GMOD/bandage-core/commit/c3f70304efc52a632319608e1291d158c31aaff3))
- An allele is padded only where its walk skips forward on one pass of the reference, reads both reference nodes as the reference does or both against it, and the route the layout can draw is at least its shortest node; a tandem duplication, an inversion or a revisited node with a junction base is not, nor is anything in a graph without walks, so the rGFA segments track draws as before ([223c2b4](https://github.com/GMOD/bandage-core/commit/223c2b4d2cbbd74252c44445580acf26dcd0b13f))
- The curve-length and stroke-cover helpers the fold no longer reads are gone ([26c980b](https://github.com/GMOD/bandage-core/commit/26c980bb02d48dddab45441465cb89c0a537e3c3))
- Thickness by walks counts passes on nodes and links alike, a walk taking a link twice counted twice, so the widths at a fork add up on a repeat; the most passes in the graph draw contigThickness thick, so a window of GRCh38 alone draws no hairline; figures default to walks as the view does; depth draws uniform too while walks hold placeholders, with the note saying whose, and the link key reads link passes only; heads for walks against the reference draw at every zoom, on no node the reference reads both ways, and figure data exports them ([a95bdd1](https://github.com/GMOD/bandage-core/commit/a95bdd1083f9e09aa093d00ef3ca432694004b8c))
- A graph whose reference passes a node twice, a collapsed repeat such as impg's syng graph of C4, pads no allele, since a run's ends there lie on more than one pass; the lifted threads on that graph follow their links' ink again ([be0d745](https://github.com/GMOD/bandage-core/commit/be0d745323975af3f89b6ff71ad06fb03a0a8200))
- A padded allele's routes are sized on the engine's own scale, after the runs are merged, so whether a site is padded and how long its arm draws against the reference no longer hang on how many nodes its flanks are split into; at SV-del-100k+ and SV-rep-10k-100k the arm drew many times longer than the reference it replaces ([57a66fa](https://github.com/GMOD/bandage-core/commit/57a66fae44ee88c9ee28b9e9410ee45a4249ccb2))
- A graph without walks, as the rGFA segments track is, draws its skips and labels exactly as before, the plain short skip, the 2.2x dashed one and the reference's lengths, and only a graph with walks takes the low arches, link-width skips and unlabelled reference; a walk stepping a node twice keys "walk passes", depth always keys "depth N", by frequency draws uniform beside placeholders with no AF tag, heads against the reference draw in the one haloed ink their swatch shows, a skip whose ends lie under a pixel apart has a key entry, and the absent-haplotypes note says "samples" for sample prefixes ([8113f3e](https://github.com/GMOD/bandage-core/commit/8113f3ed03aad43988cccce940a0a123b2733dd8))
- A padded arm is sized by the loaded reference between its run's ends, as a deletion's route is by its bypassed nodes, so reference the cut did not load no longer lengthens it; each padded foot carries the span it skips and its allele's bp, and footRoutes returns the feet it keeps ([8a646bb](https://github.com/GMOD/bandage-core/commit/8a646bb1e2f3c3034e361d3fea710d5b0aba09bd))
- With walks, a skip or padded arm too short on screen for full dashes draws as a low arch over its feet, never higher than its chord is long and never past its feet along it, rising a third of its span or a level, whichever is more; nested skips rise by the skips inside them that the fold draws, not those it hides, so the 3,146 bp skip at SV-del-100k+ no longer stands four levels high as a teardrop wider than the reference it skips ([e8bcdae](https://github.com/GMOD/bandage-core/commit/e8bcdaede673e234835df00c6d14d7287ec2f0d1))
- With walks, a skip whose span on screen is under a level or three times its stroke, the sub-pixel one included, is left out rather than drawn as a dot or a black blob, and the key's one "not drawn" line counts it as "N skips too short on screen to draw"; the "skip, its ends under 1 px apart" entry and SUB_PIXEL_SKIP_KEY are gone ([e000f31](https://github.com/GMOD/bandage-core/commit/e000f31c963c390657ab8283d53c382b781829d8))
- A stretch read against the reference takes no head where its abutting nodes together fall under the fold's threshold, so a 1 bp node read backwards vanishes at overview as its site does, while a long inversion split into small nodes keeps its heads ([92852d1](https://github.com/GMOD/bandage-core/commit/92852d17de107cf169170b8dced0631bc0770162))
- One flag says thickness by walks fell back to uniform for nodes or links, and the "thickness not drawn" note sits under a "Thickness" heading, or under "Link thickness" when the nodes keep their own scale, never under "Node thickness" when links are undrawn too ([9decfd9](https://github.com/GMOD/bandage-core/commit/9decfd9455100aae42261bea06aa6997c5bd26b3))
- A padded foot a force layout routed is a skip everywhere it is drawn as one: skipAt finds it for a hover, which says "skips 1,839 bp of the reference, replaced by 2 bp" and where, and figure data marks it deletion: true, so ggbandage paints it over the nodes; a test at the fit measures in px that padded arms under 33 px across and a skip over folded skips stay within the reference between their feet ([f6ee806](https://github.com/GMOD/bandage-core/commit/f6ee806909451dac5cbf26c79ba09f2da91df878))
- A test holds the "thickness not drawn" note to its heading: under "Thickness" when nodes and links both fall back to uniform, under "Link thickness" when the nodes keep an AF scale ([e7fd7f7](https://github.com/GMOD/bandage-core/commit/e7fd7f7012c66d4fa5c76a3957e50ebc3a6c1137))
- The paint-order tests follow skips with walks: the short skip crossing a long one is long enough on screen to hold its arch, and the plain-link skip painted over a dashed one is a graph without walks', the one that still draws it; the new tests typecheck ([6b8acaf](https://github.com/GMOD/bandage-core/commit/6b8acaf06ad2df6451fb84102d53b5f40ff8aac9))
- The skips too short on screen to draw are part of the fold, worked out before the build as the folded sites are, so a key sized before the fit counts them as the drawing after it does; RenderBatch.skipsTooShort is gone, and heads on small stretches vanish whenever sites fold ([c3fd718](https://github.com/GMOD/bandage-core/commit/c3fd71885200c02f014e8445750d704d49ec6a07))
- The skips too short on screen are worked out again only when the lifted walks' links change, not when a highlight fades others, so such a build keeps its heads' spread; the key test's hand-built fold has the field ([f3fa5ac](https://github.com/GMOD/bandage-core/commit/f3fa5ac3b193960954a4e28edf5e2e6ea1a074b5))
- The too-short skip test asks first whether the skip is drawn, so on a build without the rule it fails by assertion ([bb8a9f9](https://github.com/GMOD/bandage-core/commit/bb8a9f9cbbb81bbd96b2b2a1bb34507bfd019551))
- The drawing and CLI docs say a skip too short on screen to arch is left out at any smallSites, kept in collapsed.tooShort and counted on the key's last line, and that with walks a short skip arches low within its chord ([6a60073](https://github.com/GMOD/bandage-core/commit/6a60073b07bd59e7b1dd14004386a5db29587cc8))
- With walks, a padded foot too short on screen to arch draws as the plain link it is, in link ink at its walks' width, so an allele most haplotypes carry is never drawn joined to nothing; only a deletion that short is left out, so the key counts skipped stretches, not feet, and the hit test passes left-out skips by as it does folded links. sitesFold, archless and leftOut each do one job, and the edge loop takes no new continue. The levelOfDetail tests that passed either way now assert one outcome each ([25968cd](https://github.com/GMOD/bandage-core/commit/25968cd132e541e14100bb00dcbdc2410482fc05))
- A padded foot's hover says what its run skips and where, and no longer what replaces it, which differs between walks sharing the link, as >r1>x>r3 and >r1>x>y>r3 do ([e5185ca](https://github.com/GMOD/bandage-core/commit/e5185ca7a1c155122bc02e280cb044482475e255))
- Heads against the reference are kept or dropped by the whole run a walk reads against it, across gaps the fold would not show, so the SNPs an inverted walk carries no longer split a long inversion into pieces too small for heads at an overview; the run is worked out once per graph and scale ([83b4332](https://github.com/GMOD/bandage-core/commit/83b4332b86731c50a0e71d0580a128eb2bafd021))
- A plain-drawn foot's curve takes the layout's stranded flag as false where unset, so the build typechecks ([7ef0ed0](https://github.com/GMOD/bandage-core/commit/7ef0ed0c2f1a7ba285c1f6bc5e51850f48b6d569))
- With walks, any skip too short on screen to arch draws as the plain link it is, in link ink at its walks' width, as a short padded foot does, so the path most walks take past a short deletion is never drawn broken; nothing is left out as too short, so the key's count of it, Fold.tooShort, leftOut and the hit-test exclusion are gone, and a graph without walks draws as before ([de0f553](https://github.com/GMOD/bandage-core/commit/de0f5536ed47f5839a9e03cd0b7a50ce03a0ee40))
- A padded foot's hover gives the bp skipped and where only when every walk through the link skips the same stretch; where they differ, as >r1>x>r3 and >r1>x>y>r4 do on r1→x, it says only that the link skips reference sequence, and never the shortest ([c142317](https://github.com/GMOD/bandage-core/commit/c1423170b013ec730cf9ff6f0ac629288fb2b7b5))
- A run read against the reference takes heads by the bp it reads so, not by the span it reaches over, so four 1 bp nodes read backwards 300 bp apart draw no inversion heads at overview, while a long inversion split by SNPs keeps its heads ([9ee2231](https://github.com/GMOD/bandage-core/commit/9ee223123ae70b7617e06c1a71e1dcf22541a7ce))
- TooSmallText with nothing to count says nothing, and two comments that repeat their code are gone ([5951b21](https://github.com/GMOD/bandage-core/commit/5951b2180664cf7a533db7d3bed6242505441b46))
- A folded graph's link counts the walks of the threads through it, as its nodes do, so by walks a thread's links draw on the one scale its nodes take and the widths at a node add up; on main a link counted threads while its nodes counted walks ([1b02bfa](https://github.com/GMOD/bandage-core/commit/1b02bfaa09c9698293b31c409dfb8f1d7fa9736a))
- The absent-haplotypes note counts a haplotype riding a folded thread as walked, and in a thread fold, which keeps no departures, says each haplotype no thread holds has no step on the reference here, so a folded window no longer reads "5 of 8 haplotypes have no walk here" where all eight walk it ([e0703c3](https://github.com/GMOD/bandage-core/commit/e0703c3e54c39d1d21ec32d6eaef32175cb0f748))
- A folded graph counts each pass of each walk on its nodes and links, from the fold's own steps, so a link only walks whose names loadGraph respells no longer counts 0, and on a node a walk takes twice the links in and out add up to its depth, as on an unfolded graph ([d7a5664](https://github.com/GMOD/bandage-core/commit/d7a5664261b79d3285862f8017980b2901b31b09))
- A folded graph keys its links as loadGraph does, either way round, so a walk that reads folded nodes reversed adds its passes to the link it shares with forward readers and every later link keeps its own count; df7f715 kept both spellings, loadGraph merged them, and the counts slid onto their neighbours ([500c7fd](https://github.com/GMOD/bandage-core/commit/500c7fd05586072ad681f5cf222d8b2ef4480b76))
- The "walked against" hover counts and names the haplotypes of every walk a thread holds, a haplotype in two walks once, so on a thread fold it no longer counts threads: at SV-inv-10k-100k it read "by 2 haplotypes" for the 13.2 kb node all eight read reversed, beside the fold's own "8 of 9" ([b3a0387](https://github.com/GMOD/bandage-core/commit/b3a03878e5b8c2c630d7233de51ece065f317a30))
- On a thread fold a node's frequency is its walks over the fold's haplotypes, not over its threads, so by frequency a node every haplotype walks draws full width and no wider, as it does unfolded ([d9036c3](https://github.com/GMOD/bandage-core/commit/d9036c38a2893476b4c095697d35abfb012a4ed7))
- A thread fold keeps the names its graph's departures carry, and the absent-haplotypes note splits the haplotypes no thread holds by them as the unfolded graph does, so a window reads the same at either zoom: R100k-02 folded read "8 of 8 have no step on GRCh38 chr1 here" where unfolded it reads "5 have no step on GRCh38 chr1 here and 3 have no walk here", and H-Y2466 and R10k-08 read "no step" folded where all eight have no walk ([21495fc](https://github.com/GMOD/bandage-core/commit/21495fc0ed57329ff789089586a93bbbb182c67e))
- A node read against the reference long enough for a head of its own keeps one where every spot on it falls within another reversed node's heads, as the 1,885 bp node six haplotypes read reversed at SV-inv-1k-10k did where its loop laid it alongside the 2,799 bp node, and drew as if walked forward ([d8058f1](https://github.com/GMOD/bandage-core/commit/d8058f123a8806668417a1e0ebb17a0b94fa7257))
- With walks, every skip is drawn dashed over the nodes or counted on the key's not-drawn line, never neither: a skip too short on screen to arch keeps its plain link and joins the count as Fold.shortSkips in either smallSites mode, and the line's bp bound is over every skip it counts, so H-SMN's 3,559 bp deletion under a 6 px node no longer goes unseen while the key reads "436 skips under 3,083 bp not drawn" ([1e0047c](https://github.com/GMOD/bandage-core/commit/1e0047c46677f28d58f6a16d4f0af96c59122aeb))
- A short skip the key counts as not drawn keeps its plain link under the nodes rather than raised over a node as a grey stripe, as the path most walks take is drawn; at SV-mul-1k-10k's fit six such links were raised ([0314a7c](https://github.com/GMOD/bandage-core/commit/0314a7c3d3aca49fb1c18d43fb992be9b91bc24d))
- Tests expect the skip rule in small sites' nodes mode too: a figure drawing every node still counts its 1 bp skip, too short to arch, on the key's "1 skip under 2 bp not drawn" line and counts no node; the test folds carry shortSkips, the skip test asks graphKey with the layout fields it reads, and the hosted fixture is checked before it is read, so the project typechecks and lints ([a25156f](https://github.com/GMOD/bandage-core/commit/a25156f866a6089a48c058266199702eba60cc33))
- A stretch a cut did not load folds to a placeholder of its own walk: threadFoldInput hands graph-fold the placeholder flag, and foldedGraph places the node on its walk's contig with the placeholders table set, so it is one walk deep, hovers as "97.0 kb of HG00128#1's route, nodes not shown" and turns the thickness to uniform with the key's "thickness not drawn", where at H-AMY1 HG00128#1's 97,028 bp shared HG01960#1's loaded 94,133 bp node, labelled 94.1 kb and two walks wide ([8243162](https://github.com/GMOD/bandage-core/commit/8243162d91f0a76fdcf5342b27dca6d2830e4538))
- The key says what a thread fold does not draw, sequence shorter than N bp that a haplotype adds to the reference or skips of it before rejoining it, whenever the graph is folded, and a lifted lane is the haplotypes that take one drawn route; "a thread is the haplotypes alike in every difference of N or more" was false at SV-mul-10k-100k, where HG00097#1's 527 bp allele is runs of 453, 1, 1, 1, 2, 27 and 1 bp between short reference steps, each under 472 bp, and rides the reference ([eb27dfc](https://github.com/GMOD/bandage-core/commit/eb27dfcf9cd2d1e5dba3a458cd3930659dbc4fc2))
- A node a thread fold drew for alleles of near lengths is labelled with their range, as its node's length and as a walk loop's, so the cluster at H-AMY1 no longer reads as one length ([f42ddb2](https://github.com/GMOD/bandage-core/commit/f42ddb29a0f3b11631037a15cd62071170aebccf))
- The test that pins a cut's placeholders off the reference sorts its import and compares the flag as lint asks ([7ab084d](https://github.com/GMOD/bandage-core/commit/7ab084d35af8b99fef2b546917a8192602d94ad9))
- Under the reference-position ramp a reference node is painted in flat pieces of at most 6 degrees of hue, each the hue of its own middle, in the graph, in a lane coloured by reference position and in the reference strip, so every drawn point is within 3 degrees of its position's hue folded or not; R100k-01's folded 198,671 bp node was one green across the window, and the key's ramp is stopped at the same step ([53fb526](https://github.com/GMOD/bandage-core/commit/53fb5269f28d8b95d63c4aeab01ef7a85c3b5484))
- A ramped node's pieces run the way the layout draws the node along the reference, as a gene pin's slice does: reversed only where a force layout draws it against the reference, so an anchored layout's node stepped reversed by the reference keeps its hues in reference order ([4b51980](https://github.com/GMOD/bandage-core/commit/4b519802a8eaff7be15ea8ae16f5f73dccb7ddec))
- The exon test reads node 5+'s ends from its laid-out line, since the node now draws as several hue pieces, and checks its pieces span exactly that line; the bare figure's snapshot carries the reference nodes' hue pieces and the key's 51-stop ramp ([82026e2](https://github.com/GMOD/bandage-core/commit/82026e2462c6f95b095bf1549130312bcd2561ce))
- In a graph with walks every skip is one solid arch in link ink at its walks' width, at every span on screen, keyed by a small arch beside "skips GRCh38 sequence", where it was dashed in near-black; a graph without walks keeps its dashes ([2f50ef6](https://github.com/GMOD/bandage-core/commit/2f50ef6c3eb02d7136f925883f23f2f0619810d2))
- A reference node some walks read against the reference carries no mark of its own, no heads and no lane, and draws at its full depth; the turn links into and out of the stretch, painted over the nodes with their heads, show the reversal, the hover still names the haplotypes, and the key no longer keys a head against the reference ([38be5f0](https://github.com/GMOD/bandage-core/commit/38be5f0244d58ad8e3cfa77e8ad6efe64dab739b))
- A stretch a cut did not load folds as the loaded allele of its length at its site, as graph-fold 1.2.0 names a branch by site and bp, so HLA-II's default cut folds to the 54 nodes, 76 links and 7 threads of its fully loaded cut with walk widths, where seven sites drew twice as hollow loops; reverts 8243162, keeping f42ddb2's range label ([7a3ebb0](https://github.com/GMOD/bandage-core/commit/7a3ebb07b09b187a2de0bf05a92556c3acdfd418))
- A node a thread fold draws for a clustered replacement spans its alleles' own lengths, as graph-fold 1.2.0 states them, so HLA-II's 927 and 935 bp in place of 3,852 bp of GRCh38 read as 927 to 935 bp, not 3.9 kb ([3b6afe7](https://github.com/GMOD/bandage-core/commit/3b6afe7f3d90fbd2dd95f375e1060f03ec1679ed))
- A figure's countLaneScale sets how wide a thread of a folded graph draws against its count's own width, 1 by default: the lifted walk carries it, so its lane, its key swatch and its hit reach thin alike with no renderer option ([fe53144](https://github.com/GMOD/bandage-core/commit/fe5314437aa4c21337a7dc656b491d1fc236e42a))
- A figure's nodeShares writes after a node's or a loop's length the share of the drawn haplotypes that walk it, such as 81.4–82 kb · 9%, off by default: each haplotype counts once whatever thread a fold put it on, the key says what the share is of, and none is written where a walk has steps the cut did not load ([072697d](https://github.com/GMOD/bandage-core/commit/072697d2857797f24eafb58f7146a986c236132f))
- A figure's countLaneWidth 'share' draws a thread of a folded graph as wide as its share of the fold's haplotypes, 12 px for all of them, so the reference's thread and an allele's compare by width where the log widths of 314 and 137 haplotypes are 14.5 and 12.8 px; 'log' stays the default ([7cd94ee](https://github.com/GMOD/bandage-core/commit/7cd94ee0be91734fa0754f00056e4128e961e616))
- NodeShares also writes a share alone on a node whose length is not written, so the stretch of the reference a deletion skips says how many haplotypes still walk it: once for a run of the reference's nodes with one share, on its longest, where CFH's six read 70% six times; the key says the share is of the haplotypes that walk a node or loop ([44f10ca](https://github.com/GMOD/bandage-core/commit/44f10cad9d4eea932d635b0997b7080079c26959))
- Graph-fold 1.2.0, whose fold treats a not-loaded stretch as the loaded allele of its length ([77b79fd](https://github.com/GMOD/bandage-core/commit/77b79fd38e6f0f4c2880fcb9a1385b854e9694dd))

## [14.6.0](https://github.com/GMOD/bandage-core/compare/v14.5.0...v14.6.0) (2026-11-25)

### Other Changes

- A walk row says where its contig starts, how much before it the graph has no row of, and that the graph holds no more of it on the reference, where it said the contig ends ([ca145d0](https://github.com/GMOD/bandage-core/commit/ca145d02c430897211e6a35afe79de17e9dad248))
- A departure's own bp say how much of them the graph lacks wherever a row states them, one text for a stepless row and for a row that goes on by the departure ([4338013](https://github.com/GMOD/bandage-core/commit/4338013114897ae4d5bb271243a7cd02d8b84cf2))
- A walk row draws its contig from its first step in the window to its last, each stretch the way it crosses GRCh38, read in the orientation graph-walks reads the walk ([f45d341](https://github.com/GMOD/bandage-core/commit/f45d34117140116648cba575f6151a44098801f2))
- A stretch a row walks against GRCh38 draws chevrons, the readout states its bp reversed and the key names the mark ([0a5e9b1](https://github.com/GMOD/bandage-core/commit/0a5e9b197ffd76fbad6063ab2ee5f9239d940853))
- A row whose walk starts inside the window starts under the reference row's base it starts at, the key can say rows are not on the ruler's scale, and a scale bar states the rows' bp ([072ce94](https://github.com/GMOD/bandage-core/commit/072ce943fff052579ca64b422133a87cd4ee5536))
- A gap longer than the window draws a quarter of it long at a break, so a row crossing the window twice leaves the other bars their width ([c7870f4](https://github.com/GMOD/bandage-core/commit/c7870f41c729def13801ec227b80e78ebe34c0fb))
- Comments on walk rows say what the rows now do, in fewer words ([ef64e3e](https://github.com/GMOD/bandage-core/commit/ef64e3ed7accb23f4993ec3414e7e6f548e191a8))
- WalkRowInks counts a tile's offset from where its bar starts, where a host passes the bar's offset ([a5698f2](https://github.com/GMOD/bandage-core/commit/a5698f28a0ed4724b85fbbd0f024dde48091d5a3))
- A row whose bar reaches over contig outside the window states its bp as "N of its contig", not "≥ N", which read as a length over the window ([2137bad](https://github.com/GMOD/bandage-core/commit/2137bad1ec2090ee10dff63ba457d5633bc5f05f))
- Rows read every contig by graph-walks' per-path rule, draw a stretch away from the window as one fixed-width break on a piecewise axis, state no position for it but a rejoin a record states, chevron joined reversed stretches, and say a flipped row is drawn right to left ([0f88498](https://github.com/GMOD/bandage-core/commit/0f884984f04e0aee803d08a81797ea0361165521))
- Rows mirror graph-walks' rule: a departure end decides only where one stands on the reference the other way at each end of the path, and a path of departures alone reads as most of their ends stand ([1ff13f3](https://github.com/GMOD/bandage-core/commit/1ff13f3ca5b5b6477fdb99c99ec1631afe0b1584))
- Only bp left out of graph read as a lower bound beside a piece the cut did not read ([fc7e5b6](https://github.com/GMOD/bandage-core/commit/fc7e5b63e1336ca3186a900d7b276e245aca56e4))
- Chevrons stop at a stretch off the reference's path at least one chevron wide, so own sequence between two reversed stretches carries none ([27e45a1](https://github.com/GMOD/bandage-core/commit/27e45a1ca27a9170143ca73145efc44cd88dda89))
- SegmentPart's comment says pieces the cut did not read are not drawn, with no place they were last seen ([5251487](https://github.com/GMOD/bandage-core/commit/5251487018d1549d8f94ead629deb50c2bd442da))
- WalkRowsTree's chevron call is laid out as oxfmt formats it ([0b86647](https://github.com/GMOD/bandage-core/commit/0b8664754e52e99dfb379586dc1010e2bca7e07e))
- The both-ways node test also inverts a node passed once, so it fails where b's second pass is marked reversed and where nothing is ([1333ce7](https://github.com/GMOD/bandage-core/commit/1333ce795e0584b974d49dc8de42d6ec56712b27))
- Rows read each contig by core's own rule, tested on its own against graph-walks 9.1.0, with no parity test or claim; the departures doc says graph-walks' structural forms read per chain and can differ inside an inversion ([4fc75d3](https://github.com/GMOD/bandage-core/commit/4fc75d325fdc97e4e54526c08decba5caf9e3da1))
- Rows never flip: every row reads its contig in stored order, each run reversed where its steps' strands are against the reference's, and a stretch away from the window draws no wider than one width ([21ff65f](https://github.com/GMOD/bandage-core/commit/21ff65f2cc7290f1476b5815a8c0e322a077c00a))
- WalkedBp reads a row's bp less those it holds away from the window, so a stepless row's departure hairlines count nothing and hosts can pass rows that carry runs or not ([5d1b0a9](https://github.com/GMOD/bandage-core/commit/5d1b0a9ade3af7c887c723d01418c586ca5759cd))
- A host that passes walkRowsExtent its width gets bars short enough that every readout is drawn whole beside its bar, on two lines where the rows wrap them, the bars keeping at least a quarter of the width; figureSvg passes its own ([09283b0](https://github.com/GMOD/bandage-core/commit/09283b0b3a320208b119ef73fbfba36fd670c78b))
- Chevrons are drawn over a stretch walked against the reference where the host paints the bars itself, as the plugin does, which since dd9eed7 drew none while its key and readouts said "reversed" ([3e30b25](https://github.com/GMOD/bandage-core/commit/3e30b25320ca3730b95c0e4456b1ef1ca64c0282))
- The readout's part breaks are matched by a regex written in ASCII, so ggbandage's bundle, which now takes it through walkRowsExtent, stays printable ASCII ([979226a](https://github.com/GMOD/bandage-core/commit/979226a873fcd223ce1ca4727ac97dc2cf855641))
- The chevron test's runs are typed as WalkRun, so the test project typechecks ([60a431f](https://github.com/GMOD/bandage-core/commit/60a431fee33c70208f87f2ddff9eb1f397495ee1))
- Every row starts at the left, its colours alone saying where on the reference it lies: axis.offset, barStart and the second pass shifting visits are gone, a visit's start counting the breaks before it as the row is read ([fb1e539](https://github.com/GMOD/bandage-core/commit/fb1e53938833c40aa8e6676dddf66954d364c228))
- A gap between two pieces holding bp away from the window and none of the walk's own sequence is one trip out of it, drawn as one break: the bp the graph lacks in it no longer draw as a hairline on a side they need not lie on, and the text still sums them apart from the bp away ([193b71e](https://github.com/GMOD/bandage-core/commit/193b71e1f4c19619bf4029c4f4bd23aa95acbacf))
- The walk rows key names a stretch away from the window that and no more, since it can hold the walk's own sequence on nodes GRCh38 does not walk, as H-SMN HG00097#1's 167 kb do ([a3d2bd7](https://github.com/GMOD/bandage-core/commit/a3d2bd717208a654d0d5de527fbba063d41e030f))
- A stretch coalesced at the drawing's scale is reversed only where every bp of it on the reference is walked against the reference, so chevrons never sit on sequence walked along it ([bcf23f0](https://github.com/GMOD/bandage-core/commit/bcf23f026ca1e36964c0a82afd6bb7d7182207de))
- A walk row's readout is one line: the bp its bar shows, with its change against the reference where it crosses the window, `//` and the bp its breaks stand for, and where the walk goes on past an end that is not its contig's; the full text is its hover. Every bp a row states rounds by one rule, so 109,415 bp read 109 kb everywhere. The two-line wrap, the breakdown and clause cutting go, and gapStyle takes no reference it never used ([1c535f9](https://github.com/GMOD/bandage-core/commit/1c535f985a2fd2a7ece485a650170520bf97e4c3))
- A walk row's line is its bar's length, "≥" where its contig runs on, its change where it crosses the whole window, and "// N kb" for what its breaks hide, nothing else; its hover gives no place a walk comes from, and calls bp a trip holds "not drawn or left out of graph" where no departure was read across them, as at R1M-06 HG01123#1 whose 716 kb lie between W lines; the key is swatches by name with no break or placement sentence ([556a333](https://github.com/GMOD/bandage-core/commit/556a333c4147396b0ac4cc606af08593b6c69770))
- A walk row's line reads the same at every zoom: `//` sums every bp the row spends away, drawn to scale or shortened, and the change against the reference is given only where the row crosses the whole window with none away and no replacing pass, so pggb chrY's NA20806#1 reads "675 kb · // 3.4 kb" beside its hover's "of which 3.4 kb away". Tests fail if the ≥ rule, the // sum or any delta condition is dropped. bpText is called by its name, and comments that restated the code are gone ([a3fcfb7](https://github.com/GMOD/bandage-core/commit/a3fcfb7afdf5461d4b491d6222b890655313ce5f))
- The R1M-06 HG01123#1 test comment states the fact: of its 716 kb between two pieces, 537,765 bp lie on two W lines away from the window and 178,161 bp between W lines, as its departures state; the cut reads no departure across the first, so the hover keeps "not drawn or left out of graph" for them, the words true with what the reader can know ([5eca3a6](https://github.com/GMOD/bandage-core/commit/5eca3a6213f3979f48119d12c5a80f825257f11f))
- The departures doc describes what walk rows draw: a one-line text of length, ≥, the change across the whole window and // N kb, and everything else in the hover, with no place for where a walk comes from; the GSTM1 figures are rendered from this code ([e438e78](https://github.com/GMOD/bandage-core/commit/e438e7840735e64a0c1991445fae61943f103280))
- BREAK_TEXT is gone: no host keys the break any more, the row's line saying "// N kb" beside it ([6ed19ec](https://github.com/GMOD/bandage-core/commit/6ed19ecc2c1c51e52330dbb00cc51d3395f90727))
- WalkRowReadout's "of its contig" text is built at module scope, as oxlint asks, and the turning-back test's stop is typed as a WalkStop, so the project lints and typechecks ([904d8dc](https://github.com/GMOD/bandage-core/commit/904d8dc4f0f18be77e340cb3ab5eed3fe56a083f))

## [14.5.0](https://github.com/GMOD/bandage-core/compare/v14.4.1...v14.5.0) (2026-11-23)

### Other Changes

- A fold of a cut keeps a short allele that leaves the window without rejoining, since the reference it replaces cannot be measured there, where it folded away a 93 bp allele standing for a 7 kb deletion ([812717e](https://github.com/GMOD/bandage-core/commit/812717e6f4c98533fe72322944cfb46355b87cc4))
- A tube map box off the reference says its length where the box is wide and tall enough to hold it, since the log width scale draws a 9 kb box and a 46 kb box alike ([520c9e6](https://github.com/GMOD/bandage-core/commit/520c9e6ac048e5e9dfdb3fa4324cb99ef4f4390f))
- A graph with walks folds to threads: foldThreads merges every difference under a size into the reference through @jbrowse/graph-fold and draws one lane per route, as wide as the haplotypes that take it ([43e2f73](https://github.com/GMOD/bandage-core/commit/43e2f734bba8a65a325fe74d9faed9f28b2e9e67))

## [14.4.1](https://github.com/GMOD/bandage-core/compare/v14.4.0...v14.4.1) (2026-11-23)

### Other Changes

- Tubemap-core 2.1.1: a tube map of a few hundred thousand nodes is laid out where its ordering pass ran the tab out of memory, each layout the same as before ([55409b5](https://github.com/GMOD/bandage-core/commit/55409b5d3929f1107e66fe7dad25998a9dcca699))

## [14.4.0](https://github.com/GMOD/bandage-core/compare/v14.3.5...v14.4.0) (2026-11-22)

### Other Changes

- GeometryFold gives the fold a build with the same options makes, without building it and cached for that build, so a reader can size the key that names the fold before it fits and builds the drawing once ([12403af](https://github.com/GMOD/bandage-core/commit/12403af0ce0936ee04d1b7f86ba135c6bca1729b))
- The long-link hover test checks 300 points against a scan of every link, where 1,500 ran past vitest's 15 s timeout on GitHub's runners ([3a3820c](https://github.com/GMOD/bandage-core/commit/3a3820c8a5d43c6d3f51adbda26add7f062bb0a9))

## [14.3.5](https://github.com/GMOD/bandage-core/compare/v14.3.4...v14.3.5) (2026-11-22)

### Other Changes

- RunsAlong tests each segment of a skip's stretch against only the samples of its route that lie in the segment's box, grown by the reach, in a tree of boxes over the samples in order, and stops once more than half are found, so it returns what testing every sample against every segment returned while building the curves of the 14,142-node window of HPRC release 2's pggb chrY graph at 256 times its fit zoom takes about 0.7 s in Node where it took about 65 s (4.9 billion distance tests over 522 skips whose stretches sum to 10.3 million segments), with the window's curves and render batch byte-identical at six zooms, and the graph plugin draws the eight dense 10 kb windows of that graph in headless Chrome in 8.5 to 10.5 s where they took 78 to 123 s, with screenshots byte-identical; a check against the old predicate on random stretches and skips near the reach, a check of the counted points against every segment, and a test of 202 skips over a 10,000-segment stretch, which the old predicate took about 40 s on, keep it so ([99d1737](https://github.com/GMOD/bandage-core/commit/99d1737f141d35e669c20156f1a8b682985ad53f))
- Bandage-core depends on @jbrowse/graph-stress-layout ^1.1.0, whose bar hung under a gap clears its own links, so a deletion nested in a deletion draws as two detours, and the suite passes unchanged on it (1846 tests, figure snapshots byte-identical, no expectation moved) ([a382bbb](https://github.com/GMOD/bandage-core/commit/a382bbb69166658abce8e85272c76e20a4161568))

## [14.3.4](https://github.com/GMOD/bandage-core/compare/v14.3.3...v14.3.4) (2026-11-22)

### Other Changes

- ClosedStretches tests a join's span against a running count of unlinked reference neighbours, so FMMM's arch seeds read each like-end join once where they walked its whole span, and the 14,142-node window of HPRC release 2's pggb chrY graph seeds its layout in about 0.5 s in Node where it took about 5 s, with byte-identical engine input. The span walk came in with archSeeds (45da3af, 14.0.0); a test of 15,000 joins over a 40,000-node reference, which the walk took about 50 s on, and a check against a rank-by-rank walk on random cuts keep it out ([84a78ee](https://github.com/GMOD/bandage-core/commit/84a78eec35afbd4d76fa8d876a7775c1d4ecbb7e))

## [14.3.3](https://github.com/GMOD/bandage-core/compare/v14.3.2...v14.3.3) (2026-11-22)

### Other Changes

- The hit-test grids keep a box that would cover more than 1,024 cells in a short list tested whole on each query, sorted into the order stamping it would have given, so the two links across the force layout of HPRC GRCh38's MHC no longer stamp 22 million cells each and the first pointer move over that drawing leaves the heap near 250 MB where it ran Chrome's tab out of its 4 GB, with every query returning the same entries in the same order ([166e352](https://github.com/GMOD/bandage-core/commit/166e352e43193a7312e6bdadd904b326bd687507))

## [14.3.2](https://github.com/GMOD/bandage-core/compare/v14.3.1...v14.3.2) (2026-11-22)

### Other Changes

- Exon outlines and drawn ink are tested against a grid that holds each piece with its reach-grown bounds, so a label refuses a spot on four comparisons before the exact test; exon cells are 8 px, so a gene name a row off a zoomed-out reference line meets none of them, and the pane's offsets for a leader are kept between frames. Panning the HPRC GRCh38 session over 414 RefSeq genes lays out its labels in a few ms a frame where it took ~700 ([239f2d6](https://github.com/GMOD/bandage-core/commit/239f2d643be3abe22da4e557be3190893f793eee))

## [14.3.1](https://github.com/GMOD/bandage-core/compare/v14.3.0...v14.3.1) (2026-11-22)

### Other Changes

- Graph-walks 9.1.0 in development: the tests and scripts read walk files with it, where an over-budget window is refused before its rows are decoded and departure-dense windows cut faster ([129f55b](https://github.com/GMOD/bandage-core/commit/129f55b6dcf4b006c2fd55feeb78db7ede7ab5c7))
- Gene names and node lengths test their spots against an index of the exon outlines, and a segment whose box misses a label's is refused before the exact test, so a 25 Mb window of RefSeq genes lays out its labels in milliseconds where each layout took seconds ([37f48d4](https://github.com/GMOD/bandage-core/commit/37f48d4acde5cba27a943918f3e95b482e3278af))
- LabelLayout.ts formatted with oxfmt ([06a101d](https://github.com/GMOD/bandage-core/commit/06a101d8bdd2cd457e2c9ea3038ec7691c33734f))

## [14.3.0](https://github.com/GMOD/bandage-core/compare/v14.2.0...v14.3.0) (2026-11-21)

### Other Changes

- Graph-walks 8.0.2 in development: a unit table whose entries leave a gap, overlap or are out of file order is refused, and a cut of every haplotype takes under half the time ([77d571f](https://github.com/GMOD/bandage-core/commit/77d571f586db671a1a3560d3286426d9fd935fba))
- Reads are painted forward red and reverse blue, as JBrowse's alignments track colours strands, from tubemap-core 2.1.0's read ramps, which every tube map reader now shares; the tests and scripts read walk files with graph-walks 9.0.0 ([cfaac76](https://github.com/GMOD/bandage-core/commit/cfaac762c4f70e8ab70fc5f9e363654fe13f69e4))

## [14.2.0](https://github.com/GMOD/bandage-core/compare/v14.1.0...v14.2.0) (2026-11-21)

### Other Changes

- A raster paint group is stroked every 1,024 subpaths, where it was one path of tens of thousands: Chrome's GPU canvas drew a 50,000-node FMMM layout in 201 ms a frame, from 274, and its CPU canvas in 218, from 336 ([86276e2](https://github.com/GMOD/bandage-core/commit/86276e24e930024669562447892baf81faa8c479))
- A raster paint group draws one of the subpaths under a quarter pixel that land in the same eighth-pixel cell and leaves out the rest, which all drew there: 41 ms a frame on Chrome's CPU canvas for the 14,645-node KIV-2 graph, from 56 ([b7ffbc7](https://github.com/GMOD/bandage-core/commit/b7ffbc75d663184893827ddac07c7799361d1e15))
- Agent-docs/multi-contig.md records why the multi-contig branch is parked, the refuse guard to add instead, and what to settle if the branch comes back ([93ff32c](https://github.com/GMOD/bandage-core/commit/93ff32c1097bb6466f8c122496412357e8b659b0))
- Scripts/render-lab times Canvas2DRenderer against an instanced WebGL2 prototype on screen: the prototype holds vsync on whole-graph views of 15k to 50k nodes, where Canvas2D draws 3 to 18 frames a second ([ec1dbad](https://github.com/GMOD/bandage-core/commit/ec1dbaddf4c0e7edb7174e06857bf935261bc2ce))
- Canvas2DRenderer's header names ADR-047's WebGL2 backend for drawing on screen, where it quoted 11 ms a frame for 15k nodes that held only with most of the graph off the pane ([0a0964b](https://github.com/GMOD/bandage-core/commit/0a0964bdb6fb41a30976ed6e4d77e9ee6669d4df))
- A reference copy the reference walks over an earlier copy's nodes records those nodes, and each one's hover names it ([99d4ca1](https://github.com/GMOD/bandage-core/commit/99d4ca1d29c93909277a68c06e87b883a590797e))
- A reference copy the reference walks over a named copy's nodes is named in that copy's name: two in full, three or more numbered copies as how many they are ([bcfbcc4](https://github.com/GMOD/bandage-core/commit/bcfbcc438c521fd2f03f359ef6805de9896a598c))
- A haplotype's copy of a gene the reference names in an earlier copy's name is not named again ([a4f0100](https://github.com/GMOD/bandage-core/commit/a4f0100fadc17f0a66f901849d9b8c9ef9dd42cb))
- The graph key says the strip's tab marks the graph's reference continuing past the pane edge, and keys a drawing's top and bottom edge marks with an entry of their own ([13c27ff](https://github.com/GMOD/bandage-core/commit/13c27ffba647b99726f23390911d35c1a491bafc))
- The key's entry for the drawing running past the pane's top or bottom has a swatch of its own, an up and a down triangle, as the edge marks point ([6549517](https://github.com/GMOD/bandage-core/commit/6549517448e588ce0e1477608d602478a54e26a3))

## [14.1.0](https://github.com/GMOD/bandage-core/compare/v14.0.2...v14.1.0) (2026-11-20)

### Documentation

- Docs/cli.md names gbz as a graph source and the spec fields its table lacked, and docs/api.md shows genePins' stranded parameter ([8bcf5e3](https://github.com/GMOD/bandage-core/commit/8bcf5e3d5a2d7c984a1565048f462cd3e0b296d8))

### Other Changes

- The tests and scripts read walk files with graph-walks 8.0.1, the version the plugin and ggbandage bundle: 7.0.0 returned no departure a piece makes across a hole for a window inside it ([957a674](https://github.com/GMOD/bandage-core/commit/957a6746c5a1f89970b671f52bf3d1ef3b458cfd))
- Path ribbons fan across the curve a link is drawn on, where they fanned across the chord from one node's end to the other's start and a link joining other ends drew them as one line ([15dd80b](https://github.com/GMOD/bandage-core/commit/15dd80be27c36fd755af2329314d8c0bb84574f7))
- The tube map's pointer names the tube painted on top where tubes cross, which was the one underneath: a layer's paint order is now its layout's alone, so neither a restyle nor a pan changes which tube covers which ([173ea42](https://github.com/GMOD/bandage-core/commit/173ea42af51f2373d35c7d1e40411dd2d25dbf75))
- A link's pass threads are keyed by the link with its strands, so two links between the same two nodes no longer draw each other's passes ([f4f407b](https://github.com/GMOD/bandage-core/commit/f4f407b01857427840f04802ec81cffd06873192))
- RecordingCanvas ships its declarations: the build published its JS and left its types out, so the plugin's tests kept a hand-written shim ([5513f8d](https://github.com/GMOD/bandage-core/commit/5513f8d8c947badf14b1fb7fae51191fc74b0324))
- The reference bar ends where its bp do, where its gaps were counted twice, and a row turned back at its leading end starts its axis where its bar starts ([657bf3b](https://github.com/GMOD/bandage-core/commit/657bf3b3b5bc8f7fe198bd5b5dee4c267e96bf5f))
- SharedRowOrder compares only the nodes that can change the order, about five times faster on 90 rows of 3000 nodes with the same order, and orders no rows as none ([f09b3b8](https://github.com/GMOD/bandage-core/commit/f09b3b813e603310f1d793f0ad6fe726c3207f09))
- PolylineMidpoint, which nothing called, is gone, and polylinePointAt is nowhere on a polyline with no points ([7aa6420](https://github.com/GMOD/bandage-core/commit/7aa642072abe179be4f437f359d7b5487fff7855))
- A BED3 file with CRLF line endings reads as BED, a gene grouped by gene_id alone spans all its rows where it took its first exon's span, and GTF attributes are read ([e4d9bc6](https://github.com/GMOD/bandage-core/commit/e4d9bc69b772c673231238e0361c0119953a4819))
- The node thickness key counts walks, not their records, link thickness is not keyed where a ribbon per walk draws the links, and the key and hover group digits the same in every locale ([d84147d](https://github.com/GMOD/bandage-core/commit/d84147d2a47c2afa2841347bcdc340bcb9660282))
- RoughBp reads 1 Mb where a stretch rounded up to 1000 kb, and departureTails builds no set of every walk step before it has a tail to check ([dc87586](https://github.com/GMOD/bandage-core/commit/dc87586b8cdbef276c5c4b915e63c24b71be46ee))
- A name whose second part is no haplotype number, such as HG002#mat#chr1, is no PanSN name to panSNFields, where two such walks became one named sample#NaN#contig ([8f5f933](https://github.com/GMOD/bandage-core/commit/8f5f93307ddee8291a1f5a1281c47bb8484b5f73))
- WriteRgfa writes no link to a segment the graph does not hold, where it wrote the name undefined, and mergeAlleleRuns drops the sides it carried as constants ([b1999b3](https://github.com/GMOD/bandage-core/commit/b1999b36518d344d77ebd8d1ec451f66783320c4))
- GfaConverter builds a walk's PanSN name once, and gbzCut reads comma-grouped numbers with locus's commaNumber ([4619ac5](https://github.com/GMOD/bandage-core/commit/4619ac55f2196cb7fe920b8338061e15331a9a62))
- NodeAnchor is the middle of a two-point node, where it was its far end ([941d8fa](https://github.com/GMOD/bandage-core/commit/941d8faf4ad4c77b72208358dcea04435a76171a))
- The force layout cache drops the layout asked for longest ago, where it dropped the one made first even while it was on screen ([f1aa402](https://github.com/GMOD/bandage-core/commit/f1aa402d72acd71aa12cf482a38ae572ac23caf5))
- A bubble's route count reads in millions from a million up, where 510 million routes read 510000k ([e214c00](https://github.com/GMOD/bandage-core/commit/e214c0090b564c8e88033c4440286dc39e12f269))
- PathVisits.pathIndex reads a map built once, and the layouts share buildNeighbors, compareValues, pushTo, addTo and MIN_DELETION_BP where each kept a copy ([5edf389](https://github.com/GMOD/bandage-core/commit/5edf389d7eeb415068a45b213b41a28e998932aa))
- FacetSettingOf keeps a column count only where it is a finite number of at least one, so a session's null is unset ([0f6ec48](https://github.com/GMOD/bandage-core/commit/0f6ec48fb20eab81b2f854f46434b892b216700a))
- A figure's key gradients take positional ids, where a walk named with a quote, an ampersand or an angle bracket wrote an SVG that did not parse ([63d7413](https://github.com/GMOD/bandage-core/commit/63d7413d0af65853a55d9e2d4dc71f27e6902771))
- Render-figures refuses a dist built from another version than package.json's, which drew the 14.0.0 figures with 13.3.0, and a name no spec has ([8aab642](https://github.com/GMOD/bandage-core/commit/8aab64233e637256274ca9101bbdaef49a7913ac))
- Pointers to the plugin's agent-docs name the repo and the path they live at, and tubemap-render imports from TUBEMAP, not a home directory ([114ebfd](https://github.com/GMOD/bandage-core/commit/114ebfdddeb5223e43653871214fb31ef3036803))
- Depths a file states, by a DP tag or a count over a length, are keyed as depths, where a graph with walks keyed them as walk passes ([528facb](https://github.com/GMOD/bandage-core/commit/528facb523e28a816202d83e905e88325d300f29))
- JoinCuts looks for a missing link only where two pieces of a walk were joined, about twelve times faster on three cuts of 301 walks by 20,000 steps ([40f2c07](https://github.com/GMOD/bandage-core/commit/40f2c07067924d93c982b723370f13003a3d6561))
- Bubbles, the reference order and the force seeds take a backbone on several contigs one contig at a time, where bubbles paired a boundary on one contig with one on another and the order interleaved them by coordinate ([e483d70](https://github.com/GMOD/bandage-core/commit/e483d705923878521ba0a70e6aae109a6a74c71c))
- A rebuild that only moved the viewport reuses the link heads it spread, and a link that draws nothing leaves the edge loop before its setup: about four times faster per pan on a 30,000-node chain ([b05ac70](https://github.com/GMOD/bandage-core/commit/b05ac708e8aa0c4930381129eeb05c369b36dbc2))
- WalkHighlight states no unreadBp, which nothing read, and a facet no longer tests a haplotype panSNFields already parsed as a number ([9e5370d](https://github.com/GMOD/bandage-core/commit/9e5370d9c55957e3d4c9b23113fa89cc6f50e0a8))
- The spell check runs a pinned typos release, as every other action is pinned ([54a7677](https://github.com/GMOD/bandage-core/commit/54a76776f8c4603e7f2a73ca94476556530fd403))
- A link carries the walks that take it, read either way along it, where every link between the same two nodes carried the walks of any of them ([a664c19](https://github.com/GMOD/bandage-core/commit/a664c19ec4d5ce39a6562c192cbdf01edc40c66c))
- A superbubble that runs round from the later of its two reference ends to the earlier, as one across the origin of a circular contig does, is off the reference, where it was placed across everything between them ([8415ed7](https://github.com/GMOD/bandage-core/commit/8415ed7a7588bf496e0d804fa43f3fbb0eb37288))
- Both superbubbles round a ring of two nodes are listed, keyed one each way and each reading the walks through its own interior, where one was dropped as a copy of the other and the one kept took routes from walks through both ([2a05e70](https://github.com/GMOD/bandage-core/commit/2a05e7061b647877d6755842549955da5cefabad))
- The refused-layout test names a layout that is no near miss of a word, which the spell check failed ([994b4c7](https://github.com/GMOD/bandage-core/commit/994b4c74563b53e32e6adb577062443034b1c559))
- A facet's order is its `sort` alone: FacetInput's `domain`, deprecated through 11.x, is gone ([2d1fe7b](https://github.com/GMOD/bandage-core/commit/2d1fe7b4cf9691197e67baeb5d3309a91784cdde))
- A bubble reads a walk where it crosses the bubble itself, so a walk written round a circular contig's origin, which visits a bubble's ends the other way round or by the link that closes the contig, leaves it, where it was given a route through the rest of the contig or one of 0 bp ([9d31ddf](https://github.com/GMOD/bandage-core/commit/9d31ddfb9f92aa0c8308c73fd839ba718ea7a013))
- An allele that leaves a later reference segment downstream and rejoins an earlier one upstream, round a circular contig's origin, is placed as a run with no reference span, where it was drawn over everything between its anchors and said to skip their difference in bp ([97c4dc3](https://github.com/GMOD/bandage-core/commit/97c4dc30d1885bdc645e8dd1e88cd3f1f52621ef))
- Nodes widened by depth on a raster canvas draw at the nearest eighth px of half-width and share a few dozen strokes, where a graph of distinct depths took a stroke per node: 590 ms a frame on Chrome's GPU canvas for 50,000 nodes, from 1,060 ([3f1dc79](https://github.com/GMOD/bandage-core/commit/3f1dc795e82d1044bdc1900816d98347bf7baa76))
- Fold parity runs only against the gfa-to-tabix release CI pins, where it ran whatever gfa-to-tabix PATH held and failed against 4.0.0, whose fold writes a link stated twice as two rows ([7921732](https://github.com/GMOD/bandage-core/commit/792173295fe8abd5bc4a8bc7ed5af30c84ab7c77))
- A drawing writes every node's length on it by default: LABEL_DEFAULTS.nodeLengths is true, so the plugin, BandageJS and ggbandage, which all read it, write node lengths unless a host or a figure turns them off, and a placeholder's length is written either way ([f55d2f4](https://github.com/GMOD/bandage-core/commit/f55d2f40bc216f0292a0b265f68c065c4b7fc81d))
- A node's length covers no exon outline and no node it does not name, and does not hide the node it names: it stands on its node at the first of fifteen spots where the node runs on a line's height past the box at both ends, else off the node's middle on a leader within three rows whose path no other ink or label crosses, else it is not written. HPRC's C4, CFH and KIV-2 cuts wrote lengths over exon outlines and over nodes drawn shorter than the words, and CFH under FMMM wrote none on its three longest nodes, whose middles gene names took, as a node's length tried its middle alone ([14face0](https://github.com/GMOD/bandage-core/commit/14face03cf6b4bafe84a1e2a1ccde92e79106c03))
- A walk's threads lie over every node they are drawn for, at any pane size: a lane's line is smoothed once, over half a band either side, so it never runs more than half a band off its nodes, and where it still turns tighter than half the band every thread's offset shrinks by the turning radius over half the band, so the inner thread rounds the turn rather than folding back. cutCurls took the chord of any curl under π bands that closed within half a band, and loosened smoothed tight turns up to eight more times; both weighed the band in screen px against the loop in layout units, so on the C4 syng graph a thread ran 41 to 51 px off its node against a 28 px band, the HERV-K loop's grey and blue threads curled at its base at 750 by 550 and left it at 560 by 390, and at every size all three walks skipped the small loop at the lower right that each of them walks. Now no thread there runs more than 17 px off its node. Tests draw two loops at four scales and check every thread lies within the band of its node and, on a loop as wide as the band, runs the way its node does. ADR 3 records this and supersedes ADR 1, since hairpin tips now reach their nodes with the band narrowed there; the zigzag test allows its normals 0.2 off vertical, where the walk turns back on itself within a band ([9069538](https://github.com/GMOD/bandage-core/commit/9069538ab7827f26318497feceac35deddc8173b))
- Threads on C4's syng graph stay on the nodes and links they walk at seven pane sizes and three zoomed-out views ([1fa684e](https://github.com/GMOD/bandage-core/commit/1fa684e501e9633231030ab7f9a5fad16e022e5f))

## [14.0.2](https://github.com/GMOD/bandage-core/compare/v14.0.1...v14.0.2) (2026-11-20)

### Other Changes

- A haplotype's copy of a gene it walks mostly over other contigs' nodes is not named as its own: nowhere where the reference carries the gene, and once among the haplotypes where it does not ([c09a92c](https://github.com/GMOD/bandage-core/commit/c09a92c1b64f51e75e259640dd92477352d1ccfd))

## [14.0.1](https://github.com/GMOD/bandage-core/compare/v14.0.0...v14.0.1) (2026-11-20)

### Documentation

- Docs/drawing.md in plain language ([31cb961](https://github.com/GMOD/bandage-core/commit/31cb961ea6ddfb81a51dfdfc86dae920b5e09afa))

### Other Changes

- README facet and thread figures drawn from the same KIV-2 graph ([9227e97](https://github.com/GMOD/bandage-core/commit/9227e974e2624bf5a7a9ff873011b4d26b041f00))
- Reflow the haplotype threads paragraph, which failed format:check ([f34214b](https://github.com/GMOD/bandage-core/commit/f34214b7b6d3bffdbf34ef211d88496dbd1689a9))
- Link thickness by walks keys a "0 walks" row where the cut has a link no drawn walk takes, at the floor the scale draws it with: graph-walks 8's links 'between' brings in other haplotypes' links between the drawn walks' nodes, which drew thinner than the "1 walk" row and matched no row ([2bb18de](https://github.com/GMOD/bandage-core/commit/2bb18debb9b07284a8f4f5f012ed5d2da3228a41))

## [14.0.0](https://github.com/GMOD/bandage-core/compare/v13.3.1...v14.0.0) (2026-11-14)

Reads walk format 8 through @jbrowse/graph-walks 7 and refuses format 7 files:
graph-walks 7 reads format 8 only, and bandage-core keeps no format 7 path or
shim. Rebuild a format 7 walk file with gfa-to-tabix 5.

### Breaking Changes

- `GraphTables` is graph-walks 7's: `walks.abridgedBp` and the gap table's
  `abridged` are gone, and `nodes.placeholders` marks each stretch whose nodes
  the cut didn't load
- A path's `abridged: { steps, bp }` is now `abridgedSteps`, and a node standing
  for a stretch the cut didn't load has `placeholder: true`
- `walkRowReadoutAt` replaces `readoutPlacement`

### Other Changes

- Lint with oxlint, format with oxfmt and typecheck with tsrs ([c7047f3](https://github.com/GMOD/bandage-core/commit/c7047f3a9516f6f3841f6ee9620ef66efce88c38))
- Format with oxfmt ([9250f2b](https://github.com/GMOD/bandage-core/commit/9250f2bc68df15c3a16361745b400b7f3786bea2))
- Turn off consistent-return, as graph-walks and the layout packages do ([c216a72](https://github.com/GMOD/bandage-core/commit/c216a72354cc3d10707085b61be2ce27d7c06c45))
- Orient segments and spell links by the reference, not by the file ([a19a53b](https://github.com/GMOD/bandage-core/commit/a19a53b6bf3d7cb9df5d0bfb42437a2ff57ca8a2))
- Follow graph-walks 7's placeholders: runs not loaded in loaded geometry ([d734ba8](https://github.com/GMOD/bandage-core/commit/d734ba8aad36093d4b722efd8c807e20eb531115))
- Unit tests for runs not loaded, on format 8 fixtures ([b1084cd](https://github.com/GMOD/bandage-core/commit/b1084cdb0a6e2d20df89ca0d47744be2ca2e92eb))
- Hollow bars and nodes for runs not loaded, the equality and render scripts ([367e13c](https://github.com/GMOD/bandage-core/commit/367e13cfbb21179177a2b51c6aa0248d1c8df24a))
- Render a named set of haplotypes; lint ([4bddcb9](https://github.com/GMOD/bandage-core/commit/4bddcb9326625cc5835bac6da8061981c18fe8b1))
- A bubble holding a run not loaded reads as not loaded, no insertion or deletion ([996e222](https://github.com/GMOD/bandage-core/commit/996e2227e41689770fd64ee90a0ac2f642f47d39))
- Runs not loaded stay out of the shared blocks' off-path bp ([dca7600](https://github.com/GMOD/bandage-core/commit/dca7600396613c5eb5e870f7332cc82952fa39b7))
- RunPaint as one expression ([475b8f9](https://github.com/GMOD/bandage-core/commit/475b8f9f7ad17e783ea810bd6df26529435d735e))
- A readout too long for either side of its bar stays beside it, clear of the row's name ([3d48954](https://github.com/GMOD/bandage-core/commit/3d48954568ca3c263e66bb46982b3de5b20403d5))
- Equality check: hold each run not loaded to where it lies, its placeholders, its readout and its rim ([0e9ddea](https://github.com/GMOD/bandage-core/commit/0e9ddeac41ada85c31b4852f56ddb230511f5b36))
- Sample rows: a placeholder is no sequence the reference lacks ([5d06d5f](https://github.com/GMOD/bandage-core/commit/5d06d5f94e1bd86e5e2ab46c164ab0a4f053a814))
- Count a row's unloaded pieces that reach it only through a departure or a gap ([a6e6f92](https://github.com/GMOD/bandage-core/commit/a6e6f92bd7f957036a971ef5b54675a5ead217fb))
- A placeholder's GFA tag protects only bandage-core's own round trip ([dab1285](https://github.com/GMOD/bandage-core/commit/dab12854f8696b63d3d8ff394536ca36e2c67773))
- Derive the unloaded run flag, keep the key from flattening every run, drop new comments ([37f7afb](https://github.com/GMOD/bandage-core/commit/37f7afbed9f40924063eca9d0a039af86d00bb58))
- A readout beside a bar that ends under the row's name starts past the name ([dbb690f](https://github.com/GMOD/bandage-core/commit/dbb690fb8f3f7417002bb1a715a7db4bb959977b))
- Hold Departure equal to graph-walks' less its abridged pieces; format the README ([8039b38](https://github.com/GMOD/bandage-core/commit/8039b383058128d0b36a73dacc7f32c23ea3cb76))
- Type the PanSN helpers' adapter by the slots they read, so a JBrowse adapter fits ([c2fb3ec](https://github.com/GMOD/bandage-core/commit/c2fb3ec723260de1310ca2242e1e67ed70e34b88))
- WriteRgfa tags a placeholder's S line nl:i:1, as graphTablesGFA does ([1bf98ff](https://github.com/GMOD/bandage-core/commit/1bf98ff398cfb93f4e7f9caae8d812824cf38567))
- Tube map: a placeholder merges with no loaded node and stays not loaded ([10fa8ed](https://github.com/GMOD/bandage-core/commit/10fa8ed300739746c3c3ef5a3b5b8f88be104bed))
- Lift the tube map's neighbour helper out of mergesPlaceholder, as lint asks ([454c414](https://github.com/GMOD/bandage-core/commit/454c4144a57d6b3710693eef64bf76d2ca168982))
- Walk rows draw a run not loaded exactly as a loaded run off the path ([f02489b](https://github.com/GMOD/bandage-core/commit/f02489ba4aa9f0a3d586737f4c0b518994238a45))
- Ribbons, shared blocks and the shared order leave out rows with runs not loaded, and count them ([25bd49a](https://github.com/GMOD/bandage-core/commit/25bd49afadcfe4152cd2f789293f026a5266b1f7))
- Tube map: a box of steps not loaded is dashed and untinted, captioned in words ([e68e409](https://github.com/GMOD/bandage-core/commit/e68e4096ebc02dfa9a6ad5586229b727905b8543))
- Type the tube map test fixture's placeholder flags as their default ([c30fce5](https://github.com/GMOD/bandage-core/commit/c30fce5feacb4115cf3a6a9ea30841c00e524c09))
- Tube map: fit a box's caption by the canvas's own measure of its text ([3826cc8](https://github.com/GMOD/bandage-core/commit/3826cc8f29d60437426c009e0501e5633c613c23))
- Node layouts say "nodes not shown", as the tube map does; a placeholder's hover text ([223d808](https://github.com/GMOD/bandage-core/commit/223d8080c9ea9a883a1ee524959002f7c8965e4b))
- Walk rows: a key line for rows a comparison leaves out, readouts over solid bar, a marked strip under node layouts ([ac3fd43](https://github.com/GMOD/bandage-core/commit/ac3fd435f81dfbb3a3412377b4f8d2234c61795f))
- Figure export: row names get a gutter of their own ([3a27007](https://github.com/GMOD/bandage-core/commit/3a27007d801eb6af1cfdd205e94c865a483b0c33))
- Give each row its own index again; copy the dash a test records ([53c3470](https://github.com/GMOD/bandage-core/commit/53c3470220f50dbcc9a2d07572c10c338db07b41))
- Readout wording: a row's left-out bp as parts of its total, in plain words ([b7b93eb](https://github.com/GMOD/bandage-core/commit/b7b93eb2692d38af1014baa34b0c6b6b1f57c664))
- A readout with no room beside its bar drops whole parts from the end, closed with an ellipsis ([f44019d](https://github.com/GMOD/bandage-core/commit/f44019d2587c872255a92bd4646dc726e89292ec))
- Hold the readout-over-gap test to its placement, now that the readout is also shortened ([e51b535](https://github.com/GMOD/bandage-core/commit/e51b5358c64d4b1fea51b908c6550f23fd029df1))
- One readout placement for every host; say when a readout was cut; mark rows a comparison leaves out ([67f05e7](https://github.com/GMOD/bandage-core/commit/67f05e77c1b0a1aeb53efd0b23e19d1b5aa0e667))
- Say what the user is looking at, not what the reader did: "not drawn" for "not read" ([aa93440](https://github.com/GMOD/bandage-core/commit/aa934406a0833a80ffa71a7e73ba44ab9041254d))
- Figure export: clip a row layout's drawing to the right of the row names ([0fccc91](https://github.com/GMOD/bandage-core/commit/0fccc9129efb54f46a16e40de704a1de1dee3d10))
- Compare the readout's x within rounding ([6b5aec3](https://github.com/GMOD/bandage-core/commit/6b5aec38f202d1449b575e8a3c23024522d62e4b))
- Measure a readout at its font, or by the host's canvas, before cutting it ([6e05250](https://github.com/GMOD/bandage-core/commit/6e052509fafaf389f97f38134c094aa7bedb092e))
- "near a position: in the graph, drawn on another stretch of the reference" ([93da081](https://github.com/GMOD/bandage-core/commit/93da0810dae90b0f415cb3c8a61c6a15746d6bda))
- Figure export: back each row name with a pale box instead of clipping the drawing ([0688434](https://github.com/GMOD/bandage-core/commit/0688434da5445913c833f9ecc96aac3fe56e0de9))
- Build the glyph width table without spreading strings or shadowing a name ([4d47fe9](https://github.com/GMOD/bandage-core/commit/4d47fe960ad329957ce8520c48de9e17d85d4318))
- Rebuild the walk fixtures with gfa-to-tabix 5.0.0, and test attached own steps where the walk rejoins on the window's context ([8d58730](https://github.com/GMOD/bandage-core/commit/8d58730494fc7932d2a701f4f8c7d11ca1b5bd15))
- Read a link a GFA states twice, either way round, as one ([4669940](https://github.com/GMOD/bandage-core/commit/4669940fec62077729735fb652bf745875d4622c))
- Hold foldVariants to gfa-to-tabix 5.0.0's fold ([2ac9261](https://github.com/GMOD/bandage-core/commit/2ac9261da16ad83a72a5af91562320726ea3f3b0))
- Draw a stretch whose nodes a cut didn't load in an untinted grey ([956f2b2](https://github.com/GMOD/bandage-core/commit/956f2b27140778fd18b27be4162b4de46d510214))
- Depend on graph-walks 7.0.0, from its release tarball ([333dc59](https://github.com/GMOD/bandage-core/commit/333dc5952a52550a0797d9f70f80cdb3c8204778))
- Graph-walks 7 and walk format 8, and a link read once ([2a00b6a](https://github.com/GMOD/bandage-core/commit/2a00b6aa1bedafaacdc9313d09929b7d244f0159))
- Let the spell check read "2048ths of an em" ([cc314ad](https://github.com/GMOD/bandage-core/commit/cc314adfcaf96da99ba59a1f61f4dfab4ad9e95f))
- Read where a departure's held steps break ([c2076f4](https://github.com/GMOD/bandage-core/commit/c2076f4c0b5c6d83bd33083290c639430ecbc76d))

## [13.3.1](https://github.com/GMOD/bandage-core/compare/v13.3.0...v13.3.1) (2026-11-08)

### Other Changes

- Keep a lifted walk's range to what it draws ([442b498](https://github.com/GMOD/bandage-core/commit/442b4980fbd16e14468dc999eed95d5a604cb8b7))

## [13.3.0](https://github.com/GMOD/bandage-core/compare/v13.2.0...v13.3.0) (2026-11-08)

### Other Changes

- Draw a 0 bp step between abutting pieces, and light the link from a piece into its attached steps ([03ef9a9](https://github.com/GMOD/bandage-core/commit/03ef9a992716078795675f5829d2fe1eef2b0c24))
- Draw a partial row's stated ends, state its departures outside the row, and lift every stretch a walk-file cut states ([72315a4](https://github.com/GMOD/bandage-core/commit/72315a410d0e5c831354b6b73c59e7f474cdbc83))
- Develop against graph-walks 6.2.0 ([882800c](https://github.com/GMOD/bandage-core/commit/882800c498124801b3374f21d19d610981f744f4))

## [13.2.0](https://github.com/GMOD/bandage-core/compare/v13.1.1...v13.2.0) (2026-11-08)

### Other Changes

- Draw a walk-file cut's stated gaps: attached steps as steps, the rest as what the cut says ([29043e8](https://github.com/GMOD/bandage-core/commit/29043e8728bc6be54eb2ec1f5ba1d3e6a0ce63c3))

## [13.1.1](https://github.com/GMOD/bandage-core/compare/v13.1.0...v13.1.1) (2026-11-08)

### Other Changes

- Key dashed links as the reference sequence they skip, without calling them deletions ([4261645](https://github.com/GMOD/bandage-core/commit/4261645522ac5acadfe731a1dbf1d8e0cc07fe5e))

## [13.1.0](https://github.com/GMOD/bandage-core/compare/v13.0.1...v13.1.0) (2026-11-08)

### Other Changes

- Read walk format 7 with @jbrowse/graph-walks 6, pinned to its unreleased tarball for now ([01f41b1](https://github.com/GMOD/bandage-core/commit/01f41b109d4dd8d5c9928597f34d14a83174b47b))
- Read a walk whose steps in the cut are the window's flanks alone as a row of its departure ([818a1c6](https://github.com/GMOD/bandage-core/commit/818a1c6559dffd416f7457675ab5a22d722a05c8))
- Pin the graph-walks 6.0.0 tarball at a durable path, packed from e7259ee ([aa479d0](https://github.com/GMOD/bandage-core/commit/aa479d06847b125087b42df03fc9dc39c141b3f2))
- Lockfile takes the graph-walks 6.0.0 tarball repacked from e6e5a74 ([e9455e8](https://github.com/GMOD/bandage-core/commit/e9455e8652eef33178ebf2272d6b46392b0929d2))
- Depend on the published @jbrowse/graph-walks 6.0.0 ([1da2078](https://github.com/GMOD/bandage-core/commit/1da2078d7e03ac10ef5d23d85b2264d0d2fc18a9))

## [13.0.1](https://github.com/GMOD/bandage-core/compare/v13.0.0...v13.0.1) (2026-11-05)

### Other Changes

- Test against graph-walks 5.0.2 ([86b65d4](https://github.com/GMOD/bandage-core/commit/86b65d4054da2202c84804481daa2316a9274c7f))
- Read a walk that departs or was trimmed past its last step as going on ([23169a2](https://github.com/GMOD/bandage-core/commit/23169a29a989d2679218c4e9f8942ed21d574c57))
- Read a walk that stops inside a window with no flanks, or on a flank alone ([899ee29](https://github.com/GMOD/bandage-core/commit/899ee29b3aa9f032424ef767ce23c4ee81da5751))
- Let the source decide whether a walk with no flank can end inside the window ([e4e5c10](https://github.com/GMOD/bandage-core/commit/e4e5c101233c245f37c6472dcc2ce8619540db02))

## [13.0.0](https://github.com/GMOD/bandage-core/compare/v12.7.1...v13.0.0) (2026-11-05)

### Other Changes

- Read graph-walks 5's departures in place of format 5's skips and stops ([240b9e8](https://github.com/GMOD/bandage-core/commit/240b9e8971f3821d4957641ce7e8fc506829f9d3))
- Departures, stepless rows and the required GraphTables hand-off ([caebf1a](https://github.com/GMOD/bandage-core/commit/caebf1a63bf5904bfcaaf83f9faa7b471926322c))

## [12.7.1](https://github.com/GMOD/bandage-core/compare/v12.7.0...v12.7.1) (2026-11-03)

### Other Changes

- Count a line within half a halo of the key as under it ([c811d1d](https://github.com/GMOD/bandage-core/commit/c811d1d0f911adba6bfaf4cac1aa8bf66609f8ee))

## [12.7.0](https://github.com/GMOD/bandage-core/compare/v12.6.2...v12.7.0) (2026-11-03)

### Other Changes

- Move the key to the bottom left where the drawing runs under the top right ([963cf52](https://github.com/GMOD/bandage-core/commit/963cf520dff2a750dac138ab2f652b19d8994b8f))

## [12.6.2](https://github.com/GMOD/bandage-core/compare/v12.6.1...v12.6.2) (2026-11-02)

### Other Changes

- Lay deletions out as bubbles again, keeping only the route budget ([fffaf40](https://github.com/GMOD/bandage-core/commit/fffaf40360b83360c2a06475c126e2fb68a3fb54))

## [12.6.1](https://github.com/GMOD/bandage-core/compare/v12.6.0...v12.6.1) (2026-11-02)

### Other Changes

- Arch a deletion the layout left out, rather than bowing it off the drawing ([0c34456](https://github.com/GMOD/bandage-core/commit/0c3445613efe7cf0561288bd413ff606d9e9b65b))

## [12.6.0](https://github.com/GMOD/bandage-core/compare/v12.5.1...v12.6.0) (2026-11-02)

### Other Changes

- Judge each reference visit by its own strand, and lay out without off-reference links ([a69b585](https://github.com/GMOD/bandage-core/commit/a69b585727385a8379d7fbdf8757086e4fc07443))
- Say a skip row has no step on the reference, not that it is deleted ([1f53c24](https://github.com/GMOD/bandage-core/commit/1f53c24c3df2138d3b86a174bb4f4c57df586fbf))
- Route a deletion the layout has to keep, within a budget ([57d99c4](https://github.com/GMOD/bandage-core/commit/57d99c4f85a973e23db67b9554fde1328e4db740))

## [12.5.1](https://github.com/GMOD/bandage-core/compare/v12.5.0...v12.5.1) (2026-10-30)

### Other Changes

- A deletion row takes the strip's pointer along its hairline ([e382262](https://github.com/GMOD/bandage-core/commit/e3822625899ea3fda798bd854fd4861f3d89d812))

## [12.5.0](https://github.com/GMOD/bandage-core/compare/v12.4.0...v12.5.0) (2026-10-30)

### Other Changes

- A deletion row's readout names the deletion it lies inside ([4d9cb6e](https://github.com/GMOD/bandage-core/commit/4d9cb6e632f93840fc01e2bf1c4b24bea8abebb2))

## [12.4.0](https://github.com/GMOD/bandage-core/compare/v12.3.0...v12.4.0) (2026-10-30)

### Other Changes

- Bump @gmod/tabix to 3.13.1 ([99e995e](https://github.com/GMOD/bandage-core/commit/99e995edf96ec8ecb191aeba1a8fbccab43973b0))
- Exempt @gmod/tabix 3.13.1 from the minimum release age ([730e500](https://github.com/GMOD/bandage-core/commit/730e500a8611f6a6175da36c7633d32a488f7793))
- LoadGraph keeps a walk cut's skip rows on the Graph ([27ae20f](https://github.com/GMOD/bandage-core/commit/27ae20fca12342236055da4a8bf6f5da476ecb92))
- A skip row's deletion lines up under the reference's bar ([96a7547](https://github.com/GMOD/bandage-core/commit/96a7547e0b36f837df0bb8fd4ccc862f8221f17f))
- A deletion row's readout goes past its deletion ([9fa4b5f](https://github.com/GMOD/bandage-core/commit/9fa4b5f638b9dadb4d6efebee839f2b775f89e00))

## [12.3.0](https://github.com/GMOD/bandage-core/compare/v12.2.1...v12.3.0) (2026-10-30)

### Other Changes

- A gene's name goes above its pin where nothing under the pin may hold it ([2c5752b](https://github.com/GMOD/bandage-core/commit/2c5752b7126b9e90ca8bbeb7fbfd982b099955fb))

## [12.2.1](https://github.com/GMOD/bandage-core/compare/v12.2.0...v12.2.1) (2026-10-29)

### Other Changes

- Regenerate the KIV-2 figure with 12.2.0 ([f00e920](https://github.com/GMOD/bandage-core/commit/f00e9206df30e5103aac7a5c9b04021c82f39443))
- Key the dashed deletion links above a figure split into panels ([c0fa51d](https://github.com/GMOD/bandage-core/commit/c0fa51d430ffc28ea3e642319ba6e3226b84c867))
- Hand hosts the deletion key only when a deletion stays dashed ([bfbcebe](https://github.com/GMOD/bandage-core/commit/bfbcebe5e86f089b2ac357af3cb81105575dd142))
- Leave an abridged walk's stray handle out of the node layouts ([26e3b35](https://github.com/GMOD/bandage-core/commit/26e3b35b0a0806f247f13c78bf679c91faedc2f7))
- The sample-row layout mode's keepRows stays optional ([953d6ec](https://github.com/GMOD/bandage-core/commit/953d6ecd917ef8e22977c2ba808cf8d4bb560158))

## [12.2.0](https://github.com/GMOD/bandage-core/compare/v12.1.2...v12.2.0) (2026-10-29)

### Other Changes

- Draw a lifted walk's deletion as a solid lane, and key the dash only where one is drawn ([ce635b1](https://github.com/GMOD/bandage-core/commit/ce635b1ab3d0646bed7b254521e9a16d93fe2252))
- Pin a lifted walk's lane over a deletion as one solid stroke ([7f675a4](https://github.com/GMOD/bandage-core/commit/7f675a4b01b23e09733cb7568cb8ecb3539763ac))

## [12.1.2](https://github.com/GMOD/bandage-core/compare/v12.1.1...v12.1.2) (2026-10-29)

### Other Changes

- Flank an abridged walk by a handle past the cut's reference ([c870715](https://github.com/GMOD/bandage-core/commit/c870715ce82260c7c5d5e1cddeb6f9ee7906c6b6))

## [12.1.1](https://github.com/GMOD/bandage-core/compare/v12.1.0...v12.1.1) (2026-10-29)

### Other Changes

- Estimate a walk row whose abridged block runs past the window ([3b538ff](https://github.com/GMOD/bandage-core/commit/3b538ff7b2ff27fb6b283fd153c7e84b7dc9a3b3))

## [12.1.0](https://github.com/GMOD/bandage-core/compare/v12.0.2...v12.1.0) (2026-10-28)

### Other Changes

- Place an allele on the path first in name order, as gfa-to-tabix does ([dca83e3](https://github.com/GMOD/bandage-core/commit/dca83e3b39dc4aa8e1b8078b8124c877712fafd3))
- Draw a haplotype that jumps over the window as a deletion row ([9439170](https://github.com/GMOD/bandage-core/commit/943917009b19fd828f038fcb9192bfba0d8307dd))
- Draw the stub of a moved component paler, from graph-walks' mv:i:1 tag ([4450b39](https://github.com/GMOD/bandage-core/commit/4450b397dacbf271bbe5ab0cca4ee3414882706f))

## [12.0.2](https://github.com/GMOD/bandage-core/compare/v12.0.1...v12.0.2) (2026-10-28)

### Other Changes

- Count an abridged walk's bp once in its walk row ([063ed78](https://github.com/GMOD/bandage-core/commit/063ed789fcc3558bd5f8ad2d644033c2f80216b7))

## [12.0.1](https://github.com/GMOD/bandage-core/compare/v12.0.0...v12.0.1) (2026-10-28)

### Other Changes

- Draw a deletion by its walks when links are ([99ffbf0](https://github.com/GMOD/bandage-core/commit/99ffbf0e185e1cab7568d3ec21415dd4ad9b94d4))

## [12.0.0](https://github.com/GMOD/bandage-core/compare/v11.19.0...v12.0.0) (2026-10-27)

### Other Changes

- Spell a facet's panel order sort, as a JBrowse display's facet does ([51a413a](https://github.com/GMOD/bandage-core/commit/51a413a6e989c2400debf3d922974d011af4274b))

## [11.19.0](https://github.com/GMOD/bandage-core/compare/v11.18.0...v11.19.0) (2026-10-26)

### Other Changes

- Key an exported figure's walk-row boxes by the host's annotation noun too ([f8cfc47](https://github.com/GMOD/bandage-core/commit/f8cfc471048779f10639377bfc84cfc0a227197d))

## [11.18.0](https://github.com/GMOD/bandage-core/compare/v11.17.0...v11.18.0) (2026-10-26)

### Other Changes

- Name walk-row annotation boxes by the host's noun, 'gene' unless it names another ([759706f](https://github.com/GMOD/bandage-core/commit/759706f0a5fefd0efcbbc944a81fe0558667f234))

## [11.17.0](https://github.com/GMOD/bandage-core/compare/v11.16.0...v11.17.0) (2026-10-23)

### Other Changes

- Draw a node as wide as its frequency, from walks, AF tags or a table ([66d745b](https://github.com/GMOD/bandage-core/commit/66d745b838893e218979608e9b66f86f92136e93))

## [11.16.0](https://github.com/GMOD/bandage-core/compare/v11.15.0...v11.16.0) (2026-10-23)

### Other Changes

- Key the dashed deletion links in a figure, with deletionKey's words ([107d31c](https://github.com/GMOD/bandage-core/commit/107d31c4334108325ea8e9c920067a35a28be8d6))

## [11.15.0](https://github.com/GMOD/bandage-core/compare/v11.14.0...v11.15.0) (2026-10-23)

### Other Changes

- Export fadedKey, so a viewer's legend can say what its lift fades ([cd39404](https://github.com/GMOD/bandage-core/commit/cd394045bcad6a40b398273c7de3c80b0c61bc9e))

## [11.14.0](https://github.com/GMOD/bandage-core/compare/v11.13.0...v11.14.0) (2026-10-23)

### Other Changes

- Record why hairpin tips keep their pull-back, in the first ADR ([065dbb2](https://github.com/GMOD/bandage-core/commit/065dbb24d6d5e0220eb08861da2ca131a9c3aa78))
- Record why slot order stays walk order, in ADR 0002 ([fa15919](https://github.com/GMOD/bandage-core/commit/fa15919b119d26cc4c2095a3b96fd5b5646292c9))
- Name what the faded key stands for in a figure's legend ([8d61292](https://github.com/GMOD/bandage-core/commit/8d612929e73eb8f4f9ba62168f6242448cb0fb2e))
- Call a lift's faded drawing other haplotypes' when paths visit every faded node ([f06f4e8](https://github.com/GMOD/bandage-core/commit/f06f4e8444ffe1f90b0c2d7dddc2a27a38b85b51))

## [11.13.0](https://github.com/GMOD/bandage-core/compare/v11.12.0...v11.13.0) (2026-10-23)

### Other Changes

- Give each walk's visit to a node its own lane frame ([ab1cffa](https://github.com/GMOD/bandage-core/commit/ab1cffa36204cfefa3e92a53821b52fd8c597cbc))
- Ease each visit's whole thread offset along its walk ([597bc24](https://github.com/GMOD/bandage-core/commit/597bc24d1afa09ee19d9255e7a0c2a6eca1edd02))
- Ease a thread's offset point by point along its walk ([9d23337](https://github.com/GMOD/bandage-core/commit/9d233378fea70f32aa93671b485eda4cfd162206))
- Smooth a lane's line again where it turns tighter than the band ([1035eee](https://github.com/GMOD/bandage-core/commit/1035eee540097630dbe0c782974fd45ada2baffd))
- Test that lanes slide gently across links and never fold at a hairpin ([133672c](https://github.com/GMOD/bandage-core/commit/133672c1bf227ac17a23868401a10ebe98414d90))
- Draw the duplicated box at a scale where its band outgrows its nodes ([f32f799](https://github.com/GMOD/bandage-core/commit/f32f7998fbc43c6e429f6e4ec346f7f83d4cc337))
- Share the first visit's frame wherever a walk runs its way ([d3e1158](https://github.com/GMOD/bandage-core/commit/d3e1158cf590032c59b6a09842b42e81854778a5))
- Lay lane runs out by step in flat arrays, and cache steps across zooms ([11454e0](https://github.com/GMOD/bandage-core/commit/11454e00c44d3951fd8e39e91a1a2c1b63e9ee13))
- Keep one offset for a visit whose thread runs level along its node ([11cb0ca](https://github.com/GMOD/bandage-core/commit/11cb0caa57620cb7f98b61c08c88aff130534d17))
- Share a frame only where every step in reach runs the first visit's way ([c73d774](https://github.com/GMOD/bandage-core/commit/c73d774c165948f805d6ffe0947f0bbb8d8b2e84))

## [11.12.0](https://github.com/GMOD/bandage-core/compare/v11.11.1...v11.12.0) (2026-10-23)

### Other Changes

- Give the node table each node's reference position ([9b86a0b](https://github.com/GMOD/bandage-core/commit/9b86a0bb27fba410fb427f6315fa0eda006b9c66))

## [11.11.1](https://github.com/GMOD/bandage-core/compare/v11.11.0...v11.11.1) (2026-10-23)

### Other Changes

- Colour each pass of a lane by its own reference copy ([bc26053](https://github.com/GMOD/bandage-core/commit/bc260530fbc54d4e6ba8d3164ccbc18ed810d985))

## [11.11.0](https://github.com/GMOD/bandage-core/compare/v11.10.0...v11.11.0) (2026-10-22)

### Other Changes

- Draw a link by how many walks take it, as an edgeWidth option ([912c9ed](https://github.com/GMOD/bandage-core/commit/912c9ed202cf4dab8dee15491adb74de95644e3a))

## [11.10.0](https://github.com/GMOD/bandage-core/compare/v11.9.0...v11.10.0) (2026-10-22)

### Other Changes

- Shade each thread by its own pass, and add an orange ramp ([f133671](https://github.com/GMOD/bandage-core/commit/f1336713b8dfbdb409208e27f5d8ebdc040be5f6))
- Format the walkThreads test ([277056b](https://github.com/GMOD/bandage-core/commit/277056bb142c88a8a0a9523c78924f94af9119ac))

## [11.9.0](https://github.com/GMOD/bandage-core/compare/v11.8.0...v11.9.0) (2026-10-21)

### Other Changes

- Cull a lifted link before building its lanes, by the furthest a lane can slide ([1aa75b9](https://github.com/GMOD/bandage-core/commit/1aa75b9755f0b86a91164be5ac2eccc8d68b7c20))
- Smooth lane lines over typed prefix sums, and write each node's field once ([5f0d540](https://github.com/GMOD/bandage-core/commit/5f0d5403cad9fb994d1fe8a3c383bf6af833a26b))
- Assign threads over node indices, and key link threads by from and to ids ([dff2834](https://github.com/GMOD/bandage-core/commit/dff28342e367c11ad3ff3029edd268664aa55a71))
- Skip a node's position lookup once an earlier walk has claimed it ([88056b8](https://github.com/GMOD/bandage-core/commit/88056b87f7923359d3810592a8467690808a06ab))
- Cache a lift's lanes on the lift, by positions, version and zoom ([e9edcf2](https://github.com/GMOD/bandage-core/commit/e9edcf2bd036ad8fa1ac0c4bb30f62fcd90759c3))
- Split a family between the ramps lifted together that share it ([fc5b7d7](https://github.com/GMOD/bandage-core/commit/fc5b7d7b8604fcec87aa5838afa538f9484fca28))

## [11.8.0](https://github.com/GMOD/bandage-core/compare/v11.7.3...v11.8.0) (2026-10-21)

### Other Changes

- Neither viewer copies a figure spec now ([bb65214](https://github.com/GMOD/bandage-core/commit/bb652143eccd1dc149f08bb18947c03593bac072))
- Move bandage-fold's docs into the README and delete docs/coarse-tier.md ([370c9dd](https://github.com/GMOD/bandage-core/commit/370c9ddb438e64f99fbc634687bc0d566eabf69f))
- Rewrap docs prettier wraps differently ([b691378](https://github.com/GMOD/bandage-core/commit/b69137846b726f6a4c01c028ee5c1dc1316f7316))
- Draw a thread per pass where lifted walks repeat, and lighten their ramps ([ff8651f](https://github.com/GMOD/bandage-core/commit/ff8651f36c3eae0ad976e2d99a1ee56af76c172c))
- Widen the gap between walks' thread slots to 4 px ([4929789](https://github.com/GMOD/bandage-core/commit/4929789a3084a4a4a9ae7574078b9c55abf4ef6d))
- Keep each copy on its own thread, and narrow the band where walks thin out ([accfa33](https://github.com/GMOD/bandage-core/commit/accfa33fa3d25835176d90fe346401490b8c9995))
- Test that figureData states where a lane's link ends ([80c7929](https://github.com/GMOD/bandage-core/commit/80c79294678160b7f1236e89974f8c8701860420))
- Skip lane lines unless a walk repeats, cap the thread band, and centre easing threads ([ee30c8b](https://github.com/GMOD/bandage-core/commit/ee30c8b52bd1f9549698938d2d7abc5a1e4f82cc))
- Draw lifted walks' threads in time proportional to what they draw ([65218ad](https://github.com/GMOD/bandage-core/commit/65218ad857dba4c2a66c17515f8421f7217edbfb))
- Bound the lift bench to five runs, which a 20-walk build takes a second each ([a28924f](https://github.com/GMOD/bandage-core/commit/a28924ffaaa9e5c9f42471e07007986f68ec1ad1))
- Key each lifted walk with the field its colours run over ([1aacd82](https://github.com/GMOD/bandage-core/commit/1aacd82834eb29f33598481757515a73c9080354))
- Cut only the curls a band's inner thread cannot follow ([4f69312](https://github.com/GMOD/bandage-core/commit/4f6931220bc883de78cfee8a6df139e9bc83d8f5))
- Lane walks that never repeat along the walk's smoothed normals ([966c5cc](https://github.com/GMOD/bandage-core/commit/966c5cc2279b8c00bfa7024a0d9b564200ead007))
- Shade flat lanes past the fourth walk deeper, then paler ([12d957a](https://github.com/GMOD/bandage-core/commit/12d957a68e4f05ac52de2291408c71fe921b53ee))
- Place threads from each node's slot centres, and cache lane normals and widths ([dcc3df7](https://github.com/GMOD/bandage-core/commit/dcc3df71e39af8c961015027902c3875681d0e6b))
- Wrap a figure's key onto more lines where it would run past the edge ([d2f2310](https://github.com/GMOD/bandage-core/commit/d2f2310b6b48d5365c165ef75d4c44e3fa5d8c29))
- Turn a lane run no earlier run overlaps by its nodes' own direction ([a2b03e3](https://github.com/GMOD/bandage-core/commit/a2b03e33fd5b6c23eb82161bd959dfffa87b718b))
- Wrap a walk-rows figure's key entry by entry ([1166fa8](https://github.com/GMOD/bandage-core/commit/1166fa869e73cf5a02af825646a7613ce073d5ed))
- Label walks by sample#haplotype before reaching for an offset ([326986c](https://github.com/GMOD/bandage-core/commit/326986c70faa207ea116911b2d9a9c91d45ce4f2))
- Widen walk-row labels to sample#haplotype where two would match ([0ba03af](https://github.com/GMOD/bandage-core/commit/0ba03afd9bd6b505288e12b0d230a165bbe50fff))

## [11.7.3](https://github.com/GMOD/bandage-core/compare/v11.7.2...v11.7.3) (2026-10-21)

### Other Changes

- Group the API by task and name each input format ([76854b7](https://github.com/GMOD/bandage-core/commit/76854b73688c38dcf930884d62d18c38f6f789f8))
- Retitle for bandage-fold, fix the gfa-to-tabix fold link and parity script path ([55bb916](https://github.com/GMOD/bandage-core/commit/55bb91684627eda4ebc29b0273fe30c19ccf1244))
- Copy figure spec is the plugin's; say how to draw a walk-file cut ([b26210b](https://github.com/GMOD/bandage-core/commit/b26210bea6917c672f61e1ab4ecf5ff814180b4e))
- Layout-lab README: count haplotypes instead of carriage ([00b08f9](https://github.com/GMOD/bandage-core/commit/00b08f9151a2956c4b9450a59f14d38c3e07575d))
- Bridge a folded cut only when the caller says it is a cut ([8fa52c8](https://github.com/GMOD/bandage-core/commit/8fa52c8f246b0faea86e6daf6916df71173e40de))

## [11.7.2](https://github.com/GMOD/bandage-core/compare/v11.7.1...v11.7.2) (2026-10-21)

### Other Changes

- Orient a force layout to every drawn point of the reference ([9c46a40](https://github.com/GMOD/bandage-core/commit/9c46a402fedceaccddbd9edd7e07b7f114537e4e))
- Keep the one small skip that holds a folded cut together ([aaead1a](https://github.com/GMOD/bandage-core/commit/aaead1a9292cff15c4f7e36a1be04494ab3b6abd))

## [11.7.1](https://github.com/GMOD/bandage-core/compare/v11.7.0...v11.7.1) (2026-10-21)

### Other Changes

- Measure a deletion across a window edge on the uncut segments ([786a6b0](https://github.com/GMOD/bandage-core/commit/786a6b03105a515e65e719534fab9c89ce56ccd1))

## [11.7.0](https://github.com/GMOD/bandage-core/compare/v11.6.1...v11.7.0) (2026-10-20)

### Other Changes

- Draw an abridged walk's left-out steps as their own gap cause ([ec1f487](https://github.com/GMOD/bandage-core/commit/ec1f487fb7c79eea75aa0a304cf110e6d7539cc2))

## [11.6.1](https://github.com/GMOD/bandage-core/compare/v11.6.0...v11.6.1) (2026-10-20)

### Other Changes

- Publish recordingCanvas again, which the plugin's tests import ([b1d4580](https://github.com/GMOD/bandage-core/commit/b1d458082f6e16628acd957135178e452ab1975c))

## [11.6.0](https://github.com/GMOD/bandage-core/compare/v11.5.0...v11.6.0) (2026-10-20)

### Other Changes

- Fix dash length in row layouts, colon contigs, CRLF GAF, 1000 kb, BED headers ([5c6073d](https://github.com/GMOD/bandage-core/commit/5c6073d576cdd642398aeef66487ac62f5ca984e))
- Check Range responses, skip unneeded work, and tidy build and engine code ([55e1e90](https://github.com/GMOD/bandage-core/commit/55e1e904fd46a62115473f6301342e4fb6066b65))
- Group strokes once per highlight change, not per frame, and drop the transparent background fill ([cf3322d](https://github.com/GMOD/bandage-core/commit/cf3322db979c3aee9b7d5e6cfa50534ad21efe9d))
- Lift every piece of a cut walk, and trim hot loops in layout ([bd3bf7b](https://github.com/GMOD/bandage-core/commit/bd3bf7b731122c8141997c5b13cb291a02fdb9c9))
- Convert a walk scheme's ends to OKLab once ([15dcc0c](https://github.com/GMOD/bandage-core/commit/15dcc0c1cbbd44169d73b77066b4df1ecd7222a7))
- Write a walk's range 1-based and closed, as formatLocus does ([2266607](https://github.com/GMOD/bandage-core/commit/226660774f8dc79a1b4d01aabe3c1dac6645f076))
- Let nodeInk reach as far as a node's lifted-walk lanes ([abbd9fc](https://github.com/GMOD/bandage-core/commit/abbd9fc1ffbd30a2600dd855f29be59f7e0e0d82))
- Leave out deletion dashes that lie clear of the view ([1235dd2](https://github.com/GMOD/bandage-core/commit/1235dd23874a68fb4994374e6213f91ec33697f1))
- Follow each copy of a collapsed repeat to the reference copy it continues ([69967bf](https://github.com/GMOD/bandage-core/commit/69967bfe7bf18883e2e429d34524e555f28860b9))
- State the position ramp's domain and the deletions drawn in figureData's meta ([e2bd03f](https://github.com/GMOD/bandage-core/commit/e2bd03fc0f9d180810add2f7fc39d39cbd23b00b))
- Read a link between copies of a collapsed repeat as a copy switch ([262bdce](https://github.com/GMOD/bandage-core/commit/262bdce67881cb593b1309674648c35476023b56))

## [11.5.0](https://github.com/GMOD/bandage-core/compare/v11.4.0...v11.5.0) (2026-10-18)

### Other Changes

- Share the ramp's backbone-only rule between nodes and lanes as rampFraction ([6581e61](https://github.com/GMOD/bandage-core/commit/6581e61203155fe3bdb01349052e7bfe884ad3b7))
- Win back the walk-row time 11.3.0 lost, and bench it ([61217b9](https://github.com/GMOD/bandage-core/commit/61217b9dd4b878bff6ce1721ab877c1cc15e39f1))
- Read a typed locus with parseLocus, and say that a spec's region is 0-based ([548d788](https://github.com/GMOD/bandage-core/commit/548d78865f91eec8a49c4fa9f994ff3ed67f1317))

## [11.4.0](https://github.com/GMOD/bandage-core/compare/v11.3.0...v11.4.0) (2026-10-18)

### Other Changes

- Paint every node off the backbone charcoal under the reference ramp ([617220b](https://github.com/GMOD/bandage-core/commit/617220bdd6c6a7590c71c96b777ea0f46c9bf1ab))

## [11.3.0](https://github.com/GMOD/bandage-core/compare/v11.2.0...v11.3.0) (2026-10-18)

### Other Changes

- Publish to npm only once CI, consumers included, passes on the tag ([ce41c40](https://github.com/GMOD/bandage-core/commit/ce41c4011ec79762774288305f00440948584665))
- Build walk rows from a cut's tables in core, as columns, with walkRowRuns ([57e222b](https://github.com/GMOD/bandage-core/commit/57e222b3ccf3eba6e066bdade3a1ae415be3f17c))
- Join walk rows with ribbons and letter shared blocks, from ggbandage ([4f65603](https://github.com/GMOD/bandage-core/commit/4f65603d01ee2c096a775acb77f331718b1e0c9d))

## [11.2.0](https://github.com/GMOD/bandage-core/compare/v11.1.0...v11.2.0) (2026-10-17)

### Other Changes

- Build walk-row visits only when a host asks for them ([dd96a11](https://github.com/GMOD/bandage-core/commit/dd96a11e3c41008b8e03b85c4487abb953e1cd02))

## [11.1.0](https://github.com/GMOD/bandage-core/compare/v11.0.0...v11.1.0) (2026-10-17)

### Other Changes

- Give each walk row its visits: every node its bar steps through, at its bp offset ([2b6c74a](https://github.com/GMOD/bandage-core/commit/2b6c74a582e73402c0bfc9e7557c1a4528ec1cd1))
- Return walk keys, gene pins and exon polylines from figureData ([1a51cf8](https://github.com/GMOD/bandage-core/commit/1a51cf872be234cd2c86aa6276c6ddc1fb0718ba))
- Read a gene file onto a graph's backbone with backboneGenes, for any host ([cedf2f5](https://github.com/GMOD/bandage-core/commit/cedf2f5e409af749a2ef50a5c2fe3be4205e4338))

## [11.0.0](https://github.com/GMOD/bandage-core/compare/v10.3.1...v11.0.0) (2026-10-16)

### Other Changes

- Keep walk-file stops through GFA, and say why each walk-row gap is empty ([4b2f65c](https://github.com/GMOD/bandage-core/commit/4b2f65c6964c04a6aee36f9a40904b898bbfc5f7))
- Name a chunk under 1 Mb in kb ([4b50bff](https://github.com/GMOD/bandage-core/commit/4b50bffb8052dd00b4655ac24198fc84d95a6cbe))
- Split each walk-row gap into parts by the stops either side ([827c8ab](https://github.com/GMOD/bandage-core/commit/827c8abca0dfa1cc271cabfc05f62933c1fdda48))
- Draw a gap the graph lacks as a hairline ([ede0dfe](https://github.com/GMOD/bandage-core/commit/ede0dfe62e6b637cdaaf4632248f533403d17d6a))
- Let a tree drawn over canvas bars keep its rows' runs ([6ffcc42](https://github.com/GMOD/bandage-core/commit/6ffcc4239f2e83b9b430503e1243152e936a9a2c))

## [10.3.1](https://github.com/GMOD/bandage-core/compare/v10.3.0...v10.3.1) (2026-10-15)

### Other Changes

- Name a tagged graph's reference path where its SN tags name one of its walks ([b220432](https://github.com/GMOD/bandage-core/commit/b22043220e1678fd461ad78a5070fb2fbd708520))

## [10.3.0](https://github.com/GMOD/bandage-core/compare/v10.2.7...v10.3.0) (2026-10-15)

### Other Changes

- Move to @jbrowse/tubemap-core 2.0.0 ([2972f1a](https://github.com/GMOD/bandage-core/commit/2972f1a6077a8f196cb485da81d663803378abb5))
- Find the reference walk one way in walk rows, the strip and the tube map ([49f3fcc](https://github.com/GMOD/bandage-core/commit/49f3fccdb6ef1f964e8be8bad8ddbe8075a67e03))
- Gather a walk's range-suffixed pieces into one row ([d0f5bb8](https://github.com/GMOD/bandage-core/commit/d0f5bb8fe6f49b178e575d7772b635be4504d37b))
- Leave a drawing alone when every backbone node is 0 bp ([933aade](https://github.com/GMOD/bandage-core/commit/933aade0284895d2324872fb1f8e936c73c38688))
- Build engineKey and engineRequest from engineSettingsOf ([ab28e4d](https://github.com/GMOD/bandage-core/commit/ab28e4d1fb4730d9ac282360cc4f9bb1d4d4a897))
- Unexport helpers only their own module uses ([5af4e1b](https://github.com/GMOD/bandage-core/commit/5af4e1b537ee11b456c561a1edeb58e9fd0a2bc7))
- Rename the tube map's MergedRuns to BoxRuns ([2443ea3](https://github.com/GMOD/bandage-core/commit/2443ea3b764a255dcad666f839d3e73d8661ebfd))
- Share rowSpan and longestBar between the strip and walk rows ([f17bc1c](https://github.com/GMOD/bandage-core/commit/f17bc1c50a7438a4cca79a4ab6a35b68866e61a9))
- Take orderKeys' adjacency from buildNeighbors ([9798e38](https://github.com/GMOD/bandage-core/commit/9798e38acdea67418bb22a0607e628a78d99e62e))
- Write SVG opacity to three decimals ([092f972](https://github.com/GMOD/bandage-core/commit/092f972b355aa065e5715d8db93b1c30ac37de65))
- Give a one-point polyline a zero normal rather than throwing ([99660c4](https://github.com/GMOD/bandage-core/commit/99660c44dce3a59ac2c6a76f7c50105ac9728659))
- Apply the canvas fit at render time rather than in updateTransform ([7690844](https://github.com/GMOD/bandage-core/commit/76908447243f942c788550c1f5619ecd56865089))
- Share one weakMemo for the five caches keyed on node positions ([6ebbc9b](https://github.com/GMOD/bandage-core/commit/6ebbc9bd512812a3f1d02a2d2fe55d2c2c3bdfe6))
- Measure a node's on-screen length with one polylinePx ([57ab26e](https://github.com/GMOD/bandage-core/commit/57ab26ebec741140fe833f2ed7ccc52a8d14834d))
- Keep the reference ramp's colour in referenceRampCss ([ae32712](https://github.com/GMOD/bandage-core/commit/ae32712f1b60fafac630f07e23786f5d879e26ee))
- Place layoutLabels' size labels through graphLabels ([d487234](https://github.com/GMOD/bandage-core/commit/d4872349b2016ffded675c07279f0e1462074233))
- Drop EdgeSpatialIndex's cellSize parameter, which no caller set ([539712b](https://github.com/GMOD/bandage-core/commit/539712b6aad20e14a59d5cbd231d389ea7e1af75))
- Size rowLabelBox with labelWidth ([dab9b21](https://github.com/GMOD/bandage-core/commit/dab9b2146908e1be21db1188897e361ba953b08c))
- Compute buildGeometry's worldPerScreenPx once ([be6d0c6](https://github.com/GMOD/bandage-core/commit/be6d0c60637f70e736660e75f34f02ec96f146c1))
- Pass distanceToCubicBezier the curve rather than ten numbers ([eadce13](https://github.com/GMOD/bandage-core/commit/eadce132d7ccfe4e85fad9e8e79bc99d2a985e6d))
- Orient a merged allele run by the side its link leaves from ([0d80d86](https://github.com/GMOD/bandage-core/commit/0d80d86f44fec35958e057d00b59c94b9938e4de))
- Mirror a mismatch on a mixed-strand read's reverse visit ([dd1af56](https://github.com/GMOD/bandage-core/commit/dd1af56a35b03d359873933cf7a259a33335ee01))
- Drop soft clips where reads.ts knows the alignment's ends ([bdea32a](https://github.com/GMOD/bandage-core/commit/bdea32ab6c8d498313cb04d11cee6e386d92cfa7))
- Mark the variants of every walk a bundled tube stands for ([75f1d42](https://github.com/GMOD/bandage-core/commit/75f1d42fedf76063ff30ee3eec371d1bad10fedf))
- Share boxX and lastAtMost within tubeMap ([e8bda02](https://github.com/GMOD/bandage-core/commit/e8bda022c16e5826667bdd0d6a46b9bb8670e7fc))
- Share route choice and the bubble record between the two bubble finders ([0b98b8a](https://github.com/GMOD/bandage-core/commit/0b98b8affef604c3b436a69653b5afa09afaadbb))
- Group a graph's paths by walk once in bundleRoutes ([86e5482](https://github.com/GMOD/bandage-core/commit/86e5482c685dfa867bc57b104060636ae8d86a9a))
- Inline deletionArcCurves at its one caller ([610dcf9](https://github.com/GMOD/bandage-core/commit/610dcf9ed3e41a81f152229adfc32325f51cb04e))
- Drop exports nothing outside their own file uses ([d83e075](https://github.com/GMOD/bandage-core/commit/d83e075e5e6806da2859067a07d6cf29e9e8afc7))
- Pool a bundled tube's variants per walk rather than per piece ([05fa30a](https://github.com/GMOD/bandage-core/commit/05fa30af3469ad2175912158127830e89291bc9f))
- Cut a gbz against the reference sample the caller names ([69fb9e3](https://github.com/GMOD/bandage-core/commit/69fb9e3e518b97c0e450ebb7e7b7b4ae999a8682))
- Measure a twice-declared segment along paths by its first S line ([0cd7aef](https://github.com/GMOD/bandage-core/commit/0cd7aef3fb4915032c53a2ac336da6a54371040c))
- Split each P body once in convertGFAToGraph; type a walk step's strand ([7751034](https://github.com/GMOD/bandage-core/commit/775103413329a210244b92f9ffc978957394f196))
- Name a two-part tables walk as its P line does ([8413a8e](https://github.com/GMOD/bandage-core/commit/8413a8e9cb152763b803bd71d30a2735c0733212))
- Keep a figure spec's gbz index when its db is hprc ([6ecc5bd](https://github.com/GMOD/bandage-core/commit/6ecc5bdc1746dd1d6a2b74284e37d3012889e315))
- Count a `*` segment with no LN as 0 bp when joining gbz cuts ([c8364e2](https://github.com/GMOD/bandage-core/commit/c8364e203ab163244d823a5284f045c03681d89f))
- Build a lift's node and edge maps once ([12516d3](https://github.com/GMOD/bandage-core/commit/12516d374dc08224eec973178e2ed2e3ecccb017))
- Place facet panels and write walk key notes in figureScene ([3748828](https://github.com/GMOD/bandage-core/commit/3748828a714023c69c5fa64aa9261480fce3c820))
- Grow gfaTables' step columns with pathVisits' Column ([027f91d](https://github.com/GMOD/bandage-core/commit/027f91da9a82d865c5c56972fe0a7613d6510483))
- Split PanSN names in pansn.ts alone ([9545c09](https://github.com/GMOD/bandage-core/commit/9545c09088758fca1efee8403ccd779dd2c6d7ca))
- Share pushTo and groupBy for the hand-rolled Map-of-arrays groupings ([21bf2fb](https://github.com/GMOD/bandage-core/commit/21bf2fbdd0a50f90ef59468ce73b7a9c57083a94))
- Share one partitionPoint for the hand-rolled binary searches ([2e3af5e](https://github.com/GMOD/bandage-core/commit/2e3af5e0234855a2928ff58699236a0732c3b920))
- Push one value at a time in pushTo ([01374eb](https://github.com/GMOD/bandage-core/commit/01374ebeccbe56d402610bd7bf240c44d91ceba9))

## [10.2.7](https://github.com/GMOD/bandage-core/compare/v10.2.6...v10.2.7) (2026-10-14)

### Other Changes

- Keep a two-part walk name in graphFromTables and write it as a P line ([2fe678b](https://github.com/GMOD/bandage-core/commit/2fe678b750213cf11f9d0df9261a9fe10aa9f1df))

## [10.2.6](https://github.com/GMOD/bandage-core/compare/v10.2.5...v10.2.6) (2026-10-14)

### Other Changes

- Find a graph's reference walk in walkRows from its tags, and in every piece ([727d544](https://github.com/GMOD/bandage-core/commit/727d54438e3f388751325edf2b793c45f9a77a4e))

## [10.2.5](https://github.com/GMOD/bandage-core/compare/v10.2.4...v10.2.5) (2026-10-14)

### Other Changes

- Force mode description names both engines ([6f01301](https://github.com/GMOD/bandage-core/commit/6f01301f8748fe18685094fa57979e628971d5ba))
- Walk rows and ordered descriptions match what the code checks ([bbfbe98](https://github.com/GMOD/bandage-core/commit/bbfbe98296a3230f59e2438b8046eed68c181ec1))

## [10.2.4](https://github.com/GMOD/bandage-core/compare/v10.2.3...v10.2.4) (2026-10-12)

### Other Changes

- Link graph-fmmm-layout; drop the .gitattributes entry for the moved artifact ([2371ddb](https://github.com/GMOD/bandage-core/commit/2371ddb2b2e0be4cd0a6017f4711c7a557927a38))
- Drop route chips from bubble halos ([ecf3df4](https://github.com/GMOD/bandage-core/commit/ecf3df4d947fc1b21a73249a65474fbb2c252459))

## [10.2.3](https://github.com/GMOD/bandage-core/compare/v10.2.2...v10.2.3) (2026-10-12)

### Other Changes

- Keep a replacing force layout when the run it evicted fails late ([284c64d](https://github.com/GMOD/bandage-core/commit/284c64dbce66f57469780f53e6268bd9be66a2ad))
- Fit the transform to a backing store capped at MAX_CANVAS_DIM_PX ([c40ad2e](https://github.com/GMOD/bandage-core/commit/c40ad2e72fcbc530988d08e0f015b5f63b45fb11))
- Label no deletion arc whose apex is off screen ([154cd8d](https://github.com/GMOD/bandage-core/commit/154cd8d5504820f18c949a32ef39cacc99b41683))
- One formatBp for bubble chips and graph labels ([36c55f5](https://github.com/GMOD/bandage-core/commit/36c55f5ac4fe5ddcd683d492a961cb32cf0d0f5f))
- Measure a cut reference over its gaps, as a walk is ([74b707b](https://github.com/GMOD/bandage-core/commit/74b707b55f4d59fa5f0ec7ea4cd0ae25588ecb07))
- Fan path ribbons in screen px rather than world units ([2c22c11](https://github.com/GMOD/bandage-core/commit/2c22c119369a31b84c7001aea6db791e900265e0))
- Dash a lifted walk's deletions and give its links their heads ([27d53c4](https://github.com/GMOD/bandage-core/commit/27d53c4e18b8ce31b314d25070b548a6c953a04c))
- Drop code nothing reads ([785a528](https://github.com/GMOD/bandage-core/commit/785a528a7f0d1173e4afc0b8b88bfd42f16e8096))
- Remove dead code from the native layout engine ([568be90](https://github.com/GMOD/bandage-core/commit/568be90a8eb2e1be1d8738edd2fe75eefd8e042f))
- Smoke-test the engine with one node per segment ([d26d3cb](https://github.com/GMOD/bandage-core/commit/d26d3cb199b48e9a43d2ade0145a4e758277bbb1))
- Find a strip point past the first fragment of an odgi reference ([e719249](https://github.com/GMOD/bandage-core/commit/e719249fed5e42d8fd8d362fd43f087ee450df2d))
- Pin a gene on a 0 bp node at its start rather than NaN ([ef32785](https://github.com/GMOD/bandage-core/commit/ef3278560d0a2101b81381f5627a4572d2178514))
- Read a GFA record's type from its first field, and a segment once ([49390a6](https://github.com/GMOD/bandage-core/commit/49390a670ceb5eb62457d9ed2dcbd9388c83c2e7))
- Refuse a region that ends at or before its start ([48b3f2d](https://github.com/GMOD/bandage-core/commit/48b3f2d3c07f7c3124a3b2ffe6da539f91a1eb91))
- Drop computeEdgeCurves' offset, which every caller passed as 0 ([095f837](https://github.com/GMOD/bandage-core/commit/095f8372c4b275137bfd54a44aa0367ca1266d49))
- One derivation of an edge's drawn curve for the cache and the arcs ([e8cf60d](https://github.com/GMOD/bandage-core/commit/e8cf60db37e4827c8d7b6a24218f8f3c30f5d625))
- Share the route relaxation between the two bubble finders ([f37d9ea](https://github.com/GMOD/bandage-core/commit/f37d9ea53422b6c2c7338521326c3b423452cca2))
- Have forceLayout take its deletions from deletionDrawing ([0d3a51b](https://github.com/GMOD/bandage-core/commit/0d3a51be562d60b6a2a9199c44833f89ffab25af))
- Build walk row labels and readout room in one place each ([f46443d](https://github.com/GMOD/bandage-core/commit/f46443dfb964c451d2b9601489fe57ef6dc611b9))
- Lay out and report nodes in input order; sort numeric names first ([dfdfbbe](https://github.com/GMOD/bandage-core/commit/dfdfbbe496c35bfdeefb4c794d0c91fd80a6c954))
- Read an unindexed genes file in the spec's format ([63d9113](https://github.com/GMOD/bandage-core/commit/63d911324bdd5ddcb3de39e20a1e2fe1350bd55d))
- List --reference in bandage-fold's usage ([cf9cb89](https://github.com/GMOD/bandage-core/commit/cf9cb8911617a44eae356a9a074e4a88b6e44420))
- Share figure scene setup between figureSvg and figureData ([b2c6629](https://github.com/GMOD/bandage-core/commit/b2c6629958b87aa3aa60234cf61290b62666ca3e))
- Escape figure markup with el's escapeAttr ([7eed548](https://github.com/GMOD/bandage-core/commit/7eed548ca178b6d7d56c5e5cc3f057ed1d2fd53e))
- Share the CLIs' gzip-sniffing text decoder ([5a82ea8](https://github.com/GMOD/bandage-core/commit/5a82ea87e90a4f2a2d65964fb742fe15eac81569))
- Share spec loading and layout between bandage-figure and gfaFigureData ([1b45918](https://github.com/GMOD/bandage-core/commit/1b459182c2b705c103fba2dbb6aed62ba73e7907))
- Hit-test tube map shapes on flattenPath outlines built once per picture ([d0f8032](https://github.com/GMOD/bandage-core/commit/d0f80326fd59f8c44cb84eead4e51fa63273e078))
- Take the FMMM engine from @jbrowse/graph-fmmm-layout ([3623e42](https://github.com/GMOD/bandage-core/commit/3623e42cdd5bc9d3c0bbbb993956b45cf64fd683))
- Depend on published @jbrowse/graph-fmmm-layout 1.0.2 ([84ead73](https://github.com/GMOD/bandage-core/commit/84ead73c68bf8d3bcd4e744503d5926ceb029875))
- Drop the wasm smoke job; graph-fmmm-layout runs it ([769ac62](https://github.com/GMOD/bandage-core/commit/769ac628058a0f2ec516059b147342692093481f))
- Restore StripBlock.faded and Canvas2DRenderer.setErrorHandler ([1ddc749](https://github.com/GMOD/bandage-core/commit/1ddc7494fdb57642c7a9516169c4cb0dc5c0e534))

## [10.2.2](https://github.com/GMOD/bandage-core/compare/v10.2.1...v10.2.2) (2026-10-12)

### Other Changes

- Walk rows key: 'gene', like the graph's 'exon' ([ee3ccda](https://github.com/GMOD/bandage-core/commit/ee3ccda807f8d587bc011c785fdc8812f3e33222))
- Require @jbrowse/tubemap-core 1.1.0 ([6c13827](https://github.com/GMOD/bandage-core/commit/6c13827a7d0a842613f3870b9bbf27bf6ffa4929))

## [10.2.1](https://github.com/GMOD/bandage-core/compare/v10.2.0...v10.2.1) (2026-10-11)

### Other Changes

- Test the seed on a graph with no reference ([fd03564](https://github.com/GMOD/bandage-core/commit/fd0356459779109a770e79671442e441d2c96abd))
- CI pins the gfa-to-tabix 0.12.0 release ([7c50a7e](https://github.com/GMOD/bandage-core/commit/7c50a7e053bbe94cde9dbccacf4d8108a407bd13))
- 1.0.0 releases ([ab0d041](https://github.com/GMOD/bandage-core/commit/ab0d041cd89647291dabc3056282eb9b8cf026bc))

## [10.2.0](https://github.com/GMOD/bandage-core/compare/v10.1.0...v10.2.0) (2026-10-11)

### Other Changes

- Describe the stress engine as placement first; single-level FMMM is tested ([1627d90](https://github.com/GMOD/bandage-core/commit/1627d90ce8287f84322ad108972a1e7029898d77))
- FoldVariants sizes a link by the reference positions it touches ([29f6893](https://github.com/GMOD/bandage-core/commit/29f6893f61a86e94b144b0fa6344312f262b390f))
- FoldVariants reads continuations one way, sizes alleles by the sides they land on, and flips reversed segments ([895450a](https://github.com/GMOD/bandage-core/commit/895450aac4e3bcc89a3ab6f51d96ab78cf166b3d))
- Fold tests: random inversions, back links, self-links and far-side alleles, fold-of-fold, path GFA goldens ([17add97](https://github.com/GMOD/bandage-core/commit/17add970fa8a71823f34804fac3ace0eefb5a1a0))
- Fold docs say fold-of-fold matches closely; publish runs the fold and parity tests ([a7d06ee](https://github.com/GMOD/bandage-core/commit/a7d06ee08d9a15d99beca8d77521dd86665e3944))
- Drop a debugging log from the fold-of-fold test ([d5ccc0c](https://github.com/GMOD/bandage-core/commit/d5ccc0c82c2d0a39d49b73ec48b4d108249714e6))
- CI builds gfa-to-tabix from the commit with the matching fold until it is released ([39464c7](https://github.com/GMOD/bandage-core/commit/39464c7a9288b886da1e8ab195f394ddbfc5ddde))
- Format the gfa-to-tabix action ([b38e430](https://github.com/GMOD/bandage-core/commit/b38e430bc82372f1dbf4378697af75344ecd2514))

## [10.1.0](https://github.com/GMOD/bandage-core/compare/v10.0.1...v10.1.0) (2026-10-11)

### Documentation

- The coarse tier, from jbrowse-components' build_fold_tier.sh ([8674d41](https://github.com/GMOD/bandage-core/commit/8674d4122301748ac96fb924a4d2b1ab96d1d197))
- Format the coarse tier page ([c0aa3da](https://github.com/GMOD/bandage-core/commit/c0aa3da2ec13a69b1432fcbbeb9cb29beeb2a4a6))
- Coarse tier via gfa-to-tabix fold ([76ab5e6](https://github.com/GMOD/bandage-core/commit/76ab5e6dd66b08e7b29380c82346fad4491148ca))

### Other Changes

- Walk row readouts state a sub-kilobase change in bp ([43a5d80](https://github.com/GMOD/bandage-core/commit/43a5d804267b0de881807a8b95525bdb59415adb))
- Read vg's fragment[subrange] path names as positions ([5a97d73](https://github.com/GMOD/bandage-core/commit/5a97d734d37a36ed14e82906cd6e45b8f631c351))
- Hold foldVariants to a pinned gfa-to-tabix fold in CI ([baec56a](https://github.com/GMOD/bandage-core/commit/baec56abee22c6e22602b80f8d6b5dad2b79a635))
- FoldVariants breaks ties on the segment name, not its drawn id ([9bf0eae](https://github.com/GMOD/bandage-core/commit/9bf0eae5ce92f84796a130da7420a9216634ec8f))

## [10.0.1](https://github.com/GMOD/bandage-core/compare/v10.0.0...v10.0.1) (2026-10-10)

### Other Changes

- The stress engine comes from @jbrowse/graph-stress-layout ([0157cd9](https://github.com/GMOD/bandage-core/commit/0157cd9ce81a584409a6167a0969bcee66a561be))
- README's see-also lists the graph repos and pangenome tutorials ([0a7e4b3](https://github.com/GMOD/bandage-core/commit/0a7e4b35cc277a13157d17791c3763fd3c60c5a7))
- See also links only where the other repo links back ([edeea45](https://github.com/GMOD/bandage-core/commit/edeea45f73d3d0fb7dbf81e8e0f0629413260c16))
- WalkRows reads nodes by index, not by id ([fccc151](https://github.com/GMOD/bandage-core/commit/fccc151924a85558e4c79da9a64c19d02cba3f7d))

## [10.0.0](https://github.com/GMOD/bandage-core/compare/v9.10.0...v10.0.0) (2026-10-10)

### Other Changes

- Path visits as columns, not an object per step ([d46fa14](https://github.com/GMOD/bandage-core/commit/d46fa147d7a08949f4ae217a5f744d20d74b71be))
- A gbz-base cut as tables, with no GFA written or read ([8c5b271](https://github.com/GMOD/bandage-core/commit/8c5b271fd54d12a08028f33f320b6d3a4c34b1be))
- CompactTables indexes a cut's dense node ids by table, not a map ([64e43fc](https://github.com/GMOD/bandage-core/commit/64e43fcfc8bf353b64652ca7e33bcf6d333deaf6))
- GbzWindow imports the graph tables extensionless, as build.mjs resolves ([2b91fd9](https://github.com/GMOD/bandage-core/commit/2b91fd9d56662734daff84940fb8c2bd900a082c))

## [9.10.0](https://github.com/GMOD/bandage-core/compare/v9.9.2...v9.10.0) (2026-10-10)

### Other Changes

- A force-laid node bends as a curve through the points its engine placed ([11d9ba6](https://github.com/GMOD/bandage-core/commit/11d9ba64e642fc38ca96c27765a13cefbe3bb174))
- A figure as tables, for another graphics system to draw ([d42495d](https://github.com/GMOD/bandage-core/commit/d42495d2ce44e7835ac85100a0d9d45f9fedc7a5))

## [9.9.2](https://github.com/GMOD/bandage-core/compare/v9.9.1...v9.9.2) (2026-10-10)

### Other Changes

- A lane change names its tube on hover, and steep curves keep their width on the reference axis ([eddbc06](https://github.com/GMOD/bandage-core/commit/eddbc06b0cd6f388d3f56cf1ba9c35688a164aa8))

## [9.9.1](https://github.com/GMOD/bandage-core/compare/v9.9.0...v9.9.1) (2026-10-10)

### Other Changes

- Take @jbrowse/tubemap-core 0.2.3, for steep curves that keep their width ([6e5f8e7](https://github.com/GMOD/bandage-core/commit/6e5f8e7eab04b8077c27af853dde198d53706e06))

## [9.9.0](https://github.com/GMOD/bandage-core/compare/v9.8.1...v9.9.0) (2026-10-10)

### Other Changes

- Anchoring sorts the graph's samples once, not each node's ([cd860dd](https://github.com/GMOD/bandage-core/commit/cd860dd674951b42d793e27b17ef5e73886085ed))
- GFA text of S, L and W lines loads through the graph tables ([6954a70](https://github.com/GMOD/bandage-core/commit/6954a70acb270b50ea5c11b3b3d8966b3d13a513))

## [9.8.1](https://github.com/GMOD/bandage-core/compare/v9.8.0...v9.8.1) (2026-10-10)

### Other Changes

- Reference axis: a run of thin columns slides apart, so its lane changes keep their width ([9bfc4d3](https://github.com/GMOD/bandage-core/commit/9bfc4d3ff4790a9a1cfc55f97acdafade978812e))
- The reference fills over every tube that crosses it ([15bf3ec](https://github.com/GMOD/bandage-core/commit/15bf3ec6326f887a8a0fcc6c45447449b9a7089d))

## [9.8.0](https://github.com/GMOD/bandage-core/compare/v9.7.0...v9.8.0) (2026-10-10)

### Other Changes

- A highlight with no walks is a focus: its nodes and links keep their own colours ([0e5258e](https://github.com/GMOD/bandage-core/commit/0e5258e9daf9a83534ece95fb120807258eeb32f))

## [9.7.0](https://github.com/GMOD/bandage-core/compare/v9.6.0...v9.7.0) (2026-10-10)

### Other Changes

- Walks taking one route draw as one tube, as wide as their count ([3e9714f](https://github.com/GMOD/bandage-core/commit/3e9714fd1aa598800ecdacf6524ef6bb9f62bee8))
- BundleRoutes splits a route by a group of its walks, strands side by side ([cb0fcfd](https://github.com/GMOD/bandage-core/commit/cb0fcfd3d79695a2b2a27aafebb2b5e88241d0b0))
- BundleRoutes with merge false orders the walks route by route, a tube each ([656b8a6](https://github.com/GMOD/bandage-core/commit/656b8a6e0cc468fb75deb22ae373d30c772bfc5c))
- Take @jbrowse/tubemap-core 0.2.2, for freqWidth ([12b7f9c](https://github.com/GMOD/bandage-core/commit/12b7f9c98d909798809a61f3eeb0668170b3a4f7))

## [9.6.0](https://github.com/GMOD/bandage-core/compare/v9.5.0...v9.6.0) (2026-10-10)

### Other Changes

- Bubbles read each walk once, and a drag reuses each route's chip stretch ([9244664](https://github.com/GMOD/bandage-core/commit/9244664ab8e088a3751e9186ffa3ce35b1950e64))

## [9.5.0](https://github.com/GMOD/bandage-core/compare/v9.4.0...v9.5.0) (2026-10-10)

### Other Changes

- Stress walks on a referenced component stop at 20 links, and the engine drops its experimental label ([dd0b740](https://github.com/GMOD/bandage-core/commit/dd0b7404c4cf4e0463d58f0d2c539ac97bc5dbf3))
- Layout lab measures how far each engine's drawing moves between zoom steps ([06aa179](https://github.com/GMOD/bandage-core/commit/06aa179ef2fd8e569f9c798df58e4105623ee5af))

## [9.4.0](https://github.com/GMOD/bandage-core/compare/v9.3.0...v9.4.0) (2026-10-10)

### Other Changes

- Bubble names stack and shorten, and the bubble the drawing is keeps its name ([f62f8c7](https://github.com/GMOD/bandage-core/commit/f62f8c7fd4f5b944740e72fc0068a6bf49f078c2))

## [9.3.0](https://github.com/GMOD/bandage-core/compare/v9.2.0...v9.3.0) (2026-10-10)

### Other Changes

- Small variants stand as ticks, and every outermost superbubble is kept ([3baa06e](https://github.com/GMOD/bandage-core/commit/3baa06e7c08b75850095ebcbeabc46449ca26138))
- A partial bubble stays a halo, its lengths only a floor ([3014e63](https://github.com/GMOD/bandage-core/commit/3014e63203f51d4097bdb91bfcec4e56db39bf2a))

## [9.2.0](https://github.com/GMOD/bandage-core/compare/v9.1.0...v9.2.0) (2026-10-10)

### Other Changes

- Fold variants under a size into the reference, as a zoom's level of detail ([7321ed1](https://github.com/GMOD/bandage-core/commit/7321ed1e4b05d77c8d5d8b1812b9b2bd7e90206a))

## [9.1.0](https://github.com/GMOD/bandage-core/compare/v9.0.0...v9.1.0) (2026-10-10)

### Other Changes

- A bubble that is the whole drawing opens into the superbubbles inside it ([405af96](https://github.com/GMOD/bandage-core/commit/405af9607a61bba4284073fbca084219002f41bd))
- Say what the superbubble cap drops ([8d27716](https://github.com/GMOD/bandage-core/commit/8d27716f37fb33bd1a827fa33ef8c999b0ec502b))
- Highlights paint alone, for a hover layer over the drawing ([38d8c88](https://github.com/GMOD/bandage-core/commit/38d8c88a9167b9a1cafc1320c003c63169a01bdb))

## [9.0.0](https://github.com/GMOD/bandage-core/compare/v8.2.0...v9.0.0) (2026-10-10)

### Other Changes

- A read's mismatches sit on the pass that carries them when it loops ([e3d79fd](https://github.com/GMOD/bandage-core/commit/e3d79fdb857a9fea19c3fcb4cdbdebfbd914568b))
- One pathSteps reads each step's strand, shared across a walk's pieces ([fe5a794](https://github.com/GMOD/bandage-core/commit/fe5a79404f7c267e435e8b9df501bbed691bd14d))
- Place a read's cs edits in one pass, and keep a deletion's in-cut part ([c3d21c6](https://github.com/GMOD/bandage-core/commit/c3d21c6930b9ce3700ef24a02af0a53f2c4f8d1c))
- One referenceBoxes serves the ruler, the connectors and the deviation ticks ([42f1489](https://github.com/GMOD/bandage-core/commit/42f148934e3c06d20bee65216a3433375456200c))
- A tube map hands back the graph its boxes address ([a11fc7c](https://github.com/GMOD/bandage-core/commit/a11fc7c39a4e6dddc0547973f621a0146aaba722))
- Hit tests for a tube map's tubes and mismatch marks ([baf19f5](https://github.com/GMOD/bandage-core/commit/baf19f56ebe05ae755f48101a84d973e327f2de1))

## [8.2.0](https://github.com/GMOD/bandage-core/compare/v8.1.0...v8.2.0) (2026-10-09)

### Other Changes

- A walk reaching one flank is measured from it, and its readout says why it stops ([5fb753b](https://github.com/GMOD/bandage-core/commit/5fb753b6587a73a0bca8f572b3137b6a0673e76b))

## [8.1.0](https://github.com/GMOD/bandage-core/compare/v8.0.2...v8.1.0) (2026-10-09)

### Other Changes

- Build a graph from typed arrays as from its GFA text ([e9b979c](https://github.com/GMOD/bandage-core/commit/e9b979cfdfd9081baee4dfb5a8ed5bfd86f81d14))
- GraphFromTables sizes each segment's visits by its traversals ([cd65c39](https://github.com/GMOD/bandage-core/commit/cd65c3972caa34fbab789c5a868b62b7910971fd))

## [8.0.2](https://github.com/GMOD/bandage-core/compare/v8.0.1...v8.0.2) (2026-10-08)

### Other Changes

- Converting a GFA with walks builds no string per step ([0ffbfda](https://github.com/GMOD/bandage-core/commit/0ffbfda958daaf87bb46da3bdca46f6cbc41632d))

## [8.0.1](https://github.com/GMOD/bandage-core/compare/v8.0.0...v8.0.1) (2026-10-05)

### Other Changes

- LICENSE section ([3beee20](https://github.com/GMOD/bandage-core/commit/3beee203a42278143545f3cc139575a545ae4e0a))
- Highlights lighten toward white instead of scaling channels ([dae8d1f](https://github.com/GMOD/bandage-core/commit/dae8d1fb1fb0cc9b566091fdcb57bd413bc6ee37))

## [8.0.0](https://github.com/GMOD/bandage-core/compare/v7.5.1...v8.0.0) (2026-10-05)

### Other Changes

- Point the tube map lab at ~/src/sequenceTubeMapModern ([7213212](https://github.com/GMOD/bandage-core/commit/721321292cebc97d791cfd079a33f4c4a78d93b2))
- Depend on @jbrowse/tubemap-core 0.2.1 and color tube map shapes at draw time ([18741fb](https://github.com/GMOD/bandage-core/commit/18741fbdebadbc5aeb754583102099c196f93733))
- Test that tube map shapes take their track's colour by id ([8ca5280](https://github.com/GMOD/bandage-core/commit/8ca52808051262da136bf00d4e3070ced3231c45))

## [7.5.1](https://github.com/GMOD/bandage-core/compare/v7.5.0...v7.5.1) (2026-10-05)

### Other Changes

- One list of the fields a facet splits on, led by None ([448d4a7](https://github.com/GMOD/bandage-core/commit/448d4a742a21f52a04aefc9fa6200f62ed2c3c9e))

## [7.5.0](https://github.com/GMOD/bandage-core/compare/v7.4.0...v7.5.0) (2026-10-05)

### Other Changes

- One rule for when the walk-row strip shows, and one for the cut it needs ([c684278](https://github.com/GMOD/bandage-core/commit/c684278fad583deeb7959a19924bece0da16dddd))

## [7.4.0](https://github.com/GMOD/bandage-core/compare/v7.3.0...v7.4.0) (2026-10-05)

### Other Changes

- The facts both apps read off a layout, read in one place ([fa93941](https://github.com/GMOD/bandage-core/commit/fa939419435142397f0ead6bd42f14e881ec6342))

## [7.3.0](https://github.com/GMOD/bandage-core/compare/v7.2.1...v7.3.0) (2026-10-05)

### Other Changes

- One reading of the settings a figure is drawn from ([382133e](https://github.com/GMOD/bandage-core/commit/382133eafd47122c3a5585bdd901e404334f5968))
- The ordinal labelling keeps the tests it had in BandageJS ([adaab97](https://github.com/GMOD/bandage-core/commit/adaab970452263b44fef161af81016230f9b8844))

## [7.2.1](https://github.com/GMOD/bandage-core/compare/v7.2.0...v7.2.1) (2026-10-04)

### Other Changes

- A walk row tall enough for its label carries its readout too ([9a11da9](https://github.com/GMOD/bandage-core/commit/9a11da91af067fe8bba1526399cf3d7e226010ef))

## [7.2.0](https://github.com/GMOD/bandage-core/compare/v7.1.0...v7.2.0) (2026-10-04)

### Other Changes

- The stress engine measures truncated walks, orders the reference along x, and keeps chain lengths ([6395997](https://github.com/GMOD/bandage-core/commit/6395997357677c605f53e4738b6860d0e63bb413))
- The stress engine starts an anchored graph from a structural placement and enters its schedule half way ([fec71a8](https://github.com/GMOD/bandage-core/commit/fec71a85544fba0edb6fde459c1967b7578987e3))

## [7.1.0](https://github.com/GMOD/bandage-core/compare/v7.0.0...v7.1.0) (2026-10-04)

### Other Changes

- Walk rows pack to fit their room, down past a pixel ([3095599](https://github.com/GMOD/bandage-core/commit/309559953f18d448489eac980e462afb43c81582))

## [7.0.0](https://github.com/GMOD/bandage-core/compare/v6.2.0...v7.0.0) (2026-10-04)

### Other Changes

- One rule for which deletion edges a drawing hides ([366c58b](https://github.com/GMOD/bandage-core/commit/366c58ba161ebab4385929b7187936f892463bcc))

## [6.2.0](https://github.com/GMOD/bandage-core/compare/v6.1.1...v6.2.0) (2026-10-04)

### Other Changes

- A stress layout by walk-guided SGD, in JS, as a second force engine ([029d723](https://github.com/GMOD/bandage-core/commit/029d72313d619ff7f169fd5437133bd5d7d6a9bb))

## [6.1.1](https://github.com/GMOD/bandage-core/compare/v6.1.0...v6.1.1) (2026-10-04)

### Other Changes

- A deletion whose ends nothing else joins keeps its link ([af321e1](https://github.com/GMOD/bandage-core/commit/af321e15c3f370f6c645fefeea1f7ecbffd12472))

## [6.1.0](https://github.com/GMOD/bandage-core/compare/v6.0.4...v6.1.0) (2026-10-04)

### Other Changes

- A force layout without deletion edges closes their bubbles ([a70fc23](https://github.com/GMOD/bandage-core/commit/a70fc2319c8ad7b5fcc24963d0b9c61ecac38685))

## [6.0.4](https://github.com/GMOD/bandage-core/compare/v6.0.3...v6.0.4) (2026-10-04)

### Other Changes

- Import nothing from @jbrowse/core or @jbrowse/render-core ([86a2934](https://github.com/GMOD/bandage-core/commit/86a2934c2a2645d7cf720420ea6649038d0de47d))

## [6.0.3](https://github.com/GMOD/bandage-core/compare/v6.0.2...v6.0.3) (2026-10-04)

### Other Changes

- A dragged node keeps the link ends it was laid with ([5368ec4](https://github.com/GMOD/bandage-core/commit/5368ec4f9498565154ddaaf739c2cf2e60c514c8))

## [6.0.2](https://github.com/GMOD/bandage-core/compare/v6.0.1...v6.0.2) (2026-10-04)

### Other Changes

- Stand alone as GMOD/bandage-core ([fc279b0](https://github.com/GMOD/bandage-core/commit/fc279b02abde146fb2754fa780354c1f628e7c5d))
- Publish every module as a subpath export ([77fe1fe](https://github.com/GMOD/bandage-core/commit/77fe1fe34eade4953b77456e7bce15f0180f7bd4))

# Changelog

Releases before 6.0.2 lived in [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer/blob/main/CHANGELOG.md).

