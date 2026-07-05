import { PathPropertyName } from "shared/types/context";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { Reconciler } from "./reconciler";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DB = "Gidi/Widgets";
const NOTE_PATH = `${DB}/Widgets.md`;
const ROW1 = `${DB}/row1.md`;
const ROW2 = `${DB}/row2.md`;

const HUB_REQUIRED = {
  schema_type: "notidian_type_profile",
  fields: {
    model: { kind: "text", required: true },
  },
};

const HUB_UNIQUE = {
  schema_type: "notidian_type_profile",
  fields: {
    code: { kind: "text", unique: { scope: "database" } },
  },
};

const TARGET_DB = "Gidi/Boards";
const TARGET_ROW = `${TARGET_DB}/b1.md`;
const HUB_REFERENCE = {
  schema_type: "notidian_type_profile",
  fields: {
    board_id: {
      kind: "text",
      reference: {
        targetFolder: TARGET_DB,
        targetKey: "board_id",
        onBrokenWrite: "block",
        onReferencedChange: "warn",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Mock superstate factory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Reconciler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Incremental revalidation + debounce (event-driven)
  // -------------------------------------------------------------------------

  it("revalidates a row via pathStateUpdated (debounced) and clears the violation once fixed", async () => {
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

    await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
      path: ROW1,
    });
    // Not yet applied -- still debouncing.
    expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);

    jest.advanceTimersByTime(10);
    const violations = reconciler.getRowViolations(DB, ROW1);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("required");
    expect(violations[0].field).toBe("model");

    // Fix the row and re-dispatch.
    pathsIndex.set(ROW1, {
      metadata: { property: { model: "Widget A" } },
      spaces: [DB],
    });
    await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
      path: ROW1,
    });
    jest.advanceTimersByTime(10);

    expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
    reconciler.stop();
  });

  it("coalesces a burst of events for the same row into a single revalidation", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: { model: "x" } }, spaces: [DB] }],
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
    const spy = jest.spyOn(reconciler as any, "revalidateRow");

    for (let i = 0; i < 5; i++) {
      await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
        path: ROW1,
      });
    }
    expect(spy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10);
    expect(spy).toHaveBeenCalledTimes(1);
    reconciler.stop();
  });

  it("stops reacting to events once stopped", async () => {
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

    await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
      path: ROW1,
    });
    jest.advanceTimersByTime(10);
    expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
  });

  it("clears a row's stored violations when the file is deleted", async () => {
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

    await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
      path: ROW1,
    });
    jest.advanceTimersByTime(10);
    expect(reconciler.getRowViolations(DB, ROW1)).toHaveLength(1);

    await superstate.eventsDispatcher.dispatchEvent("pathDeleted", {
      path: ROW1,
    });
    expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
    reconciler.stop();
  });

  it("triggers a full sweep of its own db on a hub-note edit (schema change), not a row revalidation of the hub note", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: {} }, spaces: [DB] }],
    ]);
    const childrenForPath = jest
      .fn()
      .mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate, {
      rowDebounceMs: 1_000_000,
      sweepDebounceMs: 10,
    });
    reconciler.start();
    // Let the automatic startup sweep (scheduled inside start()) settle first
    // so it doesn't get conflated with the hub-note-triggered sweep below.
    await jest.advanceTimersByTimeAsync(10);
    childrenForPath.mockClear();

    await superstate.eventsDispatcher.dispatchEvent("pathStateUpdated", {
      path: NOTE_PATH,
    });
    await jest.advanceTimersByTimeAsync(10);

    expect(childrenForPath).toHaveBeenCalledWith(DB, "file");
    expect(reconciler.getRowViolations(DB, ROW1)).toHaveLength(1);
    // The hub note itself is schema, never a data row.
    expect(reconciler.getRowViolations(DB, NOTE_PATH)).toEqual([]);
    reconciler.stop();
  });

  it("triggers a full sweep of every schema'd folder on superstateUpdated (vault open)", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: {} }, spaces: [DB] }],
    ]);
    const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate, {
      rowDebounceMs: 1_000_000,
      sweepDebounceMs: 10,
    });
    reconciler.start();
    await jest.advanceTimersByTimeAsync(10); // settle the automatic startup sweep.
    childrenForPath.mockClear();

    await superstate.eventsDispatcher.dispatchEvent("superstateUpdated", null);
    await jest.advanceTimersByTimeAsync(10);

    expect(childrenForPath).toHaveBeenCalledWith(DB, "file");
    expect(reconciler.getRowViolations(DB, ROW1)).toHaveLength(1);
    reconciler.stop();
  });

  // -------------------------------------------------------------------------
  // Sweeps (direct calls -- same production code the debounced flush calls)
  // -------------------------------------------------------------------------

  it("sweepFolder validates every row the vault listing reports, excluding the hub note", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: { model: "Widget A" } } }],
      // ROW2 has NO `.property` at all -- absent/unparseable frontmatter
      // (D4), not a legitimately-empty-but-valid row.
      [ROW2, { metadata: {} }],
    ]);
    const childrenForPath = jest
      .fn()
      .mockResolvedValue([NOTE_PATH, ROW1, ROW2]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);

    expect(reconciler.getRowViolations(DB, ROW1)).toEqual([]);
    expect(
      reconciler.getRowViolations(DB, ROW2).some((v) => v.code == "malformed-row")
    ).toBe(true);
    expect(reconciler.getRowViolations(DB, NOTE_PATH)).toEqual([]);
  });

  it("prunes stored violations for a row no longer present in the folder", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: { model: "Widget A" } } }],
      [ROW2, { metadata: {} }],
    ]);
    const childrenForPath = jest
      .fn()
      .mockResolvedValue([NOTE_PATH, ROW1, ROW2]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);
    expect(reconciler.getRowViolations(DB, ROW2)).toHaveLength(1);

    // ROW2 is gone (deleted/renamed away) by the next sweep.
    childrenForPath.mockResolvedValue([NOTE_PATH, ROW1]);
    pathsIndex.delete(ROW2);
    await reconciler.sweepFolder(DB);

    expect(reconciler.getRowViolations(DB, ROW2)).toEqual([]);
    expect(reconciler.getDbViolations(DB).size).toBe(0);
  });

  it("clears all violations once a schema'd folder becomes genuinely empty", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: {} } }],
    ]);
    const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);
    expect(reconciler.getViolationCount(DB)).toBeGreaterThan(0);

    childrenForPath.mockResolvedValue([NOTE_PATH]);
    await reconciler.sweepFolder(DB);
    expect(reconciler.getViolationCount(DB)).toBe(0);
  });

  it("clears stored violations once a folder is no longer schema'd", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: {} } }],
    ]);
    const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);
    expect(reconciler.getViolationCount(DB)).toBeGreaterThan(0);

    // The hub note's schema_type is removed -- no longer a Type Profile.
    pathsIndex.set(NOTE_PATH, { metadata: { property: { schema_type: undefined } } });
    await reconciler.sweepFolder(DB);
    expect(reconciler.getViolationCount(DB)).toBe(0);
  });

  it("detects a unique-field collision using contextsIndex as the sibling snapshot", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_UNIQUE } }],
      [ROW1, { metadata: { property: { code: "A1" } } }],
      [ROW2, { metadata: { property: { code: "A1" } } }],
    ]);
    const contextsIndex = new Map<string, any>([
      [
        DB,
        {
          contextTable: {
            rows: [
              { [PathPropertyName]: ROW1, code: "A1" },
              { [PathPropertyName]: ROW2, code: "A1" },
            ],
          },
        },
      ],
    ]);
    const childrenForPath = jest
      .fn()
      .mockResolvedValue([NOTE_PATH, ROW1, ROW2]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      contextsIndex,
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);

    expect(
      reconciler.getRowViolations(DB, ROW1).some((v) => v.code == "unique")
    ).toBe(true);
    expect(
      reconciler.getRowViolations(DB, ROW2).some((v) => v.code == "unique")
    ).toBe(true);
  });

  it("resolves reference fields via keyMatchResolver.resolveKeyMatch against the target folder's live index", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REFERENCE } }],
      [ROW1, { metadata: { property: { board_id: "B1" } } }],
      [TARGET_ROW, { metadata: { property: { board_id: "B1" } } }],
    ]);
    const contextsIndex = new Map<string, any>([
      [TARGET_DB, { paths: [TARGET_ROW] }],
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
    expect(
      reconciler.getRowViolations(DB, ROW1).some((v) => v.code == "reference-broken")
    ).toBe(false);

    // Break the reference: no row in the target folder matches "B2".
    pathsIndex.set(ROW1, { metadata: { property: { board_id: "B2" } } });
    await reconciler.sweepFolder(DB);
    const violations = reconciler
      .getRowViolations(DB, ROW1)
      .filter((v) => v.code == "reference-broken");
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("error"); // onBrokenWrite: "block"
  });

  // -------------------------------------------------------------------------
  // D4 / wall-04: broken frontmatter
  // -------------------------------------------------------------------------

  it("surfaces a single malformed-row violation for absent/unparseable frontmatter, never per-field noise", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      // No pathsIndex entry at all for ROW1 (never indexed / broken YAML).
    ]);
    const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);

    const violations = reconciler.getRowViolations(DB, ROW1);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("malformed-row");
    expect(violations[0].severity).toBe("error");
  });

  // -------------------------------------------------------------------------
  // D6 / pass-empty immunity
  // -------------------------------------------------------------------------

  it("flags a sweep that examined zero of a non-empty folder's rows as its own diagnostic, not a clean pass", async () => {
    const pathsIndex = {
      get: (p: string) =>
        p == NOTE_PATH ? { metadata: { property: HUB_REQUIRED } } : (() => {
          throw new Error("simulated index corruption");
        })(),
    };
    const childrenForPath = jest
      .fn()
      .mockResolvedValue([NOTE_PATH, ROW1, ROW2]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);

    const info = reconciler.getSweepIncomplete(DB);
    expect(info).toBeDefined();
    expect(info!.examinedRows).toBe(0);
    expect(info!.expectedRows).toBe(2);
    expect(info!.message.toLowerCase()).toContain("0 of 2");
    // No row-level violations should be reported -- the sweep never actually
    // examined them, so it must not report a healthy-looking empty list.
    expect(reconciler.getDbViolations(DB).size).toBe(0);
    expect(reconciler.getViolationCount(DB)).toBe(1);
  });

  it("clears a stale sweep-incomplete flag once a later sweep succeeds", async () => {
    let broken = true;
    const workingRows = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: { model: "Widget A" } } }],
    ]);
    const pathsIndex = {
      get: (p: string) => {
        if (p == NOTE_PATH) return { metadata: { property: HUB_REQUIRED } };
        if (broken) throw new Error("simulated index corruption");
        return workingRows.get(p);
      },
    };
    const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);
    expect(reconciler.getSweepIncomplete(DB)).toBeDefined();

    broken = false;
    await reconciler.sweepFolder(DB);
    expect(reconciler.getSweepIncomplete(DB)).toBeUndefined();
  });

  it("treats an unreadable vault listing as UNKNOWN health, never as a clean empty folder", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
    ]);
    const childrenForPath = jest
      .fn()
      .mockRejectedValue(new Error("adapter I/O failure"));
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);

    await reconciler.sweepFolder(DB);

    const info = reconciler.getSweepIncomplete(DB);
    expect(info).toBeDefined();
    expect(info!.expectedRows).toBeNull();
    expect(reconciler.getViolationCount(DB)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Read API surface (bd note to Notidian-loan.5)
  // -------------------------------------------------------------------------

  it("getViolationCount totals across every db when called with no argument", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: {} } }],
    ]);
    const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);
    await reconciler.sweepFolder(DB);

    expect(reconciler.getViolationCount()).toBe(reconciler.getViolationCount(DB));
    expect(reconciler.getAllDbPaths()).toEqual([DB]);
  });

  it("notifies onChange subscribers when the store mutates", async () => {
    const pathsIndex = new Map<string, any>([
      [NOTE_PATH, { metadata: { property: HUB_REQUIRED } }],
      [ROW1, { metadata: { property: {} } }],
    ]);
    const childrenForPath = jest.fn().mockResolvedValue([NOTE_PATH, ROW1]);
    const superstate = makeSuperstate({
      pathsIndex,
      spacesIndex: dbSpacesIndex(),
      childrenForPath,
    });
    const reconciler = new Reconciler(superstate);
    const listener = jest.fn();
    const unsubscribe = reconciler.onChange(listener);

    await reconciler.sweepFolder(DB);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    childrenForPath.mockResolvedValue([NOTE_PATH]);
    await reconciler.sweepFolder(DB);
    expect(listener).not.toHaveBeenCalled();
  });
});
