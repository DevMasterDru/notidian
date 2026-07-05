// ===========================================================================
// Adversarial / stress-hardening tests for Reconciler (ADR-0057 D2-D6,
// Notidian-mobs).
//
// reconciler.test.ts already covers the documented functional contract
// (debounced incremental revalidation, sweeps, D4 broken-row rendering, D6
// pass-empty immunity, the read API). This file targets the fault-tolerance
// and concurrency claims the module's OWN comments make but that file never
// names explicitly:
//
//   (a) one row's handler throwing mid-sweep must not abort or short-circuit
//       the rest of that sweep's OTHER rows (per-row fault isolation).
//   (b) two overlapping sweepFolder passes for the SAME folder (a
//       schema-change sweep firing while a vault-open sweep is still in
//       flight) must not corrupt or double-count the violation store.
//   (c) rapid create-delete-create thrash of the SAME path, all before the
//       debounced revalidation flushes, must never resurrect a stale
//       violation keyed to a deleted incarnation (extends the single
//       delete-before-flush case reconciler.test.ts already covers).
//   (d) stop() is idempotent -- calling it twice never throws.
//   (e) a profile with MULTIPLE reference/unique fields wires
//       keyMatchResolver/getOtherRows independently and correctly per field
//       (no cross-field bleed).
//
// (b) surfaced a genuine bug during authoring: two overlapping sweepFolder
// calls for the same dbPath could, prior to the fix living alongside this
// file, let a slower call holding a STALE `childrenForPath` snapshot
// overwrite a faster, more current call's results -- resurrecting a ghost
// `malformed-row` violation for a row deleted in between. sweepFolder now
// serializes per dbPath (see reconciler.ts's own comment on the method).
// ===========================================================================

import { PathPropertyName } from "shared/types/context";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { Reconciler } from "./reconciler";

// ---------------------------------------------------------------------------
// Fixtures (mirrors reconciler.test.ts's own conventions)
// ---------------------------------------------------------------------------

const DB = "Gidi/Widgets";
const NOTE_PATH = `${DB}/Widgets.md`;
const ROW1 = `${DB}/row1.md`;
const ROW2 = `${DB}/row2.md`;
const ROW3 = `${DB}/row3.md`;

const HUB_REQUIRED = {
  schema_type: "notidian_type_profile",
  fields: {
    model: { kind: "text", required: true },
  },
};

function makeSuperstate(
  overrides: {
    pathsIndex?: any;
    spacesIndex?: Map<string, any>;
    contextsIndex?: Map<string, any>;
    childrenForPath?: jest.Mock;
  } = {}
) {
  const pathsIndex = overrides.pathsIndex ?? new Map<string, any>();
  const spacesIndex = overrides.spacesIndex ?? new Map<string, any>();
  const contextsIndex = overrides.contextsIndex ?? new Map<string, any>();
  const childrenForPath =
    overrides.childrenForPath ?? jest.fn().mockResolvedValue([]);
  return {
    eventsDispatcher: new EventDispatcher(),
    pathsIndex,
    spacesIndex,
    contextsIndex,
    spaceManager: { childrenForPath },
  } as any;
}

const dbSpacesIndex = (notePath = NOTE_PATH) =>
  new Map([[DB, { space: { path: DB, notePath } }]]);

