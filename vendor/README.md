# Vendored third-party sources

## `ogdf/` — OGDF `elderberry-202309`, patched

The graph layout library behind the force-directed drawing. `src/bandage/native`
is a port of Bandage's FMMM layout, and FMMM is OGDF's; `scripts/build-wasm.sh`
compiles this tree to `libOGDF.a` with Emscripten and links the engine against
it.

Upstream is <https://github.com/ogdf/ogdf> at tag `elderberry-202309`, plus
`ogdf-emscripten.patch` beside this file, which is already applied here.

### Why it is vendored rather than fetched

This used to be a hard-coded path into a BandageNG checkout under `$HOME`. A
fresh clone of this repo therefore could not rebuild its own engine, and what it
did build depended on whatever state that unrelated tree happened to be in — for
a **committed artifact that every published force-directed figure is a function
of**, that is the wrong kind of dependency to have.

Fetching at a pinned tag was the intermediate step and is also gone. Nothing is
downloaded during a build, so the engine can be regenerated offline, at a known
version, forever.

It costs 26 MB on disk and about 4 MB in a clone. That buys `pnpm build:wasm`
working from nothing but this repo and the Emscripten SDK. Note that `pnpm
build` — the ordinary one — needs none of it: the engine is committed at
`src/bandage/bandage-layout.js` and this tree is only an input to regenerating
that.

### The patch is required, not a preference

A stock `elderberry-202309` does not build for wasm **at all**. OGDF adds
`-march=native` for any compiler identifying as GNU *or Clang*, and emcc is
Clang:

```
clang++: error: unsupported option '-march=' for target 'wasm32-unknown-emscripten'
```

Dropping Clang from that guard is also the right call for a committed artifact
independently of whether the flag is accepted, since `native` means "whatever
CPU ran the build" — the opposite of a reproducible engine. The second hunk adds
a `<chrono>` include that newer libc++ no longer provides transitively.

Both hunks match what BandageNG carries in its own vendored OGDF. That is
deliberate: it is what the engine had been built against since it was ported, so
it is what every committed figure was drawn with. **Verified** rather than
assumed — building upstream `elderberry-202309` plus this patch reproduced all
90 cases of `scripts/layout-digest.mjs` with byte-identical coordinates against
the artifact built from BandageNG's tree, which is what established that these
two hunks are the whole of the delta that mattered.

### Re-syncing to a newer OGDF

```console
git clone --depth 1 --branch <newtag> https://github.com/ogdf/ogdf.git /tmp/ogdf
patch -p1 --fuzz=0 -d /tmp/ogdf < vendor/ogdf-emscripten.patch   # may need rework
rm -rf /tmp/ogdf/.git && rm -rf vendor/ogdf && mv /tmp/ogdf vendor/ogdf
pnpm build:wasm
```

Then diff the drawing, not the artifact — `src/bandage/README.md` has the
`layout-digest.mjs` recipe. **Expect it to move.** A different OGDF is a
different FMMM, and every force-directed figure will need regenerating; that is
the cost of the bump, and it should be a deliberate commit of its own rather
than a side effect of one.

### Licensing

OGDF is GPL (`ogdf/LICENSE_GPL_v2.txt`, `ogdf/LICENSE_GPL_v3.txt`), which is why
this plugin is GPL-3.0-or-later — see the repo README. Vendoring the sources
changes nothing about that: it was already linked in.

`package.json` publishes only `dist` and `src`, so this directory is not in the
npm tarball.
