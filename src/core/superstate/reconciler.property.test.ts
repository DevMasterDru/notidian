// ===========================================================================
// PROPERTY NET for the reconciler engine (Notidian-dj93, ADR-0057 D2-D6).
//
// The reconciler (reconciler.ts) is the event-driven revalidation + full-sweep
// + in-memory violation-store engine of the Data Integrity Program. It already
// carries an example-based suite (reconciler.test.ts) and a targeted
// fault-tolerance/concurrency suite (reconciler.adversarial.test.ts). This file
// adds the seeded PROPERTY net those two never state as invariants — over
// RANDOMIZED populations of schemas, rows, and violation states, using the
// house mulberry32-seeded / no-fast-check / characterization pattern
// (tableRollup.property.test.ts, validateRow.property.test.ts). Four properties:
//
//   TOTAL       a full sweep (runFullSweep) never throws or rejects over ANY
//               population — arbitrary schemas, rows, throwing pathsIndex
//               getters, rejecting / garbage-returning childrenForPath, ghost
//               (index-lag) rows, non-.md junk. The event path (start() + an
//               arbitrary sequence of dispatched events flushed through the
//               debounces) is likewise total.
//   STABLE      the SAME population (rebuilt from the same seed) yields the
//               SAME violation store, every time — the engine is deterministic:
//               no Date.now / Math.random / hidden global state leaks into the
//               store's contents.
//   IDEMPOTENT  running the sweep TWICE with no intervening mutation yields a
//               byte-identical store — no drift, no duplicated violations, no
//               phantom clears, and the store's own "only NON-EMPTY arrays"
//               contract still holds.
//   EVENT-VS-   single-path event revalidation (the incremental debounced path)
//   SWEEP       of a changed path produces EXACTLY the violation set a full
//   CONVERGENCE sweep assigns to that same path — the two entry points agree
//               per row, over the SAME live superstate.
//
// CHARACTERIZATION, NOT CORRECTION. Every assertion LOCKS the current observed
// behaviour of the live engine; no production code is changed. One genuine,
// by-design event-vs-sweep divergence is surfaced and pinned as an explicit
// characterization (a vault-listed row that pathsIndex has no entry for is
// caught only by the sweep — the event path structurally cannot fire for a
// never-indexed path); a follow-up bead records it rather than "fixing" it.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency; fake timers exactly as reconciler.test.ts / .adversarial.test.ts.
// ===========================================================================

import { PathPropertyName } from "shared/types/context";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { Reconciler } from "./reconciler";

// --- tiny deterministic PRNG (no external dep) -----------------------------
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: () => number, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];

// ---------------------------------------------------------------------------
// Superstate mock (mirrors reconciler.test.ts's own factory: the reconciler
// only ever reads `pathsIndex.get`, iterates `spacesIndex`, reads
// `contextsIndex.get`, and awaits `spaceManager.childrenForPath`).
// ---------------------------------------------------------------------------

function makeSuperstate(parts: {
  pathsIndex: any;
  spacesIndex: Map<string, any>;
  contextsIndex: Map<string, any>;
  childrenForPath: (dbPath: string, kind: string) => Promise<any>;
}) {
  return {
    eventsDispatcher: new EventDispatcher(),
    pathsIndex: parts.pathsIndex,
    spacesIndex: parts.spacesIndex,
    contextsIndex: parts.contextsIndex,
    spaceManager: { childrenForPath: parts.childrenForPath },
  } as any;
}

// ---------------------------------------------------------------------------
// Reference target folder (shared shape): resolveKeyMatch reads
// contextsIndex.get(targetFolder).paths, then pathsIndex.get(path).metadata
// .property[targetKey]. Seed three keys so a row's `board_id` in {K1,K2,K3}
// resolves and anything else is a broken reference.
// ---------------------------------------------------------------------------

const TARGET_DB = "Refs/Targets";
const TARGET_KEY = "key";
const TARGET_KEYS = ["K1", "K2", "K3"] as const;

const seedTargetFolder = (
  pathsIndex: Map<string, any>,
  contextsIndex: Map<string, any>
): void => {
  const paths = TARGET_KEYS.map((_k, i) => `${TARGET_DB}/t${i}.md`);
  paths.forEach((tp, i) =>
    pathsIndex.set(tp, { metadata: { property: { [TARGET_KEY]: TARGET_KEYS[i] } } })
  );
  contextsIndex.set(TARGET_DB, { paths });
};

