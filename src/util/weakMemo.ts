// A cache keyed weakly on an object, such as a layout's positions, so an entry
// dies with its key. A call recomputes when any of `deps` differs, by
// `Object.is`, from the deps the stored value was computed with.
export function weakMemo<K extends object, V>() {
  const cache = new WeakMap<K, { deps: readonly unknown[]; value: V }>()
  return (key: K, deps: readonly unknown[], compute: () => V) => {
    const hit = cache.get(key)
    if (
      hit?.deps.length === deps.length &&
      hit.deps.every((d, i) => Object.is(d, deps[i]))
    ) {
      return hit.value
    }
    const value = compute()
    cache.set(key, { deps, value })
    return value
  }
}
