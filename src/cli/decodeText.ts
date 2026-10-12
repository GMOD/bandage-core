/// <reference types="node" />

import { gunzipSync } from 'node:zlib'

export function decodeText(bytes: Uint8Array) {
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  return new TextDecoder().decode(gzipped ? gunzipSync(bytes) : bytes)
}
