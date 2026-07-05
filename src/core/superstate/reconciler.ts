// Reconciler engine (Notidian-loan.4 / S4, ADR-0057 D2-D6): event-driven
// revalidation + sweep + an in-memory violation-state store. This is the
// WIRING layer ADR-0057's own module boundary calls for -- validateRow.ts
// (Notidian-loan.2 / S2) stays pure/Obsidian-free; every Superstate/
// pathsIndex/contextsIndex/keyMatchResolver import belongs HERE.
//
// Scope (ADR-0057, this wave is explicitly READ-ONLY -- no write-path
// change): subscribe to the EXISTING metadataCache-driven index events
// (pathStateUpdated/pathCreated/pathDeleted/superstateUpdated -- no new
// detection primitive), debounce per-row revalidation, run a full sweep on
// vault-open + schema change, and hold the resulting violations in memory
// only. Per ADR-0057's own "Rejected alternatives" (store violation state
// durably): violations are ALWAYS recomputed from schema + live index, never
// persisted -- the store below is a pure in-memory cache that self-corrects
// the instant underlying data changes, exactly the posture ADR-0029 already
// applies to rollups. Nothing in this file writes to frontmatter, the
// context MDB, or any other durable store (authority partitioning, ADR
// 0001/0014/0017).
//
// Two distinct triggers (ADR-0057 D2):
//   - Incremental: pathStateUpdated/pathCreated for a row inside a schema'd
//     folder -> debounced single-row revalidation.
//   - Full sweep: superstateUpdated (vault open -- see main.ts's
//     loadCacheFromObsidianCache -> superstate.initialize(), the source of
//     every superstateUpdated dispatch) or a pathStateUpdated for a folder's
//     OWN hub note (a Type Profile schema edit) -> full sweep of that folder.
//
// D4 (broken-row rendering) + the bead's wall-04 requirement: a schema'd
// folder's row whose pathsIndex cache metadata is absent/unparseable (a
// broken-YAML edit, or any other reason the frontmatter projection is empty)
// NEVER falls through to ordinary per-field checks (which would just report
// "every required field missing" -- misleading, and easy to miss). It
// resolves to exactly ONE loud, dedicated violation instead, so it can never
// be a row that silently disappears from every check.
//
// D6 / pass-empty immunity (the bead's explicit requirement): a sweep must
// never be able to report "zero violations" for a schema'd folder while
// silently having examined zero of its rows -- that is indistinguishable
// from "clean" and is exactly the audit's "18/19 validators silently
// pass-empty" failure, generalized to the reconciler's OWN sweep mechanism.
// The sweep's row list is the folder's actual vault-listed files (ground
// truth, via spaceManager.childrenForPath -- NOT solely the metadata-cache
// projection, per D4's own instruction), and every row's processing is
// individually fault-isolated (one row's unexpected exception can never
// abort the rest of the sweep); if the ground truth says N > 0 rows exist
// but fewer than N were actually examined, that shortfall is ITSELF recorded
// as a visible, dedicated signal (`SweepIncompleteInfo`) rather than being
// swallowed into an empty, healthy-looking violation list.

import { debounce } from "lodash";
import { Superstate } from "makemd-core";
import { resolveKeyMatch } from "core/utils/contexts/keyMatchResolver";
import { pageTitleFromPath } from "core/utils/contexts/pageTitle";
import {
  NotidianTypeProfile,
  parseTypeProfile,
} from "core/utils/contexts/typeProfile";
import {
  validateRow,
  ValidateRowCtx,
  Violation,
} from "core/utils/contexts/validateRow";
import { PathPropertyName } from "shared/types/context";

// ---------------------------------------------------------------------------
// Public shapes (this is the read API S5's future health-surfaces UI wires
// into -- see the bd note left on Notidian-loan.5 for the full contract).
// ---------------------------------------------------------------------------

