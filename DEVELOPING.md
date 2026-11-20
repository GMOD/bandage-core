# Developing

```
pnpm install
pnpm test          # unit tests
pnpm build         # dist/ with declarations
```

- The FMMM engine and its wasm build are in
  [graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout)
- CI also packs the core and runs the typecheck and tests of
  [BandageJS](https://github.com/GMOD/BandageJS) and
  [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
  against it. For an API change, push the consumer's matching change to a
  `core-next` branch in that consumer's repo, which CI tests in place of `main`
  until the release
- [`src/foldParity.test.ts`](src/foldParity.test.ts) folds a few hundred random
  rGFA graphs with `foldVariants` and with the gfa-to-tabix release that
  `.github/actions/gfa-to-tabix` pins, and fails when they fold differently.
  Locally the test runs the `gfa-to-tabix` on PATH or named by `GFA_TO_TABIX`,
  and skips without one or with another version than the pinned one. Under CI or
  a set `GFA_TO_TABIX`, a missing or other version fails. In the other
  direction, gfa-to-tabix's `scripts/parity-fold.sh` checks that
  `gfa-to-tabix fold` writes the same bytes as `bandage-fold | gfa-to-tabix -`,
  and its CI tests the port against a pinned bandage-core
- Release with `pnpm version patch`: it lints, tests, stamps `src/version.ts`,
  writes the changelog with git-cliff and pushes the `v*` tag. `publish.yml`
  then runs CI, consumers included, and publishes to npm with trusted publishing
  only if it passes. When a consumer fails, push its side to `core-next` and
  rerun the failed jobs
- `GraphTables` mirrors graph-walks', and `typecheck/graphWalks.ts` fails the
  typecheck when the two differ
