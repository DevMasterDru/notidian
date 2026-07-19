/**
 * Adversarial / property tests for pageTitleRename.ts
 *
 * Bead: Notidian-11oh
 *
 * Locks 7 invariants and covers 10+ adversarial scenarios through the public
 * API surface (planBulkPageTitleRename, executeBulkPageTitleRename,
 * renamePageTitleForRowWithResult, renamePageTitleForRow).
 *
 * All tests are pure-offline — no filesystem, no render path.
 */

import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { SpaceTable } from "shared/types/mdb";
import {
  BulkPageTitleRenamePlan,
  BulkPageTitleRenameResult,
  RenamePageTitleResult,
  executeBulkPageTitleRename,
  planBulkPageTitleRename,
  renamePageTitleForRow,
  renamePageTitleForRowWithResult,
} from "./pageTitleRename";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const row = (path: string, extra: Record<string, string> = {}): DBRow => ({
  [PathPropertyName]: path,
  ...extra,
});

const table = (paths: string[]): SpaceTable => ({
  schema: { id: "files", name: "Items", type: "db" },
  cols: [],
  rows: paths.map((p) => row(p)),
});

/** Extract the ok:false branch of a discriminated result union. */
type Failed<T extends { ok: boolean }> = Extract<T, { ok: false }>;

// ---------------------------------------------------------------------------
// INVARIANT 1: Bulk rename atomicity — partial failure triggers reconciliation
// ---------------------------------------------------------------------------