// A sweep-level diagnostic, DISTINCT from a row's own `Violation[]` (never
// conflated with the closed, stable `ViolationCode` union validateRow.ts
// owns -- this is a statement about the RECONCILER'S OWN sweep mechanism,
// not about any one row's data). `expectedRows: null` means the ground-truth
// vault listing itself could not be read this pass (spaceManager rejected);
// a non-null `expectedRows` with `examinedRows < expectedRows` means the
// listing succeeded but one or more rows' processing threw.
export type SweepIncompleteInfo = {
  examinedRows: number;
  expectedRows: number | null;
  message: string;
};

export type ReconcilerOptions = {
  /** Debounce window for incremental per-row revalidation. Default 300ms. */
  rowDebounceMs?: number;
  /** Debounce window for full/targeted sweeps. Default 500ms. */
  sweepDebounceMs?: number;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const isPlainRow = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == "object" && !Array.isArray(value);

// D4 / wall-04: the ONE synthetic violation a schema'd-folder row gets when
// its frontmatter is absent or failed to parse -- reuses validateRowPatch's
// own `malformed-row` code (the same semantic class: "this is not a valid
// row object to check"), so the store stays homogeneously typed as
// `Violation[]` for a future UI, with zero new codes added to that closed
// union.
const brokenFrontmatterViolation = (rowPath: string): Violation => ({
  code: "malformed-row",
  severity: "error",
  message: `"${pageTitleFromPath(
    rowPath
  )}" (${rowPath}): frontmatter is missing or failed to parse -- this row would otherwise be silently invisible to every frontmatter-driven view.`,
  repairTier: "manual-only",
});

export class Reconciler {
  // dbPath (schema'd folder path) -> rowPath -> that row's current violations.
  // Only ever holds NON-EMPTY arrays; a clean row has no entry at all.
  private rowStore = new Map<string, Map<string, Violation[]>>();
  // dbPath -> the sweep-mechanism-level diagnostic, when the last sweep
  // couldn't account for every row it should have (see SweepIncompleteInfo).
  private sweepIncompleteStore = new Map<string, SweepIncompleteInfo>();
  private listeners = new Set<() => void>();

  private pendingRowsByDb = new Map<string, Set<string>>();
  private pendingSweepAll = false;
  private pendingSweepDbs = new Set<string>();

  private started = false;
  private readonly rowDebounce: ReturnType<typeof debounce>;
  private readonly sweepDebounce: ReturnType<typeof debounce>;

  constructor(
    private superstate: Superstate,
    options: ReconcilerOptions = {}
  ) {
    this.rowDebounce = debounce(
      () => this.flushRowRevalidations(),
      options.rowDebounceMs ?? 300
    );
    this.sweepDebounce = debounce(() => {
      this.flushSweeps().catch(() => {
        // flushSweeps already isolates every per-db failure; this only
        // guards against an unhandled-rejection warning from the debounced
        // wrapper itself.
      });
    }, options.sweepDebounceMs ?? 500);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private onPathStateUpdated = (payload: { path: string }) =>
    this.handlePathEvent(payload.path);
  private onPathCreated = (payload: { path: string }) =>
    this.handlePathEvent(payload.path);
  private onPathDeleted = (payload: { path: string }) =>
    this.handlePathDeletedEvent(payload.path);
  // A rename is a routine, first-class row-identity edit (ADR-0016), but
  // superstate.onPathRename (superstate.ts) dispatches ONLY `pathChanged`
  // for it -- never pathStateUpdated/pathCreated/pathDeleted (those are the
  // create/update/delete triggers this reconciler otherwise relies on). Left
  // unsubscribed, a rename that introduces or fixes a title_binding mismatch
  // (or any other field check) goes undetected until the next full sweep,
  // and a violation stored under the pre-rename path becomes a permanent
  // ghost (reviewer finding, Notidian-loan.4).
  private onPathChanged = (payload: { path: string; newPath: string }) =>
    this.handlePathChangedEvent(payload.path, payload.newPath);
  private onSuperstateUpdated = () => this.scheduleFullSweep();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.superstate.eventsDispatcher.addListener(
      "pathStateUpdated",
      this.onPathStateUpdated
    );
    this.superstate.eventsDispatcher.addListener(
      "pathCreated",
      this.onPathCreated
    );
    this.superstate.eventsDispatcher.addListener(
      "pathDeleted",
      this.onPathDeleted
    );
    this.superstate.eventsDispatcher.addListener(
      "pathChanged",
      this.onPathChanged
    );
    this.superstate.eventsDispatcher.addListener(
      "superstateUpdated",
      this.onSuperstateUpdated
    );
    // Defensive: if the index is already warm by the time this engine starts
    // listening (e.g. a hot-reload mid-session), don't wait for a NEW
    // superstateUpdated that may never come. Debounced, so harmless if a
    // genuine vault-open superstateUpdated also fires moments later.
    this.scheduleFullSweep();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.superstate.eventsDispatcher.removeListener(
      "pathStateUpdated",
      this.onPathStateUpdated
    );
    this.superstate.eventsDispatcher.removeListener(
      "pathCreated",
      this.onPathCreated
    );
    this.superstate.eventsDispatcher.removeListener(
      "pathDeleted",
      this.onPathDeleted
    );
    this.superstate.eventsDispatcher.removeListener(
      "pathChanged",
      this.onPathChanged
    );
    this.superstate.eventsDispatcher.removeListener(
      "superstateUpdated",
      this.onSuperstateUpdated
    );
    this.rowDebounce.cancel();
    this.sweepDebounce.cancel();
    this.pendingRowsByDb = new Map();
    this.pendingSweepAll = false;
    this.pendingSweepDbs = new Set();
  }

  // -------------------------------------------------------------------------
  // Event handling -> scheduling
  // -------------------------------------------------------------------------

  private handlePathEvent(path: string): void {
    if (!path || !path.toLowerCase().endsWith(".md")) return;

    // A hub note IS a hub note for at most one space; if this path is one,
    // its Type Profile may have just changed -- full sweep of that folder
    // (ADR-0057 D2's "schema change" trigger), never an incremental
    // per-row revalidation of the hub note itself (it is not a data row).
    const owningDb = this.dbForNotePath(path);
    if (owningDb) {
      this.scheduleDbSweep(owningDb);
      return;
    }

    const spaces = this.superstate.pathsIndex.get(path)?.spaces ?? [];
    for (const dbPath of spaces) {
      if (this.resolveDbSchema(dbPath)) {
        this.scheduleRowRevalidate(dbPath, path);
      }
    }
  }

  private handlePathDeletedEvent(path: string): void {
    let changed = false;
    for (const [dbPath, rows] of [...this.rowStore]) {
      if (rows.delete(path)) {
        changed = true;
        if (rows.size == 0) this.rowStore.delete(dbPath);
      }
    }
    // A row already queued for incremental revalidation (via
    // scheduleRowRevalidate, still waiting out the debounce window) must
    // never survive its own delete: left in place, the debounced flush
    // later still calls revalidateRow for a path pathsIndex no longer has
    // an entry for, which resolves to isPlainRow == false and resurrects a
    // synthetic "malformed-row" ghost violation for a file that no longer
    // exists (reviewer finding, Notidian-loan.4). Purge it from every db's
    // pending set -- a path can be pending under more than one db (a note
    // can belong to multiple spaces), so this is not scoped to one dbPath.
    for (const [dbPath, pendingRows] of [...this.pendingRowsByDb]) {
      if (pendingRows.delete(path) && pendingRows.size == 0) {
        this.pendingRowsByDb.delete(dbPath);
      }
    }
    if (changed) this.notifyChange();
  }

  // ADR-0016: a rename is a routine, first-class row-identity edit, but it
  // is dispatched ONLY as `pathChanged` (never pathStateUpdated/pathCreated/
  // pathDeleted) -- see onPathChanged's own doc comment. First clear any
  // violation entry stored under the pre-rename path (and any revalidation
  // still queued for it) exactly as a delete would, since the row no longer
  // lives there; then treat the new path like any other create/update event
  // so a (possibly title_binding-relevant, since basename just changed)
  // fresh revalidation is scheduled for it.
  private handlePathChangedEvent(oldPath: string, newPath: string): void {
    this.handlePathDeletedEvent(oldPath);
    this.handlePathEvent(newPath);
  }

  private dbForNotePath(path: string): string | null {
    for (const [dbPath, spaceState] of this.superstate.spacesIndex) {
      if (spaceState?.space?.notePath == path) return dbPath;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Schema resolution (ADR-0057 D2: same hub-note Type Profile lookup
  // cacheParsers.ts's own `noteProfile` already uses -- no new detection
  // primitive, just a new consumer).
  // -------------------------------------------------------------------------

  private resolveDbSchema(
    dbPath: string
  ): { notePath: string; schema: NotidianTypeProfile } | null {
    const spaceState = this.superstate.spacesIndex.get(dbPath);
    const notePath = spaceState?.space?.notePath;
    if (!notePath) return null;
    const schema = parseTypeProfile(
      this.superstate.pathsIndex.get(notePath)?.metadata?.property
    );
    if (!schema) return null;
    return { notePath, schema };
  }

  // -------------------------------------------------------------------------
  // Scheduling (batched + debounced; full-folder scans only at sweep, per
  // ADR-0057 D2's explicit perf posture).
  // -------------------------------------------------------------------------

  private scheduleRowRevalidate(dbPath: string, rowPath: string): void {
    const pending = this.pendingRowsByDb.get(dbPath) ?? new Set<string>();
    pending.add(rowPath);
    this.pendingRowsByDb.set(dbPath, pending);
    this.rowDebounce();
  }

  scheduleFullSweep(): void {
    this.pendingSweepAll = true;
    this.sweepDebounce();
  }

  private scheduleDbSweep(dbPath: string): void {
    this.pendingSweepDbs.add(dbPath);
    this.sweepDebounce();
  }

  private flushRowRevalidations(): void {
    const pending = this.pendingRowsByDb;
    this.pendingRowsByDb = new Map();
    for (const [dbPath, rowPaths] of pending) {
      try {
        const resolved = this.resolveDbSchema(dbPath);
        if (!resolved) {
          this.clearDb(dbPath);
          continue;
        }
        const { notePath, schema } = resolved;
        for (const rowPath of rowPaths) {
          if (rowPath == notePath) continue;
          try {
            this.revalidateRow(dbPath, schema, rowPath, notePath);
          } catch {
            // One row's incremental revalidation failing must not drop the
            // rest of the batch; it self-heals at the next full sweep,
            // which additionally carries the pass-empty-immunity guard this
            // lightweight incremental path deliberately does not duplicate.
          }
        }
      } catch {
        // Schema resolution itself failed for this db; retry on the next
        // scheduled event rather than losing the whole batch.
      }
    }
  }

  private async flushSweeps(): Promise<void> {
    const sweepAll = this.pendingSweepAll;
    const targeted = this.pendingSweepDbs;
    this.pendingSweepAll = false;
    this.pendingSweepDbs = new Set();
    if (sweepAll) {
      // A full sweep supersedes any queued targeted db sweeps.
      await this.runFullSweep();
      return;
    }
    for (const dbPath of targeted) {
      try {
        await this.sweepFolder(dbPath);
      } catch {
        // Retried on the next scheduled sweep.
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sweeps
  // -------------------------------------------------------------------------

  async runFullSweep(): Promise<void> {
    const dbPaths = [...this.superstate.spacesIndex.keys()];
    for (const dbPath of dbPaths) {
      try {
        await this.sweepFolder(dbPath);
      } catch {
        // One db's totally-broken sweep must never abort the vault-wide
        // pass; it stays whatever it last was and is retried next sweep.
      }
    }
  }

  // Sweeps ONE schema'd folder: full-folder scan is intentionally reserved
  // to this path only (never the incremental per-row path), per ADR-0057 D2.
  async sweepFolder(dbPath: string): Promise<void> {
    const resolved = this.resolveDbSchema(dbPath);
    if (!resolved) {
      // Not (or no longer) a schema'd folder -- nothing to reconcile.
      this.clearDb(dbPath);
      return;
    }
    const { notePath, schema } = resolved;

    // D4: enumerate the folder's files directly (a vault listing, NOT
    // solely the metadata-cache projection) so a file whose frontmatter
    // never made it into the index is still accounted for, and so the
    // pass-empty-immunity check below has an independent ground truth.
    let rawChildren: string[] | null;
    try {
      rawChildren =
        (await this.superstate.spaceManager.childrenForPath(dbPath, "file")) ??
        [];
    } catch {
      rawChildren = null;
    }

    if (rawChildren == null) {
      // The ground truth itself is unavailable this pass -- do NOT report
      // "clean"; that would be indistinguishable from a healthy empty
      // folder. Surface it as its own diagnostic instead.
      this.recordSweepIncomplete(
        dbPath,
        0,
        null,
        "Could not list this database's files this pass -- sweep skipped; treat this database's health as UNKNOWN, not necessarily clean."
      );
      return;
    }

    const rowPaths = rawChildren.filter(
      (p) => p != notePath && p.toLowerCase().endsWith(".md")
    );

    if (rowPaths.length == 0) {
      // Genuinely empty schema'd folder (or only the hub note exists):
      // nothing to validate, nothing to immunize against.
      this.clearDb(dbPath);
      return;
    }

    let examined = 0;
    const seen = new Set<string>();
    for (const rowPath of rowPaths) {
      seen.add(rowPath);
      try {
        this.revalidateRow(dbPath, schema, rowPath, notePath);
        examined++;
      } catch {
        // Never let one row's failure abort the sweep; NOT counted as
        // examined -- see the pass-empty-immunity check below.
      }
    }
    this.pruneRowsNotIn(dbPath, seen);

    // D6 / pass-empty immunity: the vault listing proved this folder is
    // non-empty (rowPaths.length > 0). If fewer rows than that were actually
    // examined -- in the extreme, zero -- that mismatch is ITSELF a
    // violation: a silent, indistinguishable-from-healthy sweep is exactly
    // the audit's "18/19 validators silently pass-empty" failure mode,
    // generalized to the reconciler's own mechanism.
    if (examined < rowPaths.length) {
      this.recordSweepIncomplete(
        dbPath,
        examined,
        rowPaths.length,
        examined == 0
          ? `Sweep examined 0 of ${rowPaths.length} row(s) in a non-empty database -- the reconciler itself failed silently; treat this database's health as UNKNOWN, not clean.`
          : `Sweep examined only ${examined} of ${rowPaths.length} row(s) -- ${
              rowPaths.length - examined
            } row(s) were skipped by an internal error and were NOT revalidated this pass.`
      );
    } else {
      this.clearSweepIncomplete(dbPath);
    }
  }

  // -------------------------------------------------------------------------
  // Per-row validation (shared by the incremental path and sweeps)
  // -------------------------------------------------------------------------

  private revalidateRow(
    dbPath: string,
    schema: NotidianTypeProfile,
    rowPath: string,
    notePath: string
  ): void {
    const frontmatter = this.superstate.pathsIndex.get(rowPath)?.metadata
      ?.property;
    if (!isPlainRow(frontmatter)) {
      // D4 / wall-04: absent or unparseable frontmatter never falls through
      // to per-field checks (which would misleadingly report "everything
      // required is missing") -- exactly one loud, dedicated violation.
      this.setRowViolations(dbPath, rowPath, [
        brokenFrontmatterViolation(rowPath),
      ]);
      return;
    }

    const ctx: ValidateRowCtx = {
      basename: pageTitleFromPath(rowPath),
      // Sourced from contextsIndex (the materialized context table), per
      // this bead's wiring instruction -- excludes the row itself and the
      // hub note. A collision-irrelevant sibling (e.g. one whose own
      // frontmatter is broken) simply contributes a missing/blank value,
      // which checkUnique already ignores (isMissingValue guard).
      getOtherRows: () =>
        (
          this.superstate.contextsIndex.get(dbPath)?.contextTable?.rows ?? []
        ).filter(
          (row) =>
            row[PathPropertyName] != rowPath && row[PathPropertyName] != notePath
        ),
      // Mirrors resolveKeyMatch's pure contract without validateRow.ts
      // importing it (S2's own documented contract; keyMatchResolver stays
      // this wiring layer's import). `sourceField` is required by
      // KeyMatchRelationConfig's shape but is NOT read by resolveKeyMatch's
      // implementation (only targetFolder/targetField are) -- see
      // keyMatchResolver.ts -- so a placeholder is safe here.
      resolveReferenceExists: (reference, value) =>
        resolveKeyMatch(this.superstate, value, {
          type: "key-match",
          sourceField: "",
          targetFolder: reference.targetFolder,
          targetField: reference.targetKey,
        }).length > 0,
    };

    const violations = validateRow(schema, frontmatter, ctx);
    this.setRowViolations(dbPath, rowPath, violations);
  }

  // -------------------------------------------------------------------------
  // Store mutation
  // -------------------------------------------------------------------------

  private clearDb(dbPath: string): void {
    const hadRows = this.rowStore.delete(dbPath);
    const hadSweep = this.sweepIncompleteStore.delete(dbPath);
    if (hadRows || hadSweep) this.notifyChange();
  }

  private setRowViolations(
    dbPath: string,
    rowPath: string,
    violations: Violation[]
  ): void {
    let db = this.rowStore.get(dbPath);
    if (violations.length == 0) {
      if (db?.delete(rowPath) && db.size == 0) this.rowStore.delete(dbPath);
    } else {
      if (!db) {
        db = new Map();
        this.rowStore.set(dbPath, db);
      }
      db.set(rowPath, violations);
    }
    this.notifyChange();
  }

  private pruneRowsNotIn(dbPath: string, keep: Set<string>): void {
    const db = this.rowStore.get(dbPath);
    if (!db) return;
    let changed = false;
    for (const rowPath of [...db.keys()]) {
      if (!keep.has(rowPath)) {
        db.delete(rowPath);
        changed = true;
      }
    }
    if (db.size == 0) this.rowStore.delete(dbPath);
    if (changed) this.notifyChange();
  }

  private recordSweepIncomplete(
    dbPath: string,
    examined: number,
    expected: number | null,
    message: string
  ): void {
    this.sweepIncompleteStore.set(dbPath, {
      examinedRows: examined,
      expectedRows: expected,
      message,
    });
    this.notifyChange();
  }

  private clearSweepIncomplete(dbPath: string): void {
    if (this.sweepIncompleteStore.delete(dbPath)) this.notifyChange();
  }

  private notifyChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A subscriber's own bug must never break the reconciler.
      }
    }
  }

  // -------------------------------------------------------------------------
  // Read API (Notidian-loan.5 / S4 hand-off: the future health-surfaces UI's
  // ONLY way to read violation state -- never reach into the private store).
  // -------------------------------------------------------------------------

  /** Every current violation for one row, or `[]` if the row is clean. */
  getRowViolations(dbPath: string, rowPath: string): Violation[] {
    return this.rowStore.get(dbPath)?.get(rowPath) ?? [];
  }

  /** A defensive-copy snapshot of every violating row in one database. */
  getDbViolations(dbPath: string): Map<string, Violation[]> {
    return new Map(this.rowStore.get(dbPath) ?? []);
  }

  /** The sweep-mechanism diagnostic for one database, if its last sweep
   * could not account for every row (see `SweepIncompleteInfo`). */
  getSweepIncomplete(dbPath: string): SweepIncompleteInfo | undefined {
    return this.sweepIncompleteStore.get(dbPath);
  }

  /** Every database path currently holding ANY violation or sweep flag. */
  getAllDbPaths(): string[] {
    return [
      ...new Set([
        ...this.rowStore.keys(),
        ...this.sweepIncompleteStore.keys(),
      ]),
    ];
  }

  /** Total violation count, vault-wide or scoped to one database; a
   * sweep-incomplete flag counts as one toward the total. */
  getViolationCount(dbPath?: string): number {
    if (dbPath) {
      const db = this.rowStore.get(dbPath);
      let count = 0;
      if (db) for (const violations of db.values()) count += violations.length;
      if (this.sweepIncompleteStore.has(dbPath)) count++;
      return count;
    }
    let total = 0;
    for (const db of this.rowStore.values()) {
      for (const violations of db.values()) total += violations.length;
    }
    total += this.sweepIncompleteStore.size;
    return total;
  }

  /** Subscribe to any store mutation (row violations changed, cleared, or a
   * sweep-incomplete flag set/cleared). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
