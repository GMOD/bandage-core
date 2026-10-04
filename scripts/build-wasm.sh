#!/bin/bash
# Rebuilds src/bandage/bandage-layout.js from src/bandage/native.
#
# Everything it needs is in this repo except the Emscripten SDK. OGDF is
# vendored at vendor/ogdf (see vendor/README.md for the tag and the patch), so
# there is no checkout to find, no network, and no version to get wrong.
#
# It used to want a BandageNG checkout at a hard-coded path under $HOME, which
# meant a fresh clone of this repo could not rebuild its own engine, and the
# OGDF it linked against was whatever that unrelated tree happened to be at.
#
# OGDF_DIR still points it somewhere else if you are testing an upstream bump.
#
# The artifact is committed, so this only needs running when native/ changes.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_DIR="$ROOT/src/bandage/native"
# Out of src/, because CMake writes a compiler_depend.ts into its build tree and
# tsc and eslint would both try to parse it.
BUILD_DIR="$ROOT/.wasm-build"
DEST="$ROOT/src/bandage/bandage-layout.js"
OGDF_DIR="${OGDF_DIR:-$ROOT/vendor/ogdf}"

if ! command -v emcc &> /dev/null; then
    for p in "$HOME/emsdk/emsdk_env.sh" /opt/emsdk/emsdk_env.sh; do
        if [ -f "$p" ]; then
            # shellcheck disable=SC1090
            source "$p"
            break
        fi
    done
fi

if ! command -v emcc &> /dev/null; then
    echo "ERROR: emcc not found. Install the Emscripten SDK:" >&2
    echo "  git clone https://github.com/emscripten-core/emsdk.git" >&2
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest" >&2
    exit 1
fi

if [ ! -f "$OGDF_DIR/CMakeLists.txt" ]; then
    echo "ERROR: no OGDF sources at $OGDF_DIR" >&2
    echo "vendor/ogdf is committed; see vendor/README.md if it is missing." >&2
    exit 1
fi

# FMMM's multipole expansions divide by (z_1 - z_0)^k in complex<double>, and
# without this the compiler emits a call to __divdc3 for every one of them —
# 22% of the whole program at layoutQuality 4, where k runs to 8. Inlining it is
# worth 1.3-1.9x (agent-docs/GRAPH_SCALE_AND_LOD.md has the table).
#
# It does not change the drawing. compiler-rt's __divdc3 computes the same naive
# (ac+bd)/(c^2+d^2) this inlines; it only scales c and d by exact powers of two
# first and unscales after, so every rounding is the same one and the results are
# bit-identical short of an intermediate overflow. Verified on all 90
# layout-digest.mjs cases plus larger shapes, max coordinate delta exactly 0.
#
# It must reach libOGDF.a, not just the engine, since that is where the complex
# arithmetic lives.
OGDF_CXX_FLAGS="-fcx-limited-range"

# Rebuild OGDF when the flags change, not only when the library is missing.
# Skipping on presence alone silently links a stale libOGDF.a built with
# different arithmetic, and the artifact is committed — so a rebuild that
# quietly used the wrong one would produce a drawing nobody could reproduce.
FLAG_STAMP="$OGDF_DIR/build-wasm/.cxxflags"
if [ ! -f "$OGDF_DIR/build-wasm/libOGDF.a" ] ||
   [ "$(cat "$FLAG_STAMP" 2>/dev/null)" != "$OGDF_CXX_FLAGS" ]; then
    echo "Building OGDF (slow, one time)..."
    rm -rf "$OGDF_DIR/build-wasm"
    mkdir -p "$OGDF_DIR/build-wasm"
    (cd "$OGDF_DIR/build-wasm" &&
        emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
            -DOGDF_SEPARATE_TESTS=OFF \
            -DCMAKE_CXX_FLAGS="$OGDF_CXX_FLAGS" &&
        emmake make -j"$(nproc)")
    echo "$OGDF_CXX_FLAGS" > "$FLAG_STAMP"
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
emcmake cmake "$NATIVE_DIR" -DCMAKE_BUILD_TYPE=Release -DOGDF_DIR="$OGDF_DIR"
emmake make -j"$(nproc)"

cp "$BUILD_DIR/bandage-layout.js" "$DEST"

# emscripten's UTF8ArrayToString decodes a view over HEAPU8 — i.e. over
# WebAssembly.Memory, whose buffer is a RESIZABLE ArrayBuffer — and browsers
# reject TextDecoder.decode on such a view:
#
#   TypeError: Failed to execute 'decode' on 'TextDecoder':
#   The provided ArrayBuffer value must not be resizable
#
# It only takes that path for strings longer than 16 bytes; shorter ones go
# through the manual char loop below it and are unaffected. That threshold is
# what makes the bug look like a data problem rather than a code one: a graph
# whose node ids are `s10274` never trips it, and one whose ids are
# `bb_GRCh38#0#chr1_0` always does. The bubble-tier index is the second kind, and
# it cost a long investigation that blamed tabix, bgzf, the CDN, the compressor
# and the bundler in turn before landing here.
#
# Copy before decoding. Patched here rather than in src/bandage by hand, because
# that file is overwritten by the cp above. Idempotent, and fails loudly if
# emscripten changes the shape.
decode='return UTF8Decoder.decode(heapOrArray.subarray(idx,endPtr))'
if grep -qF "$decode" "$DEST"; then
  perl -pi -e 's/\Qsubarray(idx,endPtr))\E/subarray(idx,endPtr).slice())/' "$DEST"
  grep -qF 'subarray(idx,endPtr).slice())' "$DEST" || {
    echo "UTF8ArrayToString patch did not apply to $DEST" >&2; exit 1; }
  echo "patched UTF8ArrayToString to copy out of the wasm heap"
elif grep -qF 'subarray(idx,endPtr).slice())' "$DEST"; then
  echo "UTF8ArrayToString already copies"
else
  echo "emscripten changed UTF8ArrayToString; re-check the resizable-buffer patch" >&2
  exit 1
fi

# UTF16ToString has the identical shape and the identical 16-unit threshold.
decode16='return UTF16Decoder.decode(HEAPU16.subarray(idx,endIdx))'
if grep -qF "$decode16" "$DEST"; then
  perl -pi -e 's/\QHEAPU16.subarray(idx,endIdx))\E/HEAPU16.subarray(idx,endIdx).slice())/' "$DEST"
  grep -qF 'HEAPU16.subarray(idx,endIdx).slice())' "$DEST" || {
    echo "UTF16ToString patch did not apply to $DEST" >&2; exit 1; }
  echo "patched UTF16ToString to copy out of the wasm heap"
elif grep -qF 'HEAPU16.subarray(idx,endIdx).slice())' "$DEST"; then
  echo "UTF16ToString already copies"
else
  echo "emscripten changed UTF16ToString; re-check the resizable-buffer patch" >&2
  exit 1
fi

echo "Wrote $DEST ($(du -h "$DEST" | cut -f1))"
