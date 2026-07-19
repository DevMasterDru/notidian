import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { TableMutationOperation } from "shared/types/spaceManager";
import { applyTableMutation } from "../tableMutation";
import {
  executeBulkPageTitleRename,
  renamePageTitleForRowWithResult,
} from "../pageTitleRename";

const makeMutateTable = (initialTable: SpaceTable) => {
  let currentTable = structuredClone(initialTable);
  return jest.fn(
    async (
      _path: string,
      schemaId: string,
      operation: TableMutationOperation
    ): Promise<boolean> => {
      if (schemaId !== currentTable.schema.id) {
        throw new Error(`unexpected schema ${schemaId}`);
      }
      currentTable = structuredClone(
        applyTableMutation(structuredClone(currentTable), operation)
      );
      return true;
    }
  );
};

describe("rename audit repros", () => {
  it("B1 reports rename-failed when persistence resolves null for a failed single rename", async () => {
    const contextPath = "Relays & Devices";
    const contextTable: SpaceTable = {
      schema: { id: "files", name: "Items", type: "db" },
      cols: [],
      rows: [
        { _index: "0", [PathPropertyName]: "Relays & Devices/Old.md" },
        { _index: "1", [PathPropertyName]: "Relays & Devices/Other.md" },
      ],
    };
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const superstate = {
      contextsIndex: new Map([[contextPath, { contextTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(async (): Promise<string | null> => null),
        saveTable,
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await renamePageTitleForRowWithResult({
      row: contextTable.rows[0],
      value: "New",
      contextPath,
      settleDelayMs: 0,
      superstate,
    });

    expect(result).toEqual({ ok: false, reason: "rename-failed" });
    expect(superstate.reloadContextByPath).not.toHaveBeenCalled();
    expect(saveTable).not.toHaveBeenCalled();
    expect(superstate.ui.notify).toHaveBeenCalledWith(
      "Could not rename the file."
    );
  });

  it("B2 reports files that reached final paths as applied when phase two partially fails", async () => {
    const contextPath = "Relays & Devices";
    const contextTable: SpaceTable = {
      schema: { id: "files", name: "Items", type: "db" },
      cols: [],
      rows: [
        { _index: "0", [PathPropertyName]: "Relays & Devices/A.md" },
        { _index: "1", [PathPropertyName]: "Relays & Devices/B.md" },
      ],
    };
    const existingPaths = new Set([
      "Relays & Devices/A.md",
      "Relays & Devices/B.md",
    ]);
    const finalFailure = new Error("phase two target rejected");
    const renamePath = jest.fn(
      async (oldPath: string, newPath: string): Promise<string> => {
        if (newPath == "Relays & Devices/Y.md") {
          throw finalFailure;
        }
        if (!existingPaths.has(oldPath)) {
          throw new Error(`missing ${oldPath}`);
        }
        existingPaths.delete(oldPath);
        existingPaths.add(newPath);
        return newPath;
      }
    );
    const superstate = {
      contextsIndex: new Map([[contextPath, { contextTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(
          async (path: string): Promise<boolean> => existingPaths.has(path)
        ),
        renamePath,
        mutateTable: makeMutateTable(contextTable),
        saveTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await executeBulkPageTitleRename({
      items: [
        { row: contextTable.rows[0], value: "X" },
        { row: contextTable.rows[1], value: "Y" },
      ],
      contextPath,
      settleDelayMs: 0,
      superstate,
    });

    expect(existingPaths.has("Relays & Devices/X.md")).toBe(true);
    expect(existingPaths.has("Relays & Devices/A.md")).toBe(false);
    expect(existingPaths.has("Relays & Devices/B.md")).toBe(true);
    expect(result).toEqual({
      ok: false,
      applied: [
        {
          row: contextTable.rows[0],
          value: "X",
          oldPath: "Relays & Devices/A.md",
          newPath: "Relays & Devices/X.md",
        },
      ],
      failures: [
        {
          row: contextTable.rows[1],
          value: "Y",
          reason: "rename-failed",
        },
      ],
      error: finalFailure,
    });
    expect(superstate.ui.notify).toHaveBeenCalledWith(
      "Could not rename all selected files."
    );
  });

  it("B2-null treats a null phase-two rename (the real Obsidian adapter mode) as a failure, not success", async () => {
    const contextPath = "Relays & Devices";
    const contextTable: SpaceTable = {
      schema: { id: "files", name: "Items", type: "db" },
      cols: [],
      rows: [
        { _index: "0", [PathPropertyName]: "Relays & Devices/A.md" },
        { _index: "1", [PathPropertyName]: "Relays & Devices/B.md" },
      ],
    };
    const existingPaths = new Set([
      "Relays & Devices/A.md",
      "Relays & Devices/B.md",
    ]);
    // The real adapter resolves null (does not throw) on a failed rename.
    const renamePath = jest.fn(
      async (oldPath: string, newPath: string): Promise<string | null> => {
        if (newPath == "Relays & Devices/Y.md") {
          return null;
        }
        existingPaths.delete(oldPath);
        existingPaths.add(newPath);
        return newPath;
      }
    );
    const superstate = {
      contextsIndex: new Map([[contextPath, { contextTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
      spaceManager: {
        pathExists: jest.fn(
          async (path: string): Promise<boolean> => existingPaths.has(path)
        ),
        renamePath,
        mutateTable: makeMutateTable(contextTable),
        saveTable: jest.fn(async (): Promise<void> => undefined),
      },
      ui: { notify: jest.fn() },
    } as any;

    const result = await executeBulkPageTitleRename({
      items: [
        { row: contextTable.rows[0], value: "X" },
        { row: contextTable.rows[1], value: "Y" },
      ],
      contextPath,
      settleDelayMs: 0,
      superstate,
    });

    // X.md reached final and is applied; Y is a rename-failed failure, and B.md
    // was rolled back from its temp path (a null rename must not be "success").
    expect(result).toMatchObject({
      ok: false,
      applied: [
        {
          row: contextTable.rows[0],
          value: "X",
          oldPath: "Relays & Devices/A.md",
          newPath: "Relays & Devices/X.md",
        },
      ],
      failures: [
        { row: contextTable.rows[1], value: "Y", reason: "rename-failed" },
      ],
    });
    expect(existingPaths.has("Relays & Devices/X.md")).toBe(true);
    expect(existingPaths.has("Relays & Devices/B.md")).toBe(true);
  });

  it("B3 does not synthesize a context row for a missing target path", async () => {
    const contextPath = "Relays & Devices";
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const b3OriginalTable: SpaceTable = {
      schema: { id: "files", name: "Items", type: "db" },
      cols: [],
      rows: [
        { _index: "0", [PathPropertyName]: "Relays & Devices/Old.md" },
        { _index: "1", [PathPropertyName]: "Relays & Devices/Other.md" },
      ],
    };
    const b3Superstate = {
      contextsIndex: new Map([[contextPath, { contextTable: b3OriginalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        b3Superstate.contextsIndex.set(contextPath, {
          contextTable: {
            ...b3OriginalTable,
            rows: [
              { _index: "1", [PathPropertyName]: "Relays & Devices/Other.md" },
            ],
          },
        });
      }),
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(
          async (_oldPath: string, newPath: string): Promise<string> => newPath
        ),
        saveTable,
      },
      ui: { notify: jest.fn() },
    } as any;

    const b3Result = await executeBulkPageTitleRename({
      items: [{ row: b3OriginalTable.rows[0], value: "New" }],
      contextPath,
      settleDelayMs: 0,
      superstate: b3Superstate,
    });

    expect(b3Result).toEqual({
      ok: false,
      applied: [],
      failures: [
        {
          row: b3OriginalTable.rows[0],
          value: "New",
          reason: "rename-failed",
        },
      ],
    });
    expect(saveTable).not.toHaveBeenCalled();
  });
});
