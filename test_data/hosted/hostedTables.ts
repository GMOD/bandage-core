import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import type { GraphTables } from '../../src/gfa/graphTables'

const isTyped = (
  value: unknown,
): value is { typed: string; values: (number | null)[] } =>
  typeof value === 'object' &&
  value !== null &&
  'typed' in value &&
  typeof value.typed === 'string' &&
  'values' in value &&
  Array.isArray(value.values)

const typedArrays: Record<string, (values: number[]) => ArrayLike<number>> = {
  Int32Array: values => Int32Array.from(values),
  Float64Array: values => Float64Array.from(values),
  Uint8Array: values => Uint8Array.from(values),
  Uint32Array: values => Uint32Array.from(values),
}

const revive = (_key: string, value: unknown) => {
  const make = isTyped(value) ? typedArrays[value.typed] : undefined
  return isTyped(value) && make ? make(value.values.map(v => v ?? NaN)) : value
}

const isHosted = (
  value: unknown,
): value is { refName: string; tables: GraphTables } =>
  typeof value === 'object' &&
  value !== null &&
  'refName' in value &&
  typeof value.refName === 'string' &&
  'tables' in value &&
  typeof value.tables === 'object'

/**
 * A cut of the hosted HPRC walk file saved here as `<name>.tables.json.gz`,
 * its typed arrays revived, and the reference sequence it was cut on
 */
export function hostedTables(name: string) {
  const fixture: unknown = JSON.parse(
    gunzipSync(
      readFileSync(join(__dirname, `${name}.tables.json.gz`)),
    ).toString(),
    revive,
  )
  if (!isHosted(fixture)) {
    throw new Error(`${name} holds no refName and tables`)
  }
  return fixture
}
