import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { notidianPropertySource } from "core/utils/properties/propertyAuthority";
import { defaultContextDBSchema } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { FilesystemMiddleware } from "core/middleware/filesystem";
import { FilesystemSpaceAdapter } from "./filesystemAdapter";

describe("FilesystemSpaceAdapter invalidation bridge", () => {
  it("forwards internal path invalidation directly to Superstate", () => {
    const middleware = FilesystemMiddleware.create();
    const adapter = new FilesystemSpaceAdapter(middleware, ".notidian");
    const invalidatePath = jest.fn();
    adapter.initiateAdapter({ superstate: { invalidatePath } } as any);

    middleware.onPathInvalidated("Deleted.md");

    expect(invalidatePath).toHaveBeenCalledWith("Deleted.md");
  });

  it("propagates path creation promises through EventDispatcher", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => { resolve = done; });
    const middleware = FilesystemMiddleware.create();
    const adapter = new FilesystemSpaceAdapter(middleware, ".notidian");
    const onPathCreated = jest.fn(() => gate);
    adapter.initiateAdapter({ onPathCreated } as any);
    let settled = false;

    const dispatched = middleware.eventDispatch.dispatchEvent("onCreate", {
      file: { path: "Queued.md", extension: "md", isFolder: false } as any,
    }).then(() => { settled = true; });
    await Promise.resolve();

    expect(settled).toBe(false);
    resolve();
    await dispatched;
    expect(onPathCreated).toHaveBeenCalledWith("Queued.md");
  });

  it("propagates path change promises through EventDispatcher", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => { resolve = done; });
    const middleware = FilesystemMiddleware.create();
    const adapter = new FilesystemSpaceAdapter(middleware, ".notidian");
    const onPathChanged = jest.fn(() => gate);
    adapter.initiateAdapter({ onPathChanged } as any);
    let settled = false;

    const dispatched = middleware.eventDispatch.dispatchEvent("onRename", {
      file: { path: "New.md", extension: "md", isFolder: false } as any,
      oldPath: "Old.md",
    }).then(() => { settled = true; });
    await Promise.resolve();

    expect(settled).toBe(false);
    resolve();
    await dispatched;
    expect(onPathChanged).toHaveBeenCalledWith("New.md", "Old.md");
  });

  it("rejects rename publication when the production lifecycle returns false", async () => {
    const middleware = FilesystemMiddleware.create();
    const adapter = new FilesystemSpaceAdapter(middleware, ".notidian");
    adapter.initiateAdapter({ onPathChanged: jest.fn().mockResolvedValue(false) } as any);
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(middleware.onRename({ path: "New.md", extension: "md", isFolder: false } as any, "Old.md"))
      .rejects.toEqual(expect.objectContaining({
        name: "AggregateError",
        errors: [expect.objectContaining({ message: expect.stringContaining("Rename lifecycle rejected") })],
      }));
    errorLog.mockRestore();
  });

  it("propagates path deletion listener rejection through the explicit boundary", async () => {
    const middleware = FilesystemMiddleware.create();
    const adapter = new FilesystemSpaceAdapter(middleware, ".notidian");
    adapter.initiateAdapter({
      onPathDeleted: jest.fn().mockRejectedValue(new Error("lifecycle failed")),
    } as any);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(middleware.onDelete({ path: "Deleted.md", isFolder: false } as any, true))
      .rejects.toEqual(expect.objectContaining({
        name: "AggregateError",
        errors: [expect.objectContaining({ message: "lifecycle failed" })],
      }));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("FilesystemSpaceAdapter.saveTable", () => {
  it("returns an empty table for stale or unindexed context paths", async () => {
    const fileSystem = {
      eventDispatch: {
        addListener: jest.fn(),
      },
      getFile: jest.fn(),
    };
    const adapter = new FilesystemSpaceAdapter(fileSystem as any, ".notidian");
    jest.spyOn(adapter, "spaceInfoForPath").mockReturnValue(null);

    const table = await adapter.readTable(
      "Deleted Or Unindexed Space",
      defaultContextDBSchema.id
    );

    expect(fileSystem.getFile).not.toHaveBeenCalled();
    expect(table.schema).toEqual(defaultContextDBSchema);
    expect(table.cols).toEqual(defaultContextFields.rows);
    expect(table.rows).toEqual([]);
  });

  it("strips frontmatter-backed row values before saving context tables", async () => {
    const savedTables: SpaceTable[] = [];
    const fileSystem = {
      eventDispatch: {
        addListener: jest.fn(),
      },
      getFile: jest.fn(async () => ({ path: "Relays & Devices/.space/context.mdb" })),
      saveFileFragment: jest.fn(async (_file, _type, _id, content) => {
        savedTables.push(content({}));
        return true;
      }),
    };
    const adapter = new FilesystemSpaceAdapter(fileSystem as any, ".notidian");
    jest.spyOn(adapter, "spaceInfoForPath").mockReturnValue({
      dbPath: "Relays & Devices/.space/context.mdb",
    } as any);

    await adapter.saveTable(
      "Relays & Devices",
      {
        schema: defaultContextDBSchema,
        cols: [
          ...(defaultContextFields.rows as any),
          {
            name: "status",
            schemaId: "files",
            type: "text",
            value: "",
            source: frontmatterPropertySource,
          },
          {
            name: "manual",
            schemaId: "files",
            type: "text",
            value: "",
            source: notidianPropertySource,
          },
        ],
        rows: [
          {
            [PathPropertyName]: "Relays & Devices/a.md",
            status: "active",
            manual: "context-only",
          },
        ],
      },
      false
    );

    expect(savedTables[0].rows).toEqual([
      {
        [PathPropertyName]: "Relays & Devices/a.md",
        manual: "context-only",
      },
    ]);
  });
});