// ---------------------------------------------------------------------------
// Schema pool: every valid profile shape exercising a distinct violation
// class. Authored as RAW hub-note frontmatter (schema_type + fields/invariants)
// so it flows through the real parseTypeProfile the reconciler calls.
// ---------------------------------------------------------------------------

const PROFILE_REQUIRED_ENUM_PATTERN = {
  schema_type: "notidian_type_profile",
  fields: {
    model: { kind: "text", required: true },
    status: { kind: "select", enum: { values: ["open", "done"], strict: true } },
    code: { kind: "text", pattern: "^[A-Z]{2}[0-9]+$" },
  },
};

const PROFILE_UNIQUE_TITLE_EMPTY = {
  schema_type: "notidian_type_profile",
  fields: {
    name: { kind: "text", title_binding: true },
    sku: { kind: "text", unique: { scope: "database" } },
    note: { kind: "text", empty: "absent" },
  },
};

const PROFILE_REFERENCE_TYPE_INVARIANT = {
  schema_type: "notidian_type_profile",
  fields: {
    board_id: {
      kind: "text",
      reference: {
        targetFolder: TARGET_DB,
        targetKey: TARGET_KEY,
        onBrokenWrite: "block",
        onReferencedChange: "warn",
      },
    },
    qty: { kind: "number" },
    used: { kind: "number" },
  },
  invariants: [
    {
      require: [{ field: "qty", fn: "isNotEmpty", value: "", fType: "literal" }],
      severity: "error",
      message: "qty is required by database invariant",
    },
  ],
};

const PROFILE_MULTI = {
  schema_type: "notidian_type_profile",
  fields: {
    board_id: {
      kind: "text",
      reference: {
        targetFolder: TARGET_DB,
        targetKey: TARGET_KEY,
        onBrokenWrite: "warn",
        onReferencedChange: "warn",
      },
    },
    sku: { kind: "text", unique: { scope: "database" } },
    name: { kind: "text", title_binding: true },
    model: { kind: "text", required: true },
  },
};

// Fields-empty but invariant-bearing profile: parseTypeProfile returns a
// profile (NOT null) with a `missing-fields` issue, and the invariant names an
// UNDECLARED field -> the reconciler's fail-closed (error-severity) invariant
// path fires for every plain-object row. Locks that the sweep still validates
// a fields-empty schema instead of treating it as "no schema".
const PROFILE_INVARIANT_ONLY = {
  schema_type: "notidian_type_profile",
  invariants: [
    {
      require: [{ field: "ghost", fn: "isNotEmpty", value: "", fType: "literal" }],
      severity: "error",
      message: "fail-closed invariant over an undeclared field",
    },
  ],
};

const VALID_PROFILES = [
  PROFILE_REQUIRED_ENUM_PATTERN,
  PROFILE_UNIQUE_TITLE_EMPTY,
  PROFILE_REFERENCE_TYPE_INVARIANT,
  PROFILE_MULTI,
  PROFILE_INVARIANT_ONLY,
] as const;

// ---------------------------------------------------------------------------
// Row atom pool: each row is either a plain-object frontmatter ("fm") or a
// broken-frontmatter variant ("broken") that must resolve to exactly one
// malformed-row violation. Two atoms share `sku: "DUP"` so uniqueness
// collisions actually fire; several exercise type/enum/pattern/title/empty/
// reference paths.
// ---------------------------------------------------------------------------

type RowAtom =
  | { kind: "fm"; value: Record<string, unknown> }
  | { kind: "broken"; variant: "absent" | "null" | "array" | "scalar" };