describe("INVARIANT 1: Bulk rename atomicity", () => {
  it("does not compensate the original incarnation into an Old path recreated by another file", async () => {
    const original = { generation: "original" };
    const outsider = { generation: "outsider" };
    const occupants = new Map<string, object>([["folder/A.md", original], ["folder/B.md", {}]]);
    const calls: Array<[string, string]> = [];
    let call = 0;
    const superstate = {
      contextsIndex: new Map([["folder", { contextTable: table(["folder/A.md", "folder/B.md"]) }]]),
      spaceManager: {
        pathExists: jest.fn(async (path: string) => occupants.has(path)),
        getPathInfo: jest.fn(async (path: string) => occupants.has(path)
          ? { path, obsidianFile: occupants.get(path) }
          : null),
        renamePath: jest.fn(async (from: string, to: string) => {
          calls.push([from, to]);
          call++;
          if (call === 2) {
            occupants.set("folder/A.md", outsider);
            return null;
          }
          const occupant = occupants.get(from);
          occupants.delete(from);
          if (occupant) occupants.set(to, occupant);
          return to;
        }),
      },
      ui: { notify: jest.fn() },
    } as any;

    await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "X" },
        { row: row("folder/B.md"), value: "Y" },
      ],
      contextPath: "folder", settleDelayMs: 0, superstate,
    });

    expect(calls.some(([from, to]) => from.includes(".notidian-renaming-") && to === "folder/A.md")).toBe(false);
    expect(occupants.get("folder/A.md")).toBe(outsider);
  });

  it("leaves an occupied New path owned by another incarnation untouched during compensation", async () => {
    const original = { generation: "original" };
    const outsider = { generation: "outsider" };
    const occupants = new Map<string, object>([["folder/A.md", original], ["folder/B.md", {}]]);
    let call = 0;
    const superstate = {
      contextsIndex: new Map([["folder", { contextTable: table(["folder/A.md", "folder/B.md"]) }]]),
      spaceManager: {
        pathExists: jest.fn(async (path: string) => occupants.has(path)),
        getPathInfo: jest.fn(async (path: string) => occupants.has(path) ? { path, obsidianFile: occupants.get(path) } : null),
        renamePath: jest.fn(async (from: string, to: string) => {
          call++;
          if (call === 2) { occupants.set("folder/X.md", outsider); return null; }
          const value = occupants.get(from); occupants.delete(from); if (value) occupants.set(to, value); return to;
        }),
      },
      ui: { notify: jest.fn() },
    } as any;

    await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }, { row: row("folder/B.md"), value: "Y" }],
      contextPath: "folder", settleDelayMs: 0, superstate,
    });

    expect(occupants.get("folder/X.md")).toBe(outsider);
    expect(occupants.get("folder/A.md")).toBe(original);
  });

  it("rolls back temp-state files when a later rename in the batch fails", async () => {
    const renameLog: Array<[string, string]> = [];
    let callCount = 0;

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([
        [
          "folder",
          {
            contextTable: table([
              "folder/A.md",
              "folder/B.md",
              "folder/C.md",
            ]),
          },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (old: string, next: string): Promise<string | null> => {
            renameLog.push([old, next]);
            callCount++;
            // First two renames (A→temp, B→temp) succeed;
            // third rename (C→temp) fails.
            if (callCount === 3) return null;
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "X" },
        { row: row("folder/B.md"), value: "Y" },
        { row: row("folder/C.md"), value: "Z" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(false);
    // Should have attempted rollback of A and B (which are in "temp" state)
    const rollbackCalls = renameLog.filter(([from]) =>
      from.includes(".notidian-renaming-")
    );
    // There should be rollback calls (temp→original) after the failure
    expect(rollbackCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports partially-applied renames when some reach final state before failure", async () => {
    let callCount = 0;
    const contextPath = "folder";
    const originalTable = table(["folder/A.md", "folder/B.md"]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        // After partial failure, reload sees X.md (A renamed) but no Y.md
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [row("folder/X.md"), row("folder/B.md")],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, next: string): Promise<string | null> => {
            callCount++;
            if (callCount === 4) return null;
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "X" },
        { row: row("folder/B.md"), value: "Y" },
      ],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(false);
    const failed = result as Failed<BulkPageTitleRenameResult>;
    // A reached "final" state, B did not
    expect(failed.applied.length).toBe(1);
    expect(failed.applied[0].newPath).toBe("folder/X.md");
    expect(failed.failures.length).toBe(1);
    expect(failed.failures[0].value).toBe("Y");
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 2: Swap rename correctness — n-way circular
// ---------------------------------------------------------------------------

describe("INVARIANT 2: Swap rename correctness", () => {
  it("handles 3-way circular swap A→B, B→C, C→A via temp paths", async () => {
    const renameLog: Array<[string, string]> = [];
    const existingPaths = new Set([
      "folder/A.md",
      "folder/B.md",
      "folder/C.md",
    ]);

    const superstate = {
      contextsIndex: new Map([
        [
          "folder",
          {
            contextTable: table([
              "folder/A.md",
              "folder/B.md",
              "folder/C.md",
            ]),
          },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(
          async (path: string): Promise<boolean> => existingPaths.has(path)
        ),
        renamePath: jest.fn(
          async (old: string, next: string): Promise<string> => {
            renameLog.push([old, next]);
            existingPaths.delete(old);
            existingPaths.add(next);
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "B" },
        { row: row("folder/B.md"), value: "C" },
        { row: row("folder/C.md"), value: "A" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate,
    });

    expect(result.ok).toBe(true);

    // 6 rename calls: 3 original→temp, 3 temp→final
    expect(renameLog.length).toBe(6);

    // Phase 1: all originals go to temp
    for (let i = 0; i < 3; i++) {
      expect(renameLog[i][1]).toContain(".notidian-renaming-");
    }
    // Phase 2: temps go to final destinations
    const finalPaths = renameLog.slice(3).map(([, to]) => to);
    expect(finalPaths.sort()).toEqual([
      "folder/A.md",
      "folder/B.md",
      "folder/C.md",
    ]);

    // No orphaned temp files remain in the "filesystem"
    for (const path of existingPaths) {
      expect(path).not.toContain(".notidian-renaming-");
    }
  });

  it("handles 2-way swap (A→B, B→A) correctly", async () => {
    const existingPaths = new Set(["folder/A.md", "folder/B.md"]);

    const superstate = {
      contextsIndex: new Map([
        [
          "folder",
          {
            contextTable: table(["folder/A.md", "folder/B.md"]),
          },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(
          async (path: string): Promise<boolean> => existingPaths.has(path)
        ),
        renamePath: jest.fn(
          async (old: string, next: string): Promise<string> => {
            existingPaths.delete(old);
            existingPaths.add(next);
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "B" },
        { row: row("folder/B.md"), value: "A" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate,
    });

    expect(result.ok).toBe(true);
    // Both final files should exist, no temps
    expect(existingPaths.has("folder/A.md")).toBe(true);
    expect(existingPaths.has("folder/B.md")).toBe(true);
    for (const p of existingPaths) {
      expect(p).not.toContain(".notidian-renaming-");
    }
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 3: Unicode NFC/NFD normalization
// ---------------------------------------------------------------------------

describe("INVARIANT 3: Unicode NFC/NFD normalization", () => {
  // "café" in NFC = U+00E9, NFD = e + U+0301
  const cafeNFC = "café";
  const cafeNFD = "café";

  it("detects internal duplicates across NFC/NFD forms", async () => {
    const result = await planBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: cafeNFC },
        { row: row("folder/B.md"), value: cafeNFD },
      ],
      contextPath: "folder",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    const failed = result as Failed<BulkPageTitleRenamePlan>;
    expect(failed.failures[0].reason).toBe("internal-duplicate");
  });

  it("allows case-only rename with Unicode characters", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/" + cafeNFC + ".md"),
      value: cafeNFC.toUpperCase(),
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => true),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    // Should succeed because it's a case-only rename
    expect(result.ok).toBe(true);
  });

  it("uses NFC normalization to detect existing path collisions", async () => {
    const result = await planBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: cafeNFC }],
      contextPath: "folder",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => true),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    const failed = result as Failed<BulkPageTitleRenamePlan>;
    expect(failed.failures[0].reason).toBe("duplicate");
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 4: Extension preservation
// ---------------------------------------------------------------------------

describe("INVARIANT 4: Extension preservation", () => {
  it("preserves multi-dot extensions like .test.md", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/MyFile.test.md"),
      value: "Renamed",
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    // buildPageTitleRename uses the LAST dot only — so extension is ".md"
    expect(result.ok).toBe(true);
    expect((result as Extract<RenamePageTitleResult, { ok: true }>).path).toBe(
      "folder/Renamed.md"
    );
  });

  it("handles extension-less files", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/Makefile"),
      value: "Buildfile",
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<RenamePageTitleResult, { ok: true }>;
    expect(ok.path).toBe("folder/Buildfile");
    expect(ok.path).not.toContain(".");
  });

  it("preserves non-.md extensions like .canvas", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/Diagram.canvas"),
      value: "NewDiagram",
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    expect(
      (result as Extract<RenamePageTitleResult, { ok: true }>).path
    ).toBe("folder/NewDiagram.canvas");
  });

  it("preserves extensions through swap renames with temp paths", async () => {
    const renameLog: Array<[string, string]> = [];
    const existingPaths = new Set(["folder/A.canvas", "folder/B.canvas"]);

    const superstate = {
      contextsIndex: new Map([
        [
          "folder",
          {
            contextTable: table(["folder/A.canvas", "folder/B.canvas"]),
          },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(
          async (p: string): Promise<boolean> => existingPaths.has(p)
        ),
        renamePath: jest.fn(
          async (old: string, next: string): Promise<string> => {
            renameLog.push([old, next]);
            existingPaths.delete(old);
            existingPaths.add(next);
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.canvas"), value: "B" },
        { row: row("folder/B.canvas"), value: "A" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate,
    });

    expect(result.ok).toBe(true);
    // Temp paths should also have .canvas extension
    const tempPaths = renameLog
      .map(([, to]) => to)
      .filter((p) => p.includes(".notidian-renaming-"));
    for (const tempPath of tempPaths) {
      expect(tempPath).toMatch(/\.canvas$/);
    }
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 5: Row position preservation
// ---------------------------------------------------------------------------

describe("INVARIANT 5: Row position preservation", () => {
  it("restores first row to index 0 when reload appends it", async () => {
    const contextPath = "folder";
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const originalTable = table([
      "folder/First.md",
      "folder/Second.md",
      "folder/Third.md",
    ]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [
              row("folder/Second.md"),
              row("folder/Third.md"),
              row("folder/Renamed.md"),
            ],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, n: string): Promise<string> => n
        ),
        mutateTable: jest.fn(async (path: string, _schema: string, operation: any) => (saveTable as any)(path, operation.desired)),
      },
      ui: { notify: jest.fn() },
    };

    await renamePageTitleForRow({
      row: row("folder/First.md"),
      value: "Renamed",
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(saveTable).toHaveBeenCalled();
    const savedTable = (saveTable.mock.calls[0] as unknown[])[1] as SpaceTable;
    expect(savedTable.rows[0][PathPropertyName]).toBe("folder/Renamed.md");
    expect(savedTable.rows[1][PathPropertyName]).toBe("folder/Second.md");
    expect(savedTable.rows[2][PathPropertyName]).toBe("folder/Third.md");
  });

  it("preserves middle row position in bulk rename", async () => {
    const contextPath = "folder";
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const originalTable = table([
      "folder/A.md",
      "folder/B.md",
      "folder/C.md",
      "folder/D.md",
    ]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [
              row("folder/A.md"),
              row("folder/C.md"),
              row("folder/D.md"),
              row("folder/Y.md"),
            ],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, n: string): Promise<string> => n
        ),
        mutateTable: jest.fn(async (path: string, _schema: string, operation: any) => (saveTable as any)(path, operation.desired)),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/B.md"), value: "Y" }],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).toHaveBeenCalled();
    const savedTable = (saveTable.mock.calls[0] as unknown[])[1] as SpaceTable;
    expect(savedTable.rows[0][PathPropertyName]).toBe("folder/A.md");
    expect(savedTable.rows[1][PathPropertyName]).toBe("folder/Y.md");
    expect(savedTable.rows[2][PathPropertyName]).toBe("folder/C.md");
    expect(savedTable.rows[3][PathPropertyName]).toBe("folder/D.md");
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 6: Duplicate row dedup
// ---------------------------------------------------------------------------

describe("INVARIANT 6: Duplicate row dedup", () => {
  it("deduplicates triple-duplicate rows from reload in bulk rename", async () => {
    const contextPath = "folder";
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const originalTable = table(["folder/A.md", "folder/B.md"]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [
              row("folder/B.md"),
              row("folder/X.md"),
              row("folder/X.md"),
              row("folder/X.md"),
            ],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, n: string): Promise<string> => n
        ),
        mutateTable: jest.fn(async (path: string, _schema: string, operation: any) => (saveTable as any)(path, operation.desired)),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).toHaveBeenCalled();
    const savedTable = (saveTable.mock.calls[0] as unknown[])[1] as SpaceTable;
    const xRows = savedTable.rows.filter(
      (r) => r[PathPropertyName] === "folder/X.md"
    );
    expect(xRows.length).toBe(1);
    expect(savedTable.rows[0][PathPropertyName]).toBe("folder/X.md");
    expect(savedTable.rows[1][PathPropertyName]).toBe("folder/B.md");
  });

  it("deduplicates rows in single rename via preserveContextRowPosition", async () => {
    const contextPath = "folder";
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const originalTable = table(["folder/Old.md", "folder/Other.md"]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [
              row("folder/Other.md"),
              row("folder/New.md"),
              row("folder/New.md"),
              row("folder/New.md"),
            ],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, n: string): Promise<string> => n
        ),
        mutateTable: jest.fn(async (path: string, _schema: string, operation: any) => (saveTable as any)(path, operation.desired)),
      },
      ui: { notify: jest.fn() },
    };

    await renamePageTitleForRow({
      row: row("folder/Old.md"),
      value: "New",
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(saveTable).toHaveBeenCalled();
    const savedTable = (saveTable.mock.calls[0] as unknown[])[1] as SpaceTable;
    const newRows = savedTable.rows.filter(
      (r) => r[PathPropertyName] === "folder/New.md"
    );
    expect(newRows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 7: Temporary path uniqueness
// ---------------------------------------------------------------------------

describe("INVARIANT 7: Temporary path uniqueness", () => {
  it("generates unique temp paths for each item in a batch", async () => {
    const tempPaths = new Set<string>();

    const superstate = {
      contextsIndex: new Map([
        [
          "folder",
          {
            contextTable: table([
              "folder/A.md",
              "folder/B.md",
              "folder/C.md",
              "folder/D.md",
              "folder/E.md",
            ]),
          },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, next: string): Promise<string> => {
            if (next.includes(".notidian-renaming-")) {
              tempPaths.add(next);
            }
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "V" },
        { row: row("folder/B.md"), value: "W" },
        { row: row("folder/C.md"), value: "X" },
        { row: row("folder/D.md"), value: "Y" },
        { row: row("folder/E.md"), value: "Z" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate,
    });

    // All temp paths should be unique (one per item)
    expect(tempPaths.size).toBe(5);
  });

  it("includes index suffix to prevent collisions within same operation", async () => {
    const tempPathsList: string[] = [];

    const superstate = {
      contextsIndex: new Map([
        [
          "folder",
          {
            contextTable: table(["folder/A.md", "folder/B.md"]),
          },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, next: string): Promise<string> => {
            if (next.includes(".notidian-renaming-")) {
              tempPathsList.push(next);
            }
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "X" },
        { row: row("folder/B.md"), value: "Y" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate,
    });

    // The two temp paths should share an operationId but differ in index
    expect(tempPathsList.length).toBe(2);
    expect(tempPathsList[0]).not.toBe(tempPathsList[1]);
    // Both should end with the original extension
    for (const tp of tempPathsList) {
      expect(tp).toMatch(/\.md$/);
    }
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Mixed no-op/real renames in bulk
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: Mixed no-op and real renames", () => {
  it("skips temp-path phase for no-op items while renaming changed items", async () => {
    const renameLog: Array<[string, string]> = [];
    const contextPath = "folder";
    const originalTable = table([
      "folder/Keep.md",
      "folder/Change.md",
      "folder/Also-Keep.md",
    ]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [
              row("folder/Keep.md"),
              row("folder/Changed.md"),
              row("folder/Also-Keep.md"),
            ],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (old: string, next: string): Promise<string> => {
            renameLog.push([old, next]);
            return next;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/Keep.md"), value: "Keep" },
        { row: row("folder/Change.md"), value: "Changed" },
        { row: row("folder/Also-Keep.md"), value: "Also-Keep" },
      ],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(true);
    // Only 2 rename calls (Change→temp, temp→Changed), not 6
    expect(renameLog.length).toBe(2);
    expect(renameLog[0][0]).toBe("folder/Change.md");
    expect(renameLog[0][1]).toContain(".notidian-renaming-");
    expect(renameLog[1][1]).toBe("folder/Changed.md");
  });

  it("returns all paths including no-ops when result is ok", async () => {
    const contextPath = "folder";
    const originalTable = table(["folder/A.md", "folder/B.md"]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [row("folder/A.md"), row("folder/X.md")],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, n: string): Promise<string> => n
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "A" },
        { row: row("folder/B.md"), value: "X" },
      ],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<BulkPageTitleRenameResult, { ok: true }>;
    expect(ok.paths).toContain("folder/X.md");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: pathExists throws during planning
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: pathExists throws during planning", () => {
  it("fails the entire plan when pathExists throws for a changed item", async () => {
    const result = await planBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath: "folder",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => {
            throw new Error("EACCES: permission denied");
          }),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    const failed = result as Failed<BulkPageTitleRenamePlan>;
    expect(failed.failures[0].reason).toBe("rename-failed");
  });

  it("propagates pathExists errors through execute path", async () => {
    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => {
            throw new Error("network error");
          }),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: reloadContextByPath produces unexpected rows
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: unexpected reload rows", () => {
  it("handles reload producing extra unrelated rows", async () => {
    const contextPath = "folder";
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const originalTable = table(["folder/A.md", "folder/B.md"]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [
              row("folder/B.md"),
              row("folder/X.md"),
              row("folder/Surprise.md"),
            ],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_old: string, n: string): Promise<string> => n
        ),
        mutateTable: jest.fn(async (path: string, _schema: string, operation: any) => (saveTable as any)(path, operation.desired)),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).toHaveBeenCalled();
    const savedTable = (saveTable.mock.calls[0] as unknown[])[1] as SpaceTable;
    expect(savedTable.rows[0][PathPropertyName]).toBe("folder/X.md");
    expect(savedTable.rows[1][PathPropertyName]).toBe("folder/B.md");
    expect(savedTable.rows[2][PathPropertyName]).toBe("folder/Surprise.md");
  });

  it("handles reload removing rows entirely", async () => {
    const contextPath = "folder";
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const originalTable = table([
      "folder/A.md",
      "folder/B.md",
      "folder/C.md",
    ]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [row("folder/X.md"), row("folder/C.md")],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(
          async (path: string): Promise<boolean> => path === "folder/B.md"
        ),
        renamePath: jest.fn(
          async (_old: string, n: string): Promise<string> => n
        ),
        mutateTable: jest.fn(async (path: string, _schema: string, operation: any) => (saveTable as any)(path, operation.desired)),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).toHaveBeenCalled();
    const savedTable = (saveTable.mock.calls[0] as unknown[])[1] as SpaceTable;
    const paths = savedTable.rows.map((r) => r[PathPropertyName]);
    expect(paths).toContain("folder/X.md");
    expect(paths).toContain("folder/C.md");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Boundary-length filenames
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: Boundary-length filenames", () => {
  it("accepts a 254-character filename", async () => {
    const name254 = "a".repeat(254);
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/old.md"),
      value: name254,
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
  });

  it("accepts a 255-character filename (max valid length)", async () => {
    const name255 = "b".repeat(255);
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/old.md"),
      value: name255,
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a 256-character filename (one over max)", async () => {
    const name256 = "c".repeat(256);
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/old.md"),
      value: name256,
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(),
          renamePath: jest.fn(),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    expect(
      (result as Failed<RenamePageTitleResult>).reason
    ).toBe("too-long");
  });

  it("rejects boundary-length filenames in bulk rename planning", async () => {
    const name256 = "d".repeat(256);
    const result = await planBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: name256 },
        { row: row("folder/B.md"), value: "ValidName" },
      ],
      contextPath: "folder",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    expect(
      (result as Failed<BulkPageTitleRenamePlan>).failures[0].reason
    ).toBe("too-long");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Empty contextPath / missing contextsIndex
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: Empty contextPath", () => {
  it("skips reconciliation with empty contextPath in single rename", async () => {
    const saveTable = jest.fn();
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/Old.md"),
      value: "New",
      contextPath: "",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
          saveTable,
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).not.toHaveBeenCalled();
  });

  it("skips reconciliation with empty contextPath in bulk rename", async () => {
    const saveTable = jest.fn();
    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath: "",
      settleDelayMs: 0,
      superstate: {
        contextsIndex: new Map(),
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
          saveTable,
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).not.toHaveBeenCalled();
  });

  it("handles missing contextsIndex entry gracefully", async () => {
    const saveTable = jest.fn();
    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath: "nonexistent-context",
      settleDelayMs: 0,
      superstate: {
        contextsIndex: new Map(),
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
          saveTable,
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Single-item bulk rename (degenerate case)
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: Single-item bulk rename", () => {
  it("behaves identically to a single rename for one changed item", async () => {
    const renamePath = jest.fn(
      async (_old: string, n: string): Promise<string> => n
    );
    const contextPath = "folder";
    const originalTable = table(["folder/A.md"]);

    const superstate: Record<string, unknown> = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        (superstate.contextsIndex as Map<string, unknown>).set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [row("folder/X.md")],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath,
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    };

    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "X" }],
      contextPath,
      settleDelayMs: 0,
      superstate: superstate as any,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<BulkPageTitleRenameResult, { ok: true }>;
    expect(ok.paths).toEqual(["folder/X.md"]);
    // Still goes through temp path even for a single item
    expect(renamePath).toHaveBeenCalledTimes(2);
  });

  it("handles single no-op item as a bulk degenerate case", async () => {
    const renamePath = jest.fn();

    const superstate = {
      contextsIndex: new Map([
        [
          "folder",
          { contextTable: table(["folder/A.md"]) },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath,
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await executeBulkPageTitleRename({
      items: [{ row: row("folder/A.md"), value: "A" }],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<BulkPageTitleRenameResult, { ok: true }>;
    expect(ok.paths).toEqual(["folder/A.md"]);
    expect(renamePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: All items failing validation
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: All items fail validation", () => {
  it("reports all failures without touching the filesystem", async () => {
    const renamePath = jest.fn();
    const pathExists = jest.fn();

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "" },
        { row: row("folder/B.md"), value: "x/y" },
        { row: row("folder/C.md"), value: "CON" },
        { row: { noPathProp: "true" } as unknown as DBRow, value: "Valid" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        contextsIndex: new Map(),
        spaceManager: { pathExists, renamePath },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    const failed = result as Failed<BulkPageTitleRenameResult>;
    expect(failed.failures.length).toBe(4);
    expect(failed.applied.length).toBe(0);
    const reasons = failed.failures.map((f) => f.reason);
    expect(reasons).toContain("empty");
    expect(reasons).toContain("slash");
    expect(reasons).toContain("reserved-name");
    expect(reasons).toContain("missing-path");
    expect(renamePath).not.toHaveBeenCalled();
    expect(pathExists).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: renamePath returns null (Obsidian adapter failure)
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: renamePath returns null", () => {
  it("treats null return from renamePath as rename failure in single rename", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/A.md"),
      value: "B",
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (): Promise<null> => null
          ),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    expect(
      (result as Failed<RenamePageTitleResult>).reason
    ).toBe("rename-failed");
  });

  it("triggers rollback when renamePath returns null mid-batch", async () => {
    let callIndex = 0;
    const renameLog: Array<[string, string, string | null]> = [];

    const superstate = {
      contextsIndex: new Map([
        [
          "folder",
          { contextTable: table(["folder/A.md", "folder/B.md"]) },
        ],
      ]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (
            old: string,
            next: string
          ): Promise<string | null> => {
            callIndex++;
            const res = callIndex === 2 ? null : next;
            renameLog.push([old, next, res]);
            return res;
          }
        ),
        mutateTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("folder/A.md"), value: "X" },
        { row: row("folder/B.md"), value: "Y" },
      ],
      contextPath: "folder",
      settleDelayMs: 0,
      superstate,
    });

    expect(result.ok).toBe(false);
    const rollbackCalls = renameLog.filter(([from]) =>
      from.includes(".notidian-renaming-")
    );
    expect(rollbackCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Root-level files (no folder prefix)
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: Root-level files without folder prefix", () => {
  it("handles files at vault root (no parent folder)", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: row("RootFile.md"),
      value: "Renamed",
      contextPath: "",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<RenamePageTitleResult, { ok: true }>;
    expect(ok.path).toBe("Renamed.md");
    expect(ok.path).not.toContain("/");
  });

  it("generates correct temp paths for root-level files in bulk swap", async () => {
    const renameLog: Array<[string, string]> = [];
    const existingPaths = new Set(["A.md", "B.md"]);

    const result = await executeBulkPageTitleRename({
      items: [
        { row: row("A.md"), value: "B" },
        { row: row("B.md"), value: "A" },
      ],
      contextPath: "",
      settleDelayMs: 0,
      superstate: {
        contextsIndex: new Map(),
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        spaceManager: {
          pathExists: jest.fn(
            async (p: string): Promise<boolean> => existingPaths.has(p)
          ),
          renamePath: jest.fn(
            async (old: string, next: string): Promise<string> => {
              renameLog.push([old, next]);
              existingPaths.delete(old);
              existingPaths.add(next);
              return next;
            }
          ),
          mutateTable: jest.fn(async (): Promise<void> => undefined),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    // Temp paths should NOT have a leading slash
    const tempCalls = renameLog.filter(([, to]) =>
      to.includes(".notidian-renaming-")
    );
    for (const [, tempPath] of tempCalls) {
      expect(tempPath).not.toMatch(/^\//);
      expect(tempPath).toMatch(/^\.notidian-renaming-/);
    }
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Case-only renames
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: Case-only renames", () => {
  it("allows case-only rename even when pathExists returns true (case-insensitive FS)", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: row("folder/readme.md"),
      value: "README",
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => true),
          renamePath: jest.fn(
            async (_old: string, n: string): Promise<string> => n
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<RenamePageTitleResult, { ok: true }>;
    expect(ok.path).toBe("folder/README.md");
    expect(ok.changed).toBe(true);
  });

  it("allows case-only swap in bulk rename planning", async () => {
    const result = await planBulkPageTitleRename({
      items: [{ row: row("folder/hello.md"), value: "HELLO" }],
      contextPath: "folder",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => true),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    const ok = result as Extract<BulkPageTitleRenamePlan, { ok: true }>;
    expect(ok.renames[0].changed).toBe(true);
    expect(ok.renames[0].newPath).toBe("folder/HELLO.md");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Row missing from row parameter
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: Missing path in row", () => {
  it("returns missing-path for single rename with undefined path", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: {} as DBRow,
      value: "New",
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(),
          renamePath: jest.fn(),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(false);
    expect(
      (result as Failed<RenamePageTitleResult>).reason
    ).toBe("missing-path");
  });

  it("returns null from wrapper for missing-path row", async () => {
    const result = await renamePageTitleForRow({
      row: {} as DBRow,
      value: "New",
      contextPath: "folder",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(),
          renamePath: jest.fn(),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PROPERTY: Renamed path always preserves parent folder
// ---------------------------------------------------------------------------

describe("PROPERTY: Parent folder preservation", () => {
  const folders = [
    "simple",
    "deeply/nested/folder",
    "Relays & Devices",
    "名前",
    "",
  ];

  for (const folder of folders) {
    const prefix = folder ? `${folder}/` : "";
    it(`preserves parent folder "${folder || "(root)"}" across rename`, async () => {
      const result = await renamePageTitleForRowWithResult({
        row: row(`${prefix}Original.md`),
        value: "Target",
        contextPath: folder,
        settleDelayMs: 0,
        superstate: {
          spaceManager: {
            pathExists: jest.fn(async (): Promise<boolean> => false),
            renamePath: jest.fn(
              async (_old: string, n: string): Promise<string> => n
            ),
          },
          reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
          ui: { notify: jest.fn() },
        } as any,
      });

      expect(result.ok).toBe(true);
      expect(
        (result as Extract<RenamePageTitleResult, { ok: true }>).path
      ).toBe(`${prefix}Target.md`);
    });
  }
});
