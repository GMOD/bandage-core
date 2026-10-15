export function pushTo<K, V>(map: Map<K, V[]>, key: K, ...values: V[]) {
  const list = map.get(key)
  if (list) {
    list.push(...values)
  } else {
    map.set(key, values)
  }
}

export function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key)
  if (set) {
    set.add(value)
  } else {
    map.set(key, new Set([value]))
  }
}

export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K) {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    pushTo(groups, keyOf(item), item)
  }
  return groups
}