const ROW_ATOMS: readonly RowAtom[] = [
  { kind: "fm", value: {} },
  {
    kind: "fm",
    value: {
      model: "M1",
      status: "open",
      code: "AB12",
      sku: "S1",
      note: "n",
      name: "row0",
      board_id: "K1",
      qty: 5,
      used: 2,
    },
  },
  { kind: "fm", value: { status: "bogus" } },
  { kind: "fm", value: { code: "bad code" } },
  { kind: "fm", value: { name: "Mismatch" } },
  { kind: "fm", value: { note: null } },
  { kind: "fm", value: { note: "" } },
  { kind: "fm", value: { sku: "DUP", model: "MX" } },
  { kind: "fm", value: { sku: "DUP", model: "MY" } },
  { kind: "fm", value: { qty: "notanumber", used: -3, model: "MZ" } },
  { kind: "fm", value: { board_id: "NOPE", model: "MB" } },
  { kind: "fm", value: { board_id: "K2", qty: 0, model: "MC", name: "row1" } },
  { kind: "fm", value: { status: ["open", "bogus"], model: "MD" } },
  { kind: "broken", variant: "absent" },
  { kind: "broken", variant: "null" },
  { kind: "broken", variant: "array" },
  { kind: "broken", variant: "scalar" },
] as const;

// Materialize one row atom into (a) a pathsIndex entry and (b) a
// contextsIndex.contextTable row (the sibling snapshot uniqueness reads). Every
// row ALWAYS gets a pathsIndex entry carrying `spaces: [dbPath]` when
// `withSpaces` — this is what lets the incremental event path route it (the
// event path derives its db set from `pathsIndex.get(path).spaces`); a broken
// variant still has an entry, only its `.metadata.property` is absent/garbage.
const applyRowAtom = (
  pathsIndex: Map<string, any>,
  contextRows: Array<Record<string, unknown>>,
  dbPath: string,
  rowPath: string,
  atom: RowAtom,
  withSpaces: boolean
): void => {
  const spaces = withSpaces ? { spaces: [dbPath] } : {};
  if (atom.kind === "fm") {
    pathsIndex.set(rowPath, { metadata: { property: atom.value }, ...spaces });
    contextRows.push({ [PathPropertyName]: rowPath, ...atom.value });
    return;
  }
  const property =
    atom.variant === "null"
      ? null
      : atom.variant === "array"
      ? ["x", "y"]
      : atom.variant === "scalar"
      ? 7
      : undefined;
  const metadata = atom.variant === "absent" ? {} : { property };
  pathsIndex.set(rowPath, { metadata, ...spaces });
  contextRows.push({ [PathPropertyName]: rowPath });
};

// ---------------------------------------------------------------------------
// CONVERGENCE population: ONE schema'd db, a valid profile, a TOTAL pathsIndex
// (a Map that never throws), every row wired with `spaces: [DB]`. childrenForPath
// returns exactly [notePath, ...rowPaths] so the sweep examines precisely the
// rows the event path can route. Shared by both entry points.
// ---------------------------------------------------------------------------

const buildConvergencePopulation = (rng: () => number) => {
  const DB = "Conv/DB";
  const notePath = `${DB}/hub.md`;
  const profile = pick(rng, VALID_PROFILES);

  const pathsIndex = new Map<string, any>();
  const contextsIndex = new Map<string, any>();
  seedTargetFolder(pathsIndex, contextsIndex);
  pathsIndex.set(notePath, { metadata: { property: profile } });

  const rowPaths: string[] = [];
  const contextRows: Array<Record<string, unknown>> = [];
  const numRows = randInt(rng, 0, 6);
  for (let i = 0; i < numRows; i++) {
    const rowPath = `${DB}/row${i}.md`;
    rowPaths.push(rowPath);
    applyRowAtom(pathsIndex, contextRows, DB, rowPath, pick(rng, ROW_ATOMS), true);
  }
  contextsIndex.set(DB, { contextTable: { rows: contextRows } });

  const childrenForPath = async (dbPath: string) =>
    dbPath === DB ? [notePath, ...rowPaths] : [];

  const superstate = makeSuperstate({
    pathsIndex,
    spacesIndex: new Map([[DB, { space: { path: DB, notePath } }]]),
    contextsIndex,
    childrenForPath,
  });
  return { superstate, DB, notePath, rowPaths };
};

// ---------------------------------------------------------------------------
// ADVERSARIAL population: multiple dbs of mixed kinds — valid profiles, a
// non-profile hub, throwing pathsIndex getters, a rejecting childrenForPath, a
// garbage (non-array) childrenForPath return, ghost (index-lag) rows, and
// non-.md junk in the listing. Fully deterministic from the seed, so it also
// underpins STABLE / IDEMPOTENT (every random choice is fixed at build time and
// re-used identically across repeated sweeps).
// ---------------------------------------------------------------------------