// A deferred promise helper for manually controlling resolution order of
// mocked async calls (childrenForPath) across overlapping invocations.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Reconciler adversarial -- stress hardening (Notidian-mobs)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // (a) Per-row fault isolation during a sweep
  // -------------------------------------------------------------------------

  describe("(a) one row's handler throwing mid-sweep never aborts the rest of the sweep", () => {
    it("still examines and records real violations for rows AFTER the throwing row", async () => {
      // ROW1 throws when looked up (simulates a corrupt pathsIndex entry
      // whose getter/proxy misbehaves); ROW2 is clean; ROW3 has a real
      // required-field violation. Both ROW2 and ROW3 come AFTER ROW1 in
      // childrenForPath's listing order, so if the sweep's per-row loop were
      // short-circuited by ROW1's throw, neither would ever be examined.
      const pathsIndex = {
        get: (p: string) => {
          if (p == NOTE_PATH) return { metadata: { property: HUB_REQUIRED } };
          if (p == ROW1) throw new Error("simulated corrupt row1 access");
          if (p == ROW2)
            return { metadata: { property: { model: "Widget B" } } };
          if (p == ROW3) return { metadata: { property: {} } };
          return undefined;
        },
      };
      const childrenForPath = jest
        .fn()
        .mockResolvedValue([NOTE_PATH, ROW1, ROW2, ROW3]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      await reconciler.sweepFolder(DB);

      // ROW1's own lookup threw -- never resolved to any violation entry (it
      // simply never got processed), but critically this must not have
      // stopped the loop.
      expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
      // ROW2, positioned AFTER the throwing row, was still examined and is
      // correctly clean -- proof the sweep did not abort at ROW1.
      expect(reconciler.getRowViolations(DB, ROW2)).toEqual([]);
      // ROW3, also after the throwing row, was still examined and got its
      // OWN real violation recorded -- proof the rest of the batch runs to
      // completion, not just "didn't crash".
      const row3violations = reconciler.getRowViolations(DB, ROW3);
      expect(row3violations).toHaveLength(1);
      expect(row3violations[0].code).toBe("required");
      expect(row3violations[0].field).toBe("model");

      // The D6 pass-empty-immunity diagnostic correctly accounts for exactly
      // the one row that was skipped by the exception, not the whole folder.
      const info = reconciler.getSweepIncomplete(DB);
      expect(info).toBeDefined();
      expect(info!.examinedRows).toBe(2); // ROW2 + ROW3
      expect(info!.expectedRows).toBe(3); // ROW1 + ROW2 + ROW3
    });

    it("a throwing row in the MIDDLE of a large batch does not prevent later rows from being pruned/updated correctly on the next sweep", async () => {
      // Establishes a clean baseline sweep, then a second sweep where a
      // middle row throws -- verifies the surrounding rows' state is still
      // correctly refreshed (not frozen/stale) despite the one failure.
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
        [ROW1, { metadata: { property: { model: "A" } } }],
        [ROW2, { metadata: { property: {} } }], // violates initially
        [ROW3, { metadata: { property: { model: "C" } } }],
      ]);
      const childrenForPath = jest
        .fn()
        .mockResolvedValue([NOTE_PATH, ROW1, ROW2, ROW3]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      await reconciler.sweepFolder(DB);
      expect(reconciler.getRowViolations(DB, ROW2)).toHaveLength(1);

      // ROW2 gets fixed AND pathsIndex.get itself now throws for ROW1 (some
      // other unrelated corruption) during the SECOND sweep.
      pathsIndex.set(ROW2, { metadata: { property: { model: "B" } } });
      const originalGet = pathsIndex.get.bind(pathsIndex);
      (pathsIndex as any).get = (p: string) => {
        if (p == ROW1) throw new Error("simulated mid-batch failure");
        return originalGet(p);
      };

      await reconciler.sweepFolder(DB);

      // ROW1 threw -- no violation entry either way (it had none before, and
      // the failed attempt must not fabricate one).
      expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
      // ROW2 (comes after ROW1) is still correctly refreshed to CLEAN despite
      // ROW1's failure moments earlier in the same sweep.
      expect(reconciler.getRowViolations(DB, ROW2)).toEqual([]);
      // ROW3 remains correctly clean too.
      expect(reconciler.getRowViolations(DB, ROW3)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // (b) Overlapping sweepFolder passes for the same folder
  // -------------------------------------------------------------------------

  describe("(b) two overlapping sweepFolder passes for the same folder do not corrupt or double-count the store", () => {
    it("running two concurrent sweeps of the SAME folder never doubles a row's violation entry", async () => {
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
        [ROW1, { metadata: { property: {} } }], // violates: missing model
        [ROW2, { metadata: { property: { model: "ok" } } }], // clean
      ]);
      const call1 = deferred<string[]>();
      const call2 = deferred<string[]>();
      const childrenForPath = jest
        .fn()
        .mockImplementationOnce(() => call1.promise)
        .mockImplementationOnce(() => call2.promise);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      // Fire two overlapping sweeps of the SAME db -- e.g. a vault-open
      // sweep (A) and a schema-change sweep (B) racing each other.
      const sweepA = reconciler.sweepFolder(DB);
      const sweepB = reconciler.sweepFolder(DB);

      call1.resolve([NOTE_PATH, ROW1, ROW2]);
      await sweepA;
      // B's own childrenForPath call only fires once A has fully settled
      // (sweepFolder serializes per dbPath) -- resolve it now with the SAME
      // listing, simulating two sweeps triggered close together over
      // unchanged data.
      call2.resolve([NOTE_PATH, ROW1, ROW2]);
      await sweepB;

      const dbViolations = reconciler.getDbViolations(DB);
      // Exactly one violating row, never duplicated/appended by the second
      // overlapping pass.
      expect(dbViolations.size).toBe(1);
      expect(dbViolations.get(ROW1)).toHaveLength(1);
      expect(reconciler.getRowViolations(DB, ROW2)).toEqual([]);

      // getViolationCount must be the literal sum of what's actually in the
      // store -- no phantom double count surviving the overlap.
      let expectedTotal = 0;
      for (const v of dbViolations.values()) expectedTotal += v.length;
      expect(reconciler.getViolationCount(DB)).toBe(expectedTotal);
      expect(childrenForPath).toHaveBeenCalledTimes(2);
    });

    it("an out-of-order-resolving overlapping pair never resurrects a ghost violation for a row deleted mid-flight", async () => {
      // The concrete hazard this test locks: sweep A (e.g. vault-open) takes
      // its own `childrenForPath` snapshot while ROW2 still exists; sweep B
      // (e.g. a schema-change sweep for the SAME db) is fired while A is
      // still in flight. ROW2 is deleted from the vault, and B's OWN
      // snapshot (taken after the deletion) correctly omits it -- but B's
      // underlying `childrenForPath` call happens to SETTLE before A's does.
      // If A's (now-stale) pass were free to run and record its results
      // AFTER B already reported ROW2 clean/gone, A would resurrect a ghost
      // `malformed-row` violation for the already-deleted row and nothing
      // would ever correct it -- exactly the "corrupted store" coverage
      // item (b) forbids. `sweepFolder` closes this by serializing per
      // dbPath: B's own pass cannot even START until A's fully settles, so
      // whichever pass finishes LAST (here, B) always has the final,
      // correcting word over the store -- see reconciler.ts's own comment
      // on `sweepFolder`.
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
        [ROW1, { metadata: { property: {} } }], // violates: missing model
        [ROW2, { metadata: { property: { model: "ok" } } }], // present, clean
      ]);
      const call1 = deferred<string[]>(); // A's own childrenForPath call
      const call2 = deferred<string[]>(); // B's own childrenForPath call
      const childrenForPath = jest
        .fn()
        .mockImplementationOnce(() => call1.promise)
        .mockImplementationOnce(() => call2.promise);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      const sweepA = reconciler.sweepFolder(DB);
      const sweepB = reconciler.sweepFolder(DB);

      // ROW2 deleted for real -- B's eventual (fresher) snapshot will
      // correctly omit it.
      pathsIndex.delete(ROW2);

      // B's underlying childrenForPath call resolves/settles FIRST (it may
      // simply be a faster/simpler folder listing), THEN A's resolves
      // SECOND with its STALE pre-deletion snapshot -- the precise
      // out-of-order completion this coverage item names.
      call2.resolve([NOTE_PATH, ROW1]);
      call1.resolve([NOTE_PATH, ROW1, ROW2]);
      await Promise.all([sweepA, sweepB]);

      // No ghost violation for the deleted row survives, no matter which
      // pass's snapshot was staler or which one settled first/last.
      expect(reconciler.getRowViolations(DB, ROW2)).toEqual([]);
      expect(reconciler.getDbViolations(DB).has(ROW2)).toBe(false);
      // Store still holds only ROW1's real, singular violation -- no
      // double-count either.
      const dbViolations = reconciler.getDbViolations(DB);
      expect(dbViolations.size).toBe(1);
      expect(dbViolations.get(ROW1)).toHaveLength(1);
    });

    it("does not throw and stays internally consistent when many sweeps of the same db are fired back-to-back", async () => {
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
        [ROW1, { metadata: { property: { model: "ok" } } }],
      ]);
      const childrenForPath = jest
        .fn()
        .mockResolvedValue([NOTE_PATH, ROW1]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      // Ten overlapping sweeps of the same db, fired without awaiting any of
      // them individually. If any rejected, this await itself would throw
      // and fail the test.
      const sweeps = Array.from({ length: 10 }, () =>
        reconciler.sweepFolder(DB)
      );
      await Promise.all(sweeps);

      // Store never holds an empty-array entry for a clean row (the store's
      // own documented contract: "Only ever holds NON-EMPTY arrays").
      expect(reconciler.getDbViolations(DB).size).toBe(0);
      expect(reconciler.getViolationCount(DB)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // (c) Rapid create-delete-create thrash before the debounce flushes
  // -------------------------------------------------------------------------

  describe("(c) rapid create-delete-create thrash of the same path never resurrects a stale violation", () => {
    it("only the FINAL incarnation's state is ever applied when create/delete cycles happen faster than the debounce window", async () => {
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      ]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
      });
      const reconciler = new Reconciler(superstate, {
        rowDebounceMs: 300,
        sweepDebounceMs: 1_000_000,
      });
      reconciler.start();

      // Incarnation 1: created, missing "model" (would violate).
      pathsIndex.set(ROW1, {
        metadata: { property: {} },
        spaces: [DB],
      });
      await superstate.eventsDispatcher.dispatchEvent("pathCreated", {
        path: ROW1,
      });

      // Deleted before the debounce fires.
      pathsIndex.delete(ROW1);
      await superstate.eventsDispatcher.dispatchEvent("pathDeleted", {
        path: ROW1,
      });

      // Incarnation 2: recreated at the SAME path, this time valid.
      pathsIndex.set(ROW1, {
        metadata: { property: { model: "Widget A" } },
        spaces: [DB],
      });
      await superstate.eventsDispatcher.dispatchEvent("pathCreated", {
        path: ROW1,
      });

      // Deleted again, still before the (still-pending) debounce fires.
      pathsIndex.delete(ROW1);
      await superstate.eventsDispatcher.dispatchEvent("pathDeleted", {
        path: ROW1,
      });

      // Incarnation 3 (final): recreated again, this time missing "model".
      pathsIndex.set(ROW1, {
        metadata: { property: {} },
        spaces: [DB],
      });
      await superstate.eventsDispatcher.dispatchEvent("pathCreated", {
        path: ROW1,
      });

      // Only NOW let the single coalesced debounce window elapse.
      jest.advanceTimersByTime(300);

      // The store must reflect exactly incarnation 3's real, CURRENT
      // violation -- never a ghost from either intermediate delete, and
      // never a stale "clean" reading left over from incarnation 2.
      const violations = reconciler.getRowViolations(DB, ROW1);
      expect(violations).toHaveLength(1);
      expect(violations[0].code).toBe("required");
      expect(violations[0].field).toBe("model");
      // Never a phantom malformed-row ghost from one of the deleted
      // intermediate incarnations.
      expect(violations.some((v) => v.code == "malformed-row")).toBe(false);

      reconciler.stop();
    });

    it("thrashing create/delete/create with NO final create leaves the row clean, not a ghost", async () => {
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      ]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
      });
      const reconciler = new Reconciler(superstate, {
        rowDebounceMs: 300,
        sweepDebounceMs: 1_000_000,
      });
      reconciler.start();

      // Created (violating), then deleted, then created again (violating),
      // then FINALLY deleted for good -- all inside one debounce window.
      pathsIndex.set(ROW1, { metadata: { property: {} }, spaces: [DB] });
      await superstate.eventsDispatcher.dispatchEvent("pathCreated", {
        path: ROW1,
      });
      pathsIndex.delete(ROW1);
      await superstate.eventsDispatcher.dispatchEvent("pathDeleted", {
        path: ROW1,
      });
      pathsIndex.set(ROW1, { metadata: { property: {} }, spaces: [DB] });
      await superstate.eventsDispatcher.dispatchEvent("pathCreated", {
        path: ROW1,
      });
      pathsIndex.delete(ROW1);
      await superstate.eventsDispatcher.dispatchEvent("pathDeleted", {
        path: ROW1,
      });

      jest.advanceTimersByTime(300);

      // The row was deleted for good -- no violation should ever surface for
      // a path that no longer exists, no matter how many times it thrashed
      // in and out of existence beforehand.
      expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
      expect(reconciler.getDbViolations(DB).size).toBe(0);

      reconciler.stop();
    });
  });

  // -------------------------------------------------------------------------
  // (d) stop() idempotency
  // -------------------------------------------------------------------------

  describe("(d) calling stop() twice is idempotent", () => {
    it("never throws when stopped twice, whether or not start() was ever called", () => {
      const superstate = makeSuperstate({ spacesIndex: dbSpacesIndex() });
      const reconciler = new Reconciler(superstate);

      // Never started at all -- stop() must still be a safe no-op.
      expect(() => reconciler.stop()).not.toThrow();
      expect(() => reconciler.stop()).not.toThrow();
    });

    it("never throws when stopped twice after start(), and events are ignored after either call", async () => {
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
        [ROW1, { metadata: { property: {} }, spaces: [DB] }],
      ]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
      });
      const reconciler = new Reconciler(superstate, {
        rowDebounceMs: 10,
        sweepDebounceMs: 1_000_000,
      });
      reconciler.start();

      expect(() => reconciler.stop()).not.toThrow();
      expect(() => reconciler.stop()).not.toThrow();
      expect(() => reconciler.stop()).not.toThrow();

      // Events dispatched after the (idempotent) double-stop must still be
      // fully ignored -- proves the second stop() didn't somehow re-arm or
      // corrupt listener bookkeeping.
      await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
        path: ROW1,
      });
      jest.advanceTimersByTime(10);
      expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
    });

    it("start() after a double-stop resumes normal event-driven revalidation", async () => {
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
        [ROW1, { metadata: { property: {} }, spaces: [DB] }],
      ]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
      });
      const reconciler = new Reconciler(superstate, {
        rowDebounceMs: 10,
        sweepDebounceMs: 1_000_000,
      });
      reconciler.start();
      reconciler.stop();
      reconciler.stop(); // idempotent double-stop

      reconciler.start(); // resume
      await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
        path: ROW1,
      });
      jest.advanceTimersByTime(10);

      expect(reconciler.getRowViolations(DB, ROW1)).toHaveLength(1);
      reconciler.stop();
    });
  });

  // -------------------------------------------------------------------------
  // (e) Multiple reference/unique fields wired independently per field
  // -------------------------------------------------------------------------

  describe("(e) a profile with multiple reference/unique fields resolves each independently", () => {
    const BOARDS_DB = "Gidi/Boards";
    const PARTS_DB = "Gidi/Parts";
    const BOARD_ROW = `${BOARDS_DB}/b1.md`;

    const HUB_MULTI = {
      schema_type: "notidian_type_profile",
      fields: {
        board_id: {
          kind: "text",
          reference: {
            targetFolder: BOARDS_DB,
            targetKey: "board_id",
            onBrokenWrite: "block",
            onReferencedChange: "warn",
          },
        },
        part_id: {
          kind: "text",
          reference: {
            targetFolder: PARTS_DB,
            targetKey: "part_id",
            onBrokenWrite: "warn",
            onReferencedChange: "warn",
          },
        },
        code: { kind: "text", unique: { scope: "database" } },
        serial: { kind: "text", unique: { scope: "database" } },
      },
    };

    it("resolves two reference fields against two DIFFERENT target folders independently (one broken, one valid)", async () => {
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_MULTI } }],
        [
          ROW1,
          {
            metadata: {
              property: { board_id: "B1", part_id: "P9", code: "C1", serial: "S1" },
            },
          },
        ],
        [BOARD_ROW, { metadata: { property: { board_id: "B1" } } }],
      ]);
      const contextsIndex = new Map<string, any>([
        [BOARDS_DB, { paths: [BOARD_ROW] }],
        // PARTS_DB deliberately has no matching row -- part_id "P9" is a
        // genuinely broken reference.
        [PARTS_DB, { paths: [] }],
        [
          DB,
          {
            contextTable: {
              rows: [
                {
                  [PathPropertyName]: ROW1,
                  board_id: "B1",
                  part_id: "P9",
                  code: "C1",
                  serial: "S1",
                },
              ],
            },
          },
        ],
      ]);
      const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        contextsIndex,
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      await reconciler.sweepFolder(DB);

      const violations = reconciler.getRowViolations(DB, ROW1);
      const refViolations = violations.filter((v) => v.code == "reference-broken");
      // Exactly ONE broken reference -- part_id, never board_id.
      expect(refViolations).toHaveLength(1);
      expect(refViolations[0].field).toBe("part_id");
      // part_id's own onBrokenWrite is "warn" -- proves the reconciler wired
      // THIS field's own reference config (not board_id's "block"), i.e. no
      // cross-field bleed in the severity derivation either.
      expect(refViolations[0].severity).toBe("warn");
      expect(
        violations.some((v) => v.field == "board_id" && v.code == "reference-broken")
      ).toBe(false);
    });

    it("resolves two unique fields independently (one collides, one does not) without cross-field bleed", async () => {
      const ROW2_LOCAL = `${DB}/row2.md`;
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_MULTI } }],
        [
          ROW1,
          {
            metadata: {
              property: { code: "C1", serial: "S1" },
            },
          },
        ],
        [
          ROW2_LOCAL,
          {
            metadata: {
              property: { code: "C2", serial: "S1" },
            },
          },
        ],
      ]);
      const contextsIndex = new Map<string, any>([
        [
          DB,
          {
            contextTable: {
              rows: [
                { [PathPropertyName]: ROW1, code: "C1", serial: "S1" },
                { [PathPropertyName]: ROW2_LOCAL, code: "C2", serial: "S1" },
              ],
            },
          },
        ],
      ]);
      const childrenForPath = jest
        .fn()
        .mockResolvedValue([NOTE_PATH, ROW1, ROW2_LOCAL]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        contextsIndex,
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      await reconciler.sweepFolder(DB);

      for (const rowPath of [ROW1, ROW2_LOCAL]) {
        const violations = reconciler.getRowViolations(DB, rowPath);
        const uniqueViolations = violations.filter((v) => v.code == "unique");
        // Both rows collide on "serial" (both "S1") -- exactly one unique
        // violation each, attributed to the correct field.
        expect(uniqueViolations).toHaveLength(1);
        expect(uniqueViolations[0].field).toBe("serial");
        // "code" values (C1 vs C2) are distinct -- never flagged, proving
        // the "serial" collision didn't bleed into the "code" field's own
        // independent uniqueness check.
        expect(violations.some((v) => v.field == "code" && v.code == "unique")).toBe(
          false
        );
      }
    });

    it("a fixed reference on one field and a persisting collision on a DIFFERENT unique field surface independently after a second sweep", async () => {
      const ROW2_LOCAL = `${DB}/row2.md`;
      const pathsIndex = new Map<string, any>([
        [NOTE_PATH, { metadata: { property: HUB_MULTI } }],
        [
          ROW1,
          {
            metadata: {
              property: { board_id: "B1", code: "C1", serial: "S1" },
            },
          },
        ],
        [
          ROW2_LOCAL,
          {
            metadata: {
              property: { code: "C2", serial: "S1" },
            },
          },
        ],
      ]);
      const contextsIndex = new Map<string, any>([
        // BOARDS_DB starts with NO matching row -- board_id "B1" is broken.
        [BOARDS_DB, { paths: [] }],
        [
          DB,
          {
            contextTable: {
              rows: [
                { [PathPropertyName]: ROW1, board_id: "B1", code: "C1", serial: "S1" },
                { [PathPropertyName]: ROW2_LOCAL, code: "C2", serial: "S1" },
              ],
            },
          },
        ],
      ]);
      const childrenForPath = jest
        .fn()
        .mockResolvedValue([NOTE_PATH, ROW1, ROW2_LOCAL]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: dbSpacesIndex(),
        contextsIndex,
        childrenForPath,
      });
      const reconciler = new Reconciler(superstate);

      await reconciler.sweepFolder(DB);
      let row1violations = reconciler.getRowViolations(DB, ROW1);
      expect(row1violations.some((v) => v.code == "reference-broken")).toBe(true);
      expect(row1violations.some((v) => v.code == "unique" && v.field == "serial")).toBe(
        true
      );

      // Fix ONLY the reference (add a matching board row) -- the unrelated
      // "serial" unique collision must persist independently, untouched.
      const targetRow = `${BOARDS_DB}/b1.md`;
      pathsIndex.set(targetRow, { metadata: { property: { board_id: "B1" } } });
      contextsIndex.set(BOARDS_DB, { paths: [targetRow] });

      await reconciler.sweepFolder(DB);
      row1violations = reconciler.getRowViolations(DB, ROW1);
      expect(row1violations.some((v) => v.code == "reference-broken")).toBe(false);
      // The independent unique-field violation on "serial" survives the
      // unrelated reference fix -- proof the two checks are wired to
      // resolve fully independently per field, not sharing any incidental
      // state.
      expect(row1violations.some((v) => v.code == "unique" && v.field == "serial")).toBe(
        true
      );
    });
  });
});
