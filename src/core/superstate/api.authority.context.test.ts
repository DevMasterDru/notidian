/**
 * bd Notidian-1da (companion to api.authority.test.ts): integration nets for the
 * two authority-relevant context verbs whose VERB BODY was previously
 * unexercised — api.context.update's pre-gate DEFAULT (the :280 contract: an
 * unresolved field falls back to the context MDB, NOT frontmatter, which is the
 * opposite of api.path.setProperty) and api.context.insert's row-create write
 * path (api.ts:292-303).
 *
 * api.authority.test.ts already pins api.context.update's frontmatter / notidian
 * / computed routing; the gap it leaves is (a) the fallback-to-context default
 * for an unresolved column and (b) api.context.insert, which is not integration-
 * tested at all. insert routes a NEW path's whole row through saveProperties
 * (file YAML) after newPathInSpace, stripping only PathPropertyName, with NO
 * visible per-field authority gate. The insert cases below are CHARACTERIZATION:
 * they pin the verb's current behavior (every non-File field of the input row is
 * written to frontmatter, including a Notidian-/computed-typed field) so a future
 * authority-gate change to insert is a deliberate, test-visible decision rather
 * than a silent drift. See bd memory api-write-surface-authority-gated and ADR
 * 0001/0017.
 */
import { IndexMap } from "shared/types/indexMap";
import { ContextState, ISuperstate } from "shared/types/superstate";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { notidianPropertySource } from "core/utils/properties/propertyAuthority";
import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";

// Mock the durable write sinks so we can observe routing without any I/O —
// mirrors api.authority.test.ts so both files share the same fake-superstate
// harness and sink contract.
const updateValueInContext = jest.fn();
const saveProperties = jest.fn();
const newPathInSpace = jest.fn();

jest.mock("core/utils/contexts/context", () => ({
  __esModule: true,
  updateValueInContext: (...args: unknown[]) => updateValueInContext(...args),
  addRowInTable: jest.fn(),
  updateTableRow: jest.fn(),
}));

jest.mock("./utils/spaces", () => ({
  __esModule: true,
  saveProperties: (...args: unknown[]) => saveProperties(...args),
  newPathInSpace: (...args: unknown[]) => newPathInSpace(...args),
}));

// api.ts pulls in the heavy UI/menu graph (context menus, modals, makemd-core)
// only for methods these tests do not exercise. Stub them so the value-write
// routing under test can be imported without the React/menu dependency tree.
jest.mock("makemd-core", () => ({}));
jest.mock(
  "core/react/components/UI/Menus/contexts/rowContextMenu",
  () => ({ showRowContextMenu: jest.fn() })
);
jest.mock(
  "core/react/components/UI/Menus/navigator/pathContextMenu",
  () => ({ showPathContextMenu: jest.fn() })
);
jest.mock(
  "core/react/components/UI/Modals/ContextCreateItemModal",
  () => ({ openContextCreateItemModal: jest.fn() })
);

// Imported after mocks so the API picks up the mocked modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { API } = require("./api");

const contextTableWith = (cols: SpaceProperty[]): SpaceTable => ({
  schema: { id: "ctx", name: "ctx", type: "db" },
  cols,
  rows: [],
});

const buildSuperstate = (cols: SpaceProperty[]) => {
  const spacePath = "Folder";
  const filePath = "Folder/A.md";

  const spacesMap = new IndexMap();
  spacesMap.set(filePath, new Set([spacePath]));

  const contextsIndex = new Map<string, ContextState>([
    [
      spacePath,
      {
        path: spacePath,
        schemas: [],
        contextTable: contextTableWith(cols),
        outlinks: [],
        contexts: [],
        paths: [],
        spaceMap: {},
        dbExists: true,
        mdb: {},
      },
    ],
  ]);

  const spacesIndex = new Map<string, any>([
    [spacePath, { path: spacePath, space: { path: spacePath, name: "Folder" } }],
  ]);

  const superstate = {
    spacesMap,
    contextsIndex,
    spacesIndex,
    spaceManager: {} as any,
  } as unknown as ISuperstate;

  return { superstate, spacePath, filePath };
};

// api.context.insert is declared `async` but its default-schema branch does not
// await the newPathInSpace().then(...) that performs the saveProperties write,
// so `await api.context.insert(...)` resolves BEFORE the row lands. Flush the
// microtask + macrotask queues so the .then callback (and its saveProperties
// call) has actually run before we assert.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  updateValueInContext.mockClear();
  saveProperties.mockClear();
  newPathInSpace.mockClear();
});