type EventName =
  | "pathStateUpdated"
  | "pathCreated"
  | "pathDeleted"
  | "pathChanged"
  | "superstateUpdated";

const buildAdversarialPopulation = (
  rng: () => number,
  options: { allowThrowingRows?: boolean } = {}
) => {
  const allowThrowingRows = options.allowThrowingRows ?? true;
  const realPaths = new Map<string, any>();
  const throwPaths = new Set<string>();
  const spacesIndex = new Map<string, any>();
  const contextsIndex = new Map<string, any>();
  const childrenBehaviors = new Map<string, () => Promise<any>>();
  const eventPaths: string[] = ["plain.txt", "Adv/nonexistent.md"];

  seedTargetFolder(realPaths, contextsIndex);

  const numDbs = randInt(rng, 1, 5);
  for (let d = 0; d < numDbs; d++) {
    const DB = `Adv/DB${d}`;
    const notePath = `${DB}/hub.md`;
    eventPaths.push(notePath);
    const kind = pick(rng, [
      "profile",
      "profile",
      "profile-reject",
      "throw-rows",
      "non-profile",
      "garbage-children",
    ] as const);
    const profile = pick(rng, VALID_PROFILES);

    realPaths.set(
      notePath,
      kind === "non-profile"
        ? { metadata: { property: { title: "not a profile at all" } } }
        : { metadata: { property: profile } }
    );
    spacesIndex.set(DB, { space: { path: DB, notePath } });

    const rowPaths: string[] = [];
    const contextRows: Array<Record<string, unknown>> = [];
    const numRows = randInt(rng, 0, 5);
    for (let i = 0; i < numRows; i++) {
      const rowPath = `${DB}/row${i}.md`;
      rowPaths.push(rowPath);
      eventPaths.push(rowPath);
      applyRowAtom(realPaths, contextRows, DB, rowPath, pick(rng, ROW_ATOMS), true);
      if (allowThrowingRows && kind === "throw-rows" && rng() < 0.5)
        throwPaths.add(rowPath);
    }
    // Ghost: vault-listed but never indexed (D4 index-lag) — sweep-only signal.
    if (rng() < 0.3) rowPaths.push(`${DB}/ghost.md`);
    // Non-.md junk the sweep's own filter must drop.
    if (rng() < 0.3) rowPaths.push(`${DB}/note.txt`);
    contextsIndex.set(DB, { contextTable: { rows: contextRows } });

    if (kind === "profile-reject") {
      childrenBehaviors.set(DB, () =>
        Promise.reject(new Error("adapter I/O failure"))
      );
    } else if (kind === "garbage-children") {
      const junk = pick(rng, [null, 42, "oops", undefined] as const);
      childrenBehaviors.set(DB, () => Promise.resolve(junk));
    } else {
      const listing = [notePath, ...rowPaths];
      childrenBehaviors.set(DB, () => Promise.resolve(listing));
    }
  }

  const pathsIndex = {
    get: (p: string) => {
      if (throwPaths.has(p)) throw new Error("simulated corrupt pathsIndex access");
      return realPaths.get(p);
    },
  };
  const childrenForPath = async (dbPath: string) => {
    const beh = childrenBehaviors.get(dbPath);
    return beh ? beh() : [];
  };

  const superstate = makeSuperstate({
    pathsIndex,
    spacesIndex,
    contextsIndex,
    childrenForPath,
  });
  return { superstate, eventPaths: [...eventPaths, ...throwPaths] };
};

// ---------------------------------------------------------------------------
// Store snapshotters (canonical, order-independent across dbs/rows).
// ---------------------------------------------------------------------------

const perDbRows = (r: Reconciler, dbPath: string): Record<string, unknown> => {
  const rows = r.getDbViolations(dbPath);
  const obj: Record<string, unknown> = {};
  for (const rowPath of [...rows.keys()].sort()) obj[rowPath] = rows.get(rowPath);
  return obj;
};

const snapshotStore = (r: Reconciler): string => {
  const out: Record<string, unknown> = {};
  for (const db of r.getAllDbPaths().sort()) {
    out[db] = { rows: perDbRows(r, db), sweep: r.getSweepIncomplete(db) ?? null };
  }
  return JSON.stringify(out);
};

const PROPERTY_RUNS = 200;

