#!/bin/bash
# Builds the native profiling driver (gfa-layout-profile.cpp) against a natively
# compiled OGDF, so `perf` can attribute the layout. The committed engine is
# wasm and carries no symbols perf can walk; this is the only way to see inside
# FMMM. See the header of gfa-layout-profile.cpp for what does and does not
# transfer from a native profile to the shipped one.
#
# The OGDF build lands in vendor/ogdf/build-native, beside — never on top of —
# the build-wasm tree that scripts/build-wasm.sh links the committed artifact
# against. Overwriting that one would silently relink the engine against a
# host-arch library.
#
# -fcx-limited-range matches what build-wasm.sh gives the shipped engine. Without
# it the profile is of a build nobody ships, and __divdc3 dominates a quarter of
# it (GRAPH_SCALE_AND_LOD.md).
#
# Slow once (OGDF), seconds thereafter.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OGDF_DIR="${OGDF_DIR:-$ROOT/vendor/ogdf}"
BUILD="$OGDF_DIR/build-native"
OUT="$ROOT/.profile-build"

FLAGS="-O3 -g -fno-omit-frame-pointer -fcx-limited-range"

# src/bandage/native/include/settings.h calls ceil() without including <cmath>.
# emcc's libc++ pulls it in transitively so the wasm build never noticed;
# libstdc++ does not, and both the driver and graphlayout.cpp fail on it. Forced
# in from the command line rather than fixed in the header, because that header
# is a source of the COMMITTED engine and editing it desyncs the artifact from
# its sources for a build nobody ships. Worth fixing there on its own, with a
# regen — it is the same latent-include bug the vendored OGDF needed <chrono>
# for (vendor/ogdf-emscripten.patch, hunk 2).
DRIVER_FLAGS="-include cmath"

if [ ! -f "$BUILD/libOGDF.a" ]; then
    echo "Building OGDF natively (slow, one time)..."
    mkdir -p "$BUILD"
    (cd "$BUILD" &&
        cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
            -DOGDF_SEPARATE_TESTS=OFF \
            -DCMAKE_CXX_FLAGS="$FLAGS" &&
        make -j"$(nproc)" OGDF)
fi

mkdir -p "$OUT"
g++ $FLAGS $DRIVER_FLAGS -std=c++17 \
    -I"$OGDF_DIR/include" -I"$BUILD/include" \
    "$ROOT/scripts/profile/gfa-layout-profile.cpp" \
    "$ROOT/src/bandage/native/src/graphlayout.cpp" \
    -L"$BUILD" -lOGDF -lpthread \
    -o "$OUT/gfa-layout-profile"

echo "Built $OUT/gfa-layout-profile"
echo
echo "Profile with:"
echo "  perf record -g --call-graph dwarf -F 499 -o /tmp/perf.data \\"
echo "    $OUT/gfa-layout-profile <file.gfa> <cap> <quality>"
echo "  perf report -i /tmp/perf.data --no-children --percent-limit 1"
