#!/bin/bash
# Rebuilds src/bandage/bandage-layout.js from the BandageNG C++ sources.
#
# Needs the Emscripten SDK and a BandageNG checkout. The artifact is committed,
# so this only needs running when the layout sources or OGDF change.

set -euo pipefail

BANDAGE_DIR="${BANDAGE_DIR:-$HOME/src/vendor/BandageNG}"
LAYOUT_DIR="$BANDAGE_DIR/bandage-layout-js"
BUILD_DIR="$LAYOUT_DIR/build-singlefile"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src/bandage/bandage-layout.js"

if [ ! -d "$LAYOUT_DIR" ]; then
    echo "ERROR: no BandageNG checkout at $BANDAGE_DIR" >&2
    echo "Clone https://github.com/cmdcolin/BandageNG-web or set BANDAGE_DIR" >&2
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

# OGDF is the slow part (~85MB of build tree); build.sh already handles it and
# skips when libOGDF.a exists.
if [ ! -f "$BANDAGE_DIR/thirdparty/ogdf/build-wasm/libOGDF.a" ]; then
    echo "Building OGDF (slow, one time)..."
    (cd "$LAYOUT_DIR" && ./build.sh)
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DSINGLE_FILE=ON
emmake make -j"$(nproc)"

cp "$BUILD_DIR/bandage-layout.js" "$DEST"
echo "Wrote $DEST ($(du -h "$DEST" | cut -f1))"