// ===========================================================================
describe("Reconciler property net (Notidian-dj93)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // TOTAL
  // -------------------------------------------------------------------------

  describe("TOTAL", () => {
    it("runFullSweep never throws or rejects over any adversarial population", async () => {
      const rng = makeRng(0x707a11);
      for (let run = 0; run < PROPERTY_RUNS; run++) {
        const { superstate } = buildAdversarialPopulation(rng);
        const reconciler = new Reconciler(superstate);
        await expect(reconciler.runFullSweep()).resolves.toBeUndefined();
        // Running it AGAIN (over the same still-adversarial population) must
        // also stay total — no wedged sweep chain, no throw on the retry.
        await expect(reconciler.runFullSweep()).resolves.toBeUndefined();
      }
    });

    it("the event path is total over an INDEXED adversarial population: no handler ever throws, no sweep escapes", async () => {
      // Faithful production totality claim: over an arbitrary sequence of
      // real dispatched events (create/update/delete/rename/vault-open) against
      // rejecting / garbage-returning childrenForPath dbs, malformed
      // frontmatter, ghost + non-.md listing entries, and multi-space rows, the
      // reconciler's own handlers never throw and every scheduled async sweep
      // is internally contained. `allowThrowingRows: false` keeps pathsIndex.get
      // itself total (a Map-backed index, as in production) so this proves the
      // RECONCILER is total, not merely that the dispatcher swallows a throw —
      // asserted by spying console.error (the dispatcher's only tell that a
      // listener threw) and requiring it was never called.
      const eventNames: readonly EventName[] = [
        "pathStateUpdated",
        "pathCreated",
        "pathDeleted",
        "pathChanged",
        "superstateUpdated",
      ];
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      try {
        const rng = makeRng(0x0741e5);
        for (let run = 0; run < PROPERTY_RUNS / 2; run++) {
          const { superstate, eventPaths } = buildAdversarialPopulation(rng, {
            allowThrowingRows: false,
          });
          const reconciler = new Reconciler(superstate);
          let threw = false;
          errorSpy.mockClear();
          try {
            reconciler.start();
            const numEvents = randInt(rng, 1, 10);
            for (let e = 0; e < numEvents; e++) {
              const name = pick(rng, eventNames);
              const path = pick(rng, eventPaths);
              if (name === "superstateUpdated") {
                await superstate.eventsDispatcher.dispatchEvent(name, null);
              } else if (name === "pathChanged") {
                await superstate.eventsDispatcher.dispatchEvent(name, {
                  path,
                  newPath: pick(rng, eventPaths),
                });
              } else {
                await superstate.eventsDispatcher.dispatchEvent(name, { path });
              }
            }
            // Flush every debounce (row 300ms, sweep 500ms, startup sweep) and
            // every async sweep the events scheduled — including over the
            // rejecting / garbage-returning dbs.
            await jest.advanceTimersByTimeAsync(3000);
          } catch {
            threw = true;
          } finally {
            reconciler.stop();
          }
          expect(threw).toBe(false);
          // No listener threw (the dispatcher never had to console.error) and
          // no async sweep leaked an unhandled rejection into it either.
          expect(errorSpy).not.toHaveBeenCalled();
        }
      } finally {
        errorSpy.mockRestore();
      }
    });

    // FIXED (Notidian-erb0 — was a PINNED asymmetry): the sweep path
    // fault-isolates EVERY row (a per-row try/catch — reconciler.adversarial's
    // coverage item (a)), and `handlePathEvent` now does the same. A
    // corrupt/proxy pathsIndex whose getter throws is caught + logged INSIDE
    // the reconciler's own synchronous handler, so it no longer relies on the
    // makemd EventDispatcher's per-listener try/catch as its ONLY containment.
    // Still defensive-depth-only (Map.get can't throw in production) and low
    // severity, but the isolation is now symmetric with the sweep path —
    // closing the sweep(fault-isolated)-vs-event(unguarded) asymmetry.
    it("swallows + logs a corrupt pathsIndex.get during event handling inside its own handler (self-isolated, not merely caught by the dispatcher)", async () => {
      const DB = "Adv/DB0";
      const notePath = `${DB}/hub.md`;
      const ROW = `${DB}/row0.md`;
      const superstate = makeSuperstate({
        pathsIndex: {
          get: (p: string) => {
            if (p === ROW) throw new Error("simulated corrupt pathsIndex access");
            if (p === notePath)
              return { metadata: { property: PROFILE_REQUIRED_ENUM_PATTERN } };
            return undefined;
          },
        },
        spacesIndex: new Map([[DB, { space: { path: DB, notePath } }]]),
        contextsIndex: new Map(),
        childrenForPath: async () => [notePath, ROW],
      });
      const reconciler = new Reconciler(superstate, {
        rowDebounceMs: 10,
        sweepDebounceMs: 10_000_000,
      });
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      try {
        reconciler.start();
        // The event dispatch still resolves (never rejects to the caller)...
        await expect(
          superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
            path: ROW,
          })
        ).resolves.not.toThrow();
        // ...but now because the RECONCILER's own handler caught and logged the
        // throw, not because the dispatcher swallowed one that escaped.
        expect(errorSpy).toHaveBeenCalled();
        // Proof of self-isolation: the dispatcher's per-listener guard (which
        // logs `Error in listener for event ...`) was NEVER triggered, because
        // the handler never threw out to it. Against the pre-fix code this
        // assertion fails — the throw escaped and the dispatcher was the only
        // thing that caught it.
        const dispatcherCaught = errorSpy.mock.calls.some(
          (args) =>
            typeof args[0] === "string" &&
            args[0].startsWith("Error in listener for event")
        );
        expect(dispatcherCaught).toBe(false);
      } finally {
        reconciler.stop();
        errorSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // STABLE
  // -------------------------------------------------------------------------

  describe("STABLE", () => {
    it("the same adversarial population (rebuilt from the same seed) yields the same store", async () => {
      const master = makeRng(0x57ab1e);
      for (let run = 0; run < PROPERTY_RUNS; run++) {
        const seed = (master() * 0xffffffff) >>> 0;
        const a = buildAdversarialPopulation(makeRng(seed));
        const b = buildAdversarialPopulation(makeRng(seed));
        const rA = new Reconciler(a.superstate);
        const rB = new Reconciler(b.superstate);
        await rA.runFullSweep();
        await rB.runFullSweep();
        expect(snapshotStore(rA)).toBe(snapshotStore(rB));
      }
    });

    it("the same convergence population (rebuilt from the same seed) yields the same store", async () => {
      const master = makeRng(0x57ab2e);
      for (let run = 0; run < PROPERTY_RUNS; run++) {
        const seed = (master() * 0xffffffff) >>> 0;
        const a = buildConvergencePopulation(makeRng(seed));
        const b = buildConvergencePopulation(makeRng(seed));
        const rA = new Reconciler(a.superstate);
        const rB = new Reconciler(b.superstate);
        await rA.sweepFolder(a.DB);
        await rB.sweepFolder(b.DB);
        expect(snapshotStore(rA)).toBe(snapshotStore(rB));
      }
    });
  });

  // -------------------------------------------------------------------------
  // IDEMPOTENT
  // -------------------------------------------------------------------------

  describe("IDEMPOTENT", () => {
    it("sweeping twice with no mutation is a byte-identical no-op (no drift/dupes/phantom clears)", async () => {
      const rng = makeRng(0x1de3f0);
      for (let run = 0; run < PROPERTY_RUNS; run++) {
        const { superstate } = buildAdversarialPopulation(rng);
        const reconciler = new Reconciler(superstate);

        await reconciler.runFullSweep();
        const first = snapshotStore(reconciler);
        await reconciler.runFullSweep();
        const second = snapshotStore(reconciler);
        // A third, for good measure — idempotency must not be a one-shot.
        await reconciler.runFullSweep();
        const third = snapshotStore(reconciler);

        expect(second).toBe(first);
        expect(third).toBe(first);

        // Store contract: it NEVER holds an empty-array entry (a clean row has
        // no entry at all) — a phantom clear or a drifted empty would break
        // this even where the snapshot string still matched by accident.
        for (const db of reconciler.getAllDbPaths()) {
          for (const violations of reconciler.getDbViolations(db).values()) {
            expect(violations.length).toBeGreaterThan(0);
          }
          // getViolationCount is exactly the literal sum of stored violations
          // (+1 for a sweep-incomplete flag) — no phantom double count.
          let expected = reconciler.getSweepIncomplete(db) ? 1 : 0;
          for (const violations of reconciler.getDbViolations(db).values())
            expected += violations.length;
          expect(reconciler.getViolationCount(db)).toBe(expected);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // EVENT-VS-SWEEP CONVERGENCE
  // -------------------------------------------------------------------------

  describe("EVENT-VS-SWEEP CONVERGENCE", () => {
    it("single-path event revalidation yields exactly the sweep's per-path violation set", async () => {
      const rng = makeRng(0xc0efec);
      for (let run = 0; run < PROPERTY_RUNS; run++) {
        const { superstate, DB, rowPaths } = buildConvergencePopulation(rng);

        // SWEEP path: the batch entry point, run directly over the population.
        const sweepReconciler = new Reconciler(superstate);
        await sweepReconciler.sweepFolder(DB);

        // EVENT path: the incremental entry point, over the SAME live
        // superstate. A huge sweepDebounce guarantees start()'s own defensive
        // startup sweep never fires within our advances, so this store is
        // populated PURELY by single-path event revalidation.
        const eventReconciler = new Reconciler(superstate, {
          rowDebounceMs: 10,
          sweepDebounceMs: 10_000_000,
        });
        eventReconciler.start();
        for (const rowPath of rowPaths) {
          await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
            path: rowPath,
          });
          // Flush this single row's debounced revalidation on its own — a
          // genuine single-changed-path revalidation, not a batch.
          jest.advanceTimersByTime(10);
        }

        // The two entry points must agree on EVERY path's violation set, and on
        // WHICH rows violate at all (identical key set) — event == sweep.
        expect(JSON.stringify(perDbRows(eventReconciler, DB))).toBe(
          JSON.stringify(perDbRows(sweepReconciler, DB))
        );
        for (const rowPath of rowPaths) {
          expect(eventReconciler.getRowViolations(DB, rowPath)).toEqual(
            sweepReconciler.getRowViolations(DB, rowPath)
          );
        }
        eventReconciler.stop();
      }
    });

    // PINNED by-design divergence (characterization; follow-up bead filed): a
    // row present in the vault LISTING but ABSENT from pathsIndex (a
    // never-indexed / index-lag file, D4's raison d'être) is caught only by the
    // SWEEP — the sweep enumerates the folder's real files, sees no frontmatter
    // projection, and records a malformed-row violation. The EVENT path cannot
    // reach it at all: superstate never dispatches a path event for a file it
    // has not indexed, and even a synthetic event would route to zero dbs
    // (`pathsIndex.get(path)?.spaces` is undefined). The sweep is therefore the
    // deliberate backstop, NOT a bug — pinned, not "fixed".
    it("PINS the one by-design divergence: a never-indexed vault row is caught by the sweep but is unroutable by the event path", async () => {
      const DB = "Conv/DB";
      const notePath = `${DB}/hub.md`;
      const GHOST = `${DB}/ghost.md`; // vault-listed, NO pathsIndex entry.

      const pathsIndex = new Map<string, any>([
        [notePath, { metadata: { property: PROFILE_REQUIRED_ENUM_PATTERN } }],
      ]);
      const contextsIndex = new Map<string, any>([
        [DB, { contextTable: { rows: [] } }],
      ]);
      const superstate = makeSuperstate({
        pathsIndex,
        spacesIndex: new Map([[DB, { space: { path: DB, notePath } }]]),
        contextsIndex,
        childrenForPath: async () => [notePath, GHOST],
      });

      // SWEEP catches the ghost as a malformed-row (its own D4 backstop).
      const sweepReconciler = new Reconciler(superstate);
      await sweepReconciler.sweepFolder(DB);
      const swept = sweepReconciler.getRowViolations(DB, GHOST);
      expect(swept).toHaveLength(1);
      expect(swept[0].code).toBe("malformed-row");

      // EVENT path: even force-dispatching an event for the ghost routes it to
      // zero dbs (no pathsIndex entry -> no `spaces`) -> nothing recorded.
      const eventReconciler = new Reconciler(superstate, {
        rowDebounceMs: 10,
        sweepDebounceMs: 10_000_000,
      });
      eventReconciler.start();
      await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
        path: GHOST,
      });
      jest.advanceTimersByTime(10);
      expect(eventReconciler.getRowViolations(DB, GHOST)).toEqual([]);
      eventReconciler.stop();
    });
  });
});
