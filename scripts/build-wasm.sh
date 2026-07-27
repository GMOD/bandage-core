#!/bin/bash
# Rebuilds src/bandage/bandage-layout.js from src/bandage/native.
#
# The engine's C++ lives in this repo; OGDF does not, because it is ~85MB of
# build tree that compiles for far longer than the port does. Point OGDF_DIR at
# a checkout (a BandageNG one has it under thirdparty/ogdf) and this builds it
# once with Emscripten, then reuses libOGDF.a.
#
# The artifact is committed, so this only needs running when native/ changes.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_DIR="$ROOT/src/bandage/native"
# Out of src/, because CMake writes a compiler_depend.ts into its build tree and
# tsc and eslint would both try to parse it.
BUILD_DIR="$ROOT/.wasm-build"
DEST="$ROOT/src/bandage/bandage-layout.js"
OGDF_DIR="${OGDF_DIR:-$HOME/src/vendor/BandageNG/thirdparty/ogdf}"

if [ ! -d "$OGDF_DIR" ]; then
    echo "ERROR: no OGDF checkout at $OGDF_DIR" >&2
    echo "Clone https://github.com/ogdf/ogdf or set OGDF_DIR" >&2
    exit 1
fi

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

if [ ! -f "$OGDF_DIR/build-wasm/libOGDF.a" ]; then
    echo "Building OGDF (slow, one time)..."
    mkdir -p "$OGDF_DIR/build-wasm"
    (cd "$OGDF_DIR/build-wasm" &&
        emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
            -DOGDF_SEPARATE_TESTS=OFF &&
        emmake make -j"$(nproc)")
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
emcmake cmake "$NATIVE_DIR" -DCMAKE_BUILD_TYPE=Release -DOGDF_DIR="$OGDF_DIR"
emmake make -j"$(nproc)"

cp "$BUILD_DIR/bandage-layout.js" "$DEST"
echo "Wrote $DEST ($(du -h "$DEST" | cut -f1))"
