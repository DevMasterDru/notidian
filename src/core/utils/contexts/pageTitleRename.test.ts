import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  executeBulkPageTitleRename,
  planBulkPageTitleRename,
  renamePageTitleForRow,
  renamePageTitleForRowWithResult,
} from "./pageTitleRename";

describe("renamePageTitleForRow", () => {
  it("returns a successful transaction result for renamed file paths", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath: jest.fn(
            async (_oldPath: string, newPath: string): Promise<string> =>
              newPath
          ),
        },
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result).toEqual({
      ok: true,
      path: "Relays & Devices/New.md",
      changed: true,
    });
  });

  it("returns a deterministic reason for invalid title values", async () => {
    const notify = jest.fn();

    const result = await renamePageTitleForRowWithResult({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New/Folder",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(),
          renamePath: jest.fn(),
        },
        ui: { notify },
      } as any,
    });

    expect(result).toEqual({ ok: false, reason: "slash" });
    expect(notify).toHaveBeenCalledWith(
      "Use the move command to change folders. File names cannot contain '/'."
    );
  });

  it("returns a deterministic reason when the target path already exists", async () => {
    const result = await renamePageTitleForRowWithResult({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "Existing",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => true),
          renamePath: jest.fn(),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result).toEqual({ ok: false, reason: "duplicate" });
  });

  it("catches failed filesystem renames and preserves wrapper null behavior", async () => {
    const notify = jest.fn();
    const error = new Error("permission denied");
    const superstate = {
      spaceManager: {
        pathExists: jest.fn(async (): Promise<boolean> => false),
        renamePath: jest.fn(async (): Promise<string> => {
          throw error;
        }),
      },
      ui: { notify },
    } as any;

    const result = await renamePageTitleForRowWithResult({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate,
    });
    const wrapperResult = await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate,
    });

    expect(result).toEqual({
      ok: false,
      reason: "rename-failed",
      error,
    });
    expect(wrapperResult).toBeNull();
    expect(notify).toHaveBeenCalledWith("Could not rename the file.");
  });

  it("renames the underlying file instead of writing a context value", async () => {
    const renamePath = jest.fn(
      async (_oldPath: string, newPath: string): Promise<string> => newPath
    );
    const pathExists = jest.fn(async (path: string) =>
      path.endsWith("Existing.md")
    );
    const reloadContextByPath = jest.fn(async (): Promise<void> => undefined);
    const notify = jest.fn();

    const result = await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate: {
        spaceManager: { pathExists, renamePath },
        reloadContextByPath,
        ui: { notify },
      } as any,
    });

    expect(result).toBe("Relays & Devices/New.md");
    expect(renamePath).toHaveBeenCalledWith(
      "Relays & Devices/Old.md",
      "Relays & Devices/New.md"
    );
    expect(reloadContextByPath).toHaveBeenCalledWith("Relays & Devices", {
      force: true,
      calculate: true,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects duplicate target paths", async () => {
    const renamePath = jest.fn();
    const notify = jest.fn();

    const result = await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "Existing",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async () => true),
          renamePath,
        },
        ui: { notify },
      } as any,
    });

    expect(result).toBeNull();
    expect(renamePath).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });

  it("treats an unchanged title as a no-op", async () => {
    const renamePath = jest.fn();
    const notify = jest.fn();

    const result = await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "Old",
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async () => true),
          renamePath,
        },
        ui: { notify },
      } as any,
    });

    expect(result).toBe("Relays & Devices/Old.md");
    expect(renamePath).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("preserves the row position when metadata sync appends the renamed path", async () => {
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const contextPath = "Relays & Devices";
    const contextTable: SpaceTable = {
      schema: { id: "files", name: "Items", type: "db" },
      cols: [],
      rows: [
        { [PathPropertyName]: "Relays & Devices/Old.md" },
        { [PathPropertyName]: "Relays & Devices/Other.md" },
      ],
    };
    const superstate = {
      contextsIndex: new Map([[contextPath, { contextTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        superstate.contextsIndex.set(contextPath, {
          contextTable: {
            ...contextTable,
            rows: [
              { [PathPropertyName]: "Relays & Devices/Other.md" },
              { [PathPropertyName]: "Relays & Devices/New.md" },
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

    await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New",
      contextPath,
      settleDelayMs: 0,
      superstate,
    });

    expect(saveTable).toHaveBeenCalledWith(
      contextPath,
      {
        ...contextTable,
        rows: [
          { [PathPropertyName]: "Relays & Devices/New.md" },
          { [PathPropertyName]: "Relays & Devices/Other.md" },
        ],
      },
      true
    );
  });

  it("removes duplicate renamed rows while preserving the original row position", async () => {
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const contextPath = "Relays & Devices";
    const contextTable: SpaceTable = {
      schema: { id: "files", name: "Items", type: "db" },
      cols: [],
      rows: [
        { [PathPropertyName]: "Relays & Devices/Old.md" },
        { [PathPropertyName]: "Relays & Devices/Other.md" },
      ],
    };
    const superstate = {
      contextsIndex: new Map([[contextPath, { contextTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        superstate.contextsIndex.set(contextPath, {
          contextTable: {
            ...contextTable,
            rows: [
              { [PathPropertyName]: "Relays & Devices/Other.md" },
              { [PathPropertyName]: "Relays & Devices/New.md" },
              { [PathPropertyName]: "Relays & Devices/New.md" },
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

    await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New",
      contextPath,
      settleDelayMs: 0,
      superstate,
    });

    expect(saveTable).toHaveBeenCalledWith(
      contextPath,
      {
        ...contextTable,
        rows: [
          { [PathPropertyName]: "Relays & Devices/New.md" },
          { [PathPropertyName]: "Relays & Devices/Other.md" },
        ],
      },
      true
    );
  });
});

describe("bulk page title rename transactions", () => {
  it("preflights invalid titles before renaming any files", async () => {
    const renamePath = jest.fn();

    const result = await planBulkPageTitleRename({
      items: [
        { row: { [PathPropertyName]: "Relays & Devices/A.md" }, value: "" },
        {
          row: { [PathPropertyName]: "Relays & Devices/B.md" },
          value: "Folder/B",
        },
      ],
      contextPath: "Relays & Devices",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
          renamePath,
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result).toEqual({
      ok: false,
      failures: [
        {
          row: { [PathPropertyName]: "Relays & Devices/A.md" },
          value: "",
          reason: "empty",
        },
        {
          row: { [PathPropertyName]: "Relays & Devices/B.md" },
          value: "Folder/B",
          reason: "slash",
        },
      ],
    });
    expect(renamePath).not.toHaveBeenCalled();
  });

  it("rejects duplicate target paths inside the same batch", async () => {
    const result = await planBulkPageTitleRename({
      items: [
        { row: { [PathPropertyName]: "Relays & Devices/A.md" }, value: "X" },
        { row: { [PathPropertyName]: "Relays & Devices/B.md" }, value: "X" },
      ],
      contextPath: "Relays & Devices",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result).toEqual({
      ok: false,
      failures: [
        {
          row: { [PathPropertyName]: "Relays & Devices/B.md" },
          value: "X",
          reason: "internal-duplicate",
        },
      ],
    });
  });

  it("rejects existing target paths outside the selected rename set", async () => {
    const result = await planBulkPageTitleRename({
      items: [
        {
          row: { [PathPropertyName]: "Relays & Devices/A.md" },
          value: "Existing",
        },
      ],
      contextPath: "Relays & Devices",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => true),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result).toEqual({
      ok: false,
      failures: [
        {
          row: { [PathPropertyName]: "Relays & Devices/A.md" },
          value: "Existing",
          reason: "duplicate",
        },
      ],
    });
  });

  it("uses temporary paths when two files swap names", async () => {
    const renamePath = jest.fn(
      async (_oldPath: string, newPath: string): Promise<string> => newPath
    );

    const result = await executeBulkPageTitleRename({
      items: [
        { row: { [PathPropertyName]: "Relays & Devices/A.md" }, value: "B" },
        { row: { [PathPropertyName]: "Relays & Devices/B.md" }, value: "A" },
      ],
      contextPath: "Relays & Devices",
      settleDelayMs: 0,
      superstate: {
        contextsIndex: new Map([
          [
            "Relays & Devices",
            {
              contextTable: {
                schema: { id: "files", name: "Files", type: "db" },
                cols: [],
                rows: [
                  { [PathPropertyName]: "Relays & Devices/A.md" },
                  { [PathPropertyName]: "Relays & Devices/B.md" },
                ],
              } as SpaceTable,
            },
          ],
        ]),
        reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
        spaceManager: {
          pathExists: jest.fn(async (path: string): Promise<boolean> =>
            ["Relays & Devices/A.md", "Relays & Devices/B.md"].includes(path)
          ),
          renamePath,
          saveTable: jest.fn(async (): Promise<void> => undefined),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result.ok).toBe(true);
    expect(renamePath).toHaveBeenCalledTimes(4);
    expect(renamePath.mock.calls[0][0]).toBe("Relays & Devices/A.md");
    expect(renamePath.mock.calls[0][1]).toContain(".notidian-renaming-");
    expect(renamePath.mock.calls[1][0]).toBe("Relays & Devices/B.md");
    expect(renamePath.mock.calls[1][1]).toContain(".notidian-renaming-");
    expect(renamePath.mock.calls[2][1]).toBe("Relays & Devices/B.md");
    expect(renamePath.mock.calls[3][1]).toBe("Relays & Devices/A.md");
  });

  it("preserves context row order and removes duplicate rows after bulk rename", async () => {
    const contextPath = "Relays & Devices";
    const originalTable: SpaceTable = {
      schema: { id: "files", name: "Items", type: "db" },
      cols: [],
      rows: [
        { [PathPropertyName]: "Relays & Devices/A.md" },
        { [PathPropertyName]: "Relays & Devices/B.md" },
        { [PathPropertyName]: "Relays & Devices/C.md" },
      ],
    };
    const saveTable = jest.fn(async (): Promise<void> => undefined);
    const superstate = {
      contextsIndex: new Map([[contextPath, { contextTable: originalTable }]]),
      reloadContextByPath: jest.fn(async (): Promise<void> => {
        superstate.contextsIndex.set(contextPath, {
          contextTable: {
            ...originalTable,
            rows: [
              { [PathPropertyName]: "Relays & Devices/C.md" },
              { [PathPropertyName]: "Relays & Devices/Y.md" },
              { [PathPropertyName]: "Relays & Devices/X.md" },
              { [PathPropertyName]: "Relays & Devices/X.md" },
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

    const result = await executeBulkPageTitleRename({
      items: [
        { row: { [PathPropertyName]: "Relays & Devices/A.md" }, value: "X" },
        { row: { [PathPropertyName]: "Relays & Devices/B.md" }, value: "Y" },
      ],
      contextPath,
      settleDelayMs: 0,
      superstate,
    });

    expect(result.ok).toBe(true);
    expect(saveTable).toHaveBeenCalledWith(
      contextPath,
      {
        ...originalTable,
        rows: [
          { [PathPropertyName]: "Relays & Devices/X.md" },
          { [PathPropertyName]: "Relays & Devices/Y.md" },
          { [PathPropertyName]: "Relays & Devices/C.md" },
        ],
      },
      true
    );
  });
});
