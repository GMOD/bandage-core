// The tables bandage-core reads are the tables @jbrowse/graph-walks writes:
// `tsc` fails here when the version package.json pins changes their shape,
// so a graph-walks bump that changes the hand-off cannot land unnoticed.
// Outside src, so neither the build nor a consumer's types depend on it.
import type { Departure, DepartureKind, GapKind } from '../src/gfa/departures'
import type {
  DepartureTable,
  GapTable,
  GraphTables,
} from '../src/gfa/graphTables'
import type {
  DepartureKind as WalksDepartureKind,
  DepartureTable as WalksDepartureTable,
  GapKind as WalksGapKind,
  GapTable as WalksGapTable,
  GraphTables as WalksGraphTables,
  WalkDeparture,
} from '@jbrowse/graph-walks'

type Identical<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

type Holds<T extends true> = T

export type TablesMatch = Holds<Identical<GraphTables, WalksGraphTables>>
export type DepartureTablesMatch = Holds<
  Identical<DepartureTable, WalksDepartureTable>
>
export type DeparturesMatch = Holds<
  Identical<Departure, Omit<WalkDeparture, 'steps'>>
>
export type KindsMatch = Holds<Identical<DepartureKind, WalksDepartureKind>>
export type GapTablesMatch = Holds<Identical<GapTable, WalksGapTable>>
export type GapKindsMatch = Holds<Identical<GapKind, WalksGapKind>>
