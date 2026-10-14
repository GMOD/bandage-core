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

