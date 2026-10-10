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

