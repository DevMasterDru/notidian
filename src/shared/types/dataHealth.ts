// Notidian-loan.5 (ADR-0057): the structural, shared/types-safe read contract
// for the Data Integrity Program's reconciler, exposed on ISuperstate as
// `reconciler` so the health-surfaces UI (row badges, the FilterBar chip, the
// Database Health panel) can reach it without any core/* import from
// shared/types (this package never imports core/*, mirroring IUIManager/
// ICLIManager/IAssetManager's own posture: a shared/types interface, a
// core/-owned concrete implementation). The concrete `Reconciler` class
// (core/superstate/reconciler.ts) is structurally compatible with this
// interface (its `Violation`/`SweepIncompleteInfo` types are strictly
// narrower — literal unions — than the generic `string` fields below), so
// `class Superstate implements ISuperstate` type-checks with zero duplication
// of logic, only of shape.
export type DataHealthViolation = {
  field?: string;
  code: string;
  severity: string;
  message: string;
  repairTier: string;
  suggestedFix?: string;
};

export type DataHealthSweepIncomplete = {
  examinedRows: number;
  expectedRows: number | null;
  message: string;
};

// Notidian-loan.5 review round 2 (unit tests #1): the ONE shared literal for
// the D4/wall-04 broken-frontmatter violation code, so the producer
// (reconciler.ts's brokenFrontmatterViolation) and the consumer (TableView's
// rowIsBroken / mk-row-broken check) reference the SAME constant instead of
// two independent bare "malformed-row" string literals drifting apart. Lives
// here (shared/types), not validateRow.ts or reconciler.ts, so TableView —
// which stays shared/types-only for health-surfaces reads, mirroring this
// whole module's own posture — never needs a core/* import just to read this
// one code string.
export const MALFORMED_ROW_CODE = "malformed-row" as const;

export interface IDataHealthReconciler {
  getRowViolations(dbPath: string, rowPath: string): DataHealthViolation[];
  getDbViolations(dbPath: string): Map<string, DataHealthViolation[]>;
  getSweepIncomplete(dbPath: string): DataHealthSweepIncomplete | undefined;
  getAllDbPaths(): string[];
  getViolationCount(dbPath?: string): number;
  // Notidian-loan.5 review round 2 (unit S1): `dbPath` is the mutated
  // database, or `undefined` for a global/multi-db signal (e.g. a db
  // disappearing entirely) — subscribers that only care about ONE database
  // filter on it (a nullish dbPath is a global signal, always honored);
  // vault-aware subscribers (the Database Health panel) ignore it and always
  // re-render.
  onChange(listener: (dbPath?: string) => void): () => void;
}