describe("api.context.update pre-gate default (bd Notidian-1da, api.ts:280)", () => {
  // api.path.setProperty defaults an UNRESOLVED field to frontmatter; the
  // context.update verb defaults it to the context MDB. This asymmetry is the
  // pre-gate contract each verb preserves — pin context.update's side of it.
  it("falls back to the context MDB for an unresolved field (default 'context', unlike setProperty)", () => {
    const { superstate, spacePath, filePath } = buildSuperstate([]);
    const api = new API(superstate);

    api.context.update(spacePath, filePath, "ghost", "v");

    expect(updateValueInContext).toHaveBeenCalledTimes(1);
    expect(updateValueInContext).toHaveBeenCalledWith(
      superstate.spaceManager,
      filePath,
      "ghost",
      "v",
      { path: spacePath, name: "Folder" }
    );
    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("does nothing when the space is unknown (no spacesIndex entry)", () => {
    const { superstate, filePath } = buildSuperstate([
      { name: "status", type: "text", source: frontmatterPropertySource },
    ]);
    const api = new API(superstate);

    api.context.update("Missing", filePath, "status", "done");

    expect(saveProperties).not.toHaveBeenCalled();
    expect(updateValueInContext).not.toHaveBeenCalled();
  });
});

describe("api.context.insert row-create write path (bd Notidian-1da, api.ts:292-303)", () => {
  it("creates the path then writes the row's non-File fields to frontmatter for the default schema", async () => {
    const { superstate, spacePath } = buildSuperstate([]);
    const createdPath = "Folder/New.md";
    newPathInSpace.mockResolvedValue(createdPath);
    const api = new API(superstate);

    await api.context.insert(spacePath, defaultContextSchemaID, "New", {
      [PathPropertyName]: "should-be-stripped",
      status: "done",
      priority: "high",
    });
    await flushAsync();

    expect(newPathInSpace).toHaveBeenCalledTimes(1);
    expect(newPathInSpace).toHaveBeenCalledWith(
      superstate,
      superstate.spacesIndex.get(spacePath),
      "md",
      "New",
      true
    );
    // PathPropertyName is stripped; the remaining fields land in the new file's
    // YAML via saveProperties.
    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledWith(superstate, createdPath, {
      status: "done",
      priority: "high",
    });
    const writtenRow = saveProperties.mock.calls[0][2];
    expect(writtenRow).not.toHaveProperty(PathPropertyName);
    // The context MDB sink is never touched on the create path.
    expect(updateValueInContext).not.toHaveBeenCalled();
  });

  it("CHARACTERIZATION: insert has NO per-field authority gate — a Notidian-owned / computed field in the row still lands in frontmatter", async () => {
    // The space defines `manual` as source:notidian and `total` as a computed
    // rollup. On an UPDATE these would route to the context MDB / be skipped.
    // insert, however, applies no per-field gate: it saveProperties the whole
    // row (minus File) to the new file's YAML regardless of column authority.
    // This test documents the CURRENT behavior (bd Notidian-1da observation);
    // if insert later grows an authority gate, this expectation must change
    // deliberately rather than drift silently.
    const { superstate, spacePath } = buildSuperstate([
      { name: "manual", type: "text", source: notidianPropertySource },
      { name: "total", type: "rollup" },
    ]);
    const createdPath = "Folder/Leaky.md";
    newPathInSpace.mockResolvedValue(createdPath);
    const api = new API(superstate);

    await api.context.insert(spacePath, defaultContextSchemaID, "Leaky", {
      manual: "kept",
      total: "999",
    });
    await flushAsync();

    expect(saveProperties).toHaveBeenCalledTimes(1);
    // Current behavior: BOTH fields are written to frontmatter — there is no
    // gate routing `manual` to the MDB or skipping the computed `total`.
    expect(saveProperties).toHaveBeenCalledWith(superstate, createdPath, {
      manual: "kept",
      total: "999",
    });
    expect(updateValueInContext).not.toHaveBeenCalled();
  });

  it("creates the path even when the row is empty (no File key to strip)", async () => {
    const { superstate, spacePath } = buildSuperstate([]);
    const createdPath = "Folder/Empty.md";
    newPathInSpace.mockResolvedValue(createdPath);
    const api = new API(superstate);

    await api.context.insert(spacePath, defaultContextSchemaID, "Empty", {});
    await flushAsync();

    expect(newPathInSpace).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledWith(superstate, createdPath, {});
  });

  it("does NOT create a path for a non-default schema (routes to table.insert, no newPathInSpace)", async () => {
    // The non-default-schema branch reads the schema's table and delegates to
    // table.insert; it must NOT mint a new path via newPathInSpace nor write the
    // file YAML through the create-path saveProperties. With readTable resolving
    // to null the branch finds no table and writes nothing — pinning that the
    // create-path (newPathInSpace + saveProperties) is taken ONLY for the
    // default ("files") schema.
    const { superstate, spacePath } = buildSuperstate([]);
    const readTable = jest.fn().mockResolvedValue(null);
    const api = new API(superstate, { readTable } as any);

    await api.context.insert(spacePath, "custom-schema", "Row", { a: "1" });
    await flushAsync();

    expect(readTable).toHaveBeenCalledWith(spacePath, "custom-schema");
    expect(newPathInSpace).not.toHaveBeenCalled();
    expect(saveProperties).not.toHaveBeenCalled();
  });
});
