// The tables bandage-core reads are the tables @jbrowse/graph-walks writes:
// `pnpm typecheck` fails here when the version package.json pins changes their
// shape, so a graph-walks bump that changes the hand-off cannot land unnoticed.
// Outside src, so neither the build nor a consumer's types depend on it.
import type { Departure, DepartureKind, GapKind } from '../src/gfa/departures'
import type {
  DepartureTable,
  GapTable,
  GraphTables,
} from '../src/gfa/graphTables'
import type {
  END_KINDS,
  WalkEndTable,
  WalkRunsTables,
} from '../src/gfa/walkRuns'
import type { END_KINDS as FOLD_END_KINDS } from '@jbrowse/graph-fold'
import type {
  DepartureKind as WalksDepartureKind,
  DepartureTable as WalksDepartureTable,
  GapKind as WalksGapKind,
  GapTable as WalksGapTable,
  GraphTables as WalksGraphTables,
  WalkDeparture,
  WalkEnds as WalksWalkEnds,
  WalkRuns,
  END_KINDS as WALKS_END_KINDS,
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
  Identical<Departure, Omit<WalkDeparture, 'steps' | 'abridged'>>
>
export type KindsMatch = Holds<Identical<DepartureKind, WalksDepartureKind>>
export type GapTablesMatch = Holds<Identical<GapTable, WalksGapTable>>
export type GapKindsMatch = Holds<Identical<GapKind, WalksGapKind>>
export type RunsMatch = Holds<Identical<WalkRunsTables, WalkRuns>>
export type EndTablesMatch = Holds<Identical<WalkEndTable, WalksWalkEnds>>
// an end's kind travels as its index, so the three lists agree in order
export type EndKindsMatch = Holds<
  Identical<typeof END_KINDS, typeof WALKS_END_KINDS>
>
export type FoldEndKindsMatch = Holds<
  Identical<typeof END_KINDS, typeof FOLD_END_KINDS>
>
