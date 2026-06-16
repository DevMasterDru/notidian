/**
 * bd Notidian-1da (companion to api.authority.test.ts): integration nets for the
 * two authority-relevant context verbs whose VERB BODY was previously
 * unexercised — api.context.update's pre-gate DEFAULT (the :280 contract: an
 * unresolved field falls back to the context MDB, NOT frontmatter, which is the
 * opposite of api.path.setProperty) and api.context.insert's row-create write
 * path (api.ts default-schema branch).
 *
 * api.authority.test.ts already pins api.context.update's frontmatter / notidian
 * / computed routing; the gap it leaves is (a) the fallback-to-context default
 * for an unresolved column and (b) api.context.insert, which is not integration-
 * tested at all. insert routes a NEW path's whole row after newPathInSpace,
 * stripping PathPropertyName.
 *
 * As of ADR 0044 / bd Notidian-2yh, insert is GATED: it was the last un-gated
 * value-write verb, an authority hole inconsistent with update/setProperty. It
 * now routes each input field through the same apiFieldWriteTarget gate (default
 * "frontmatter", the seed-the-visible-file job): a declared source:"notidian" /
 * context-only field lands in the context MDB, a computed field is dropped, and
 * ordinary frontmatter / unresolved fields still seed the new file's YAML via
 * saveProperties. The insert cases below pin that gated behavior; the prior
 * CHARACTERIZATION (both manual+total -> frontmatter) was deliberately re-blessed
 * when Option B was implemented (ADR 0044). See bd memory
 * api-write-surface-authority-gated and ADR 0001/0014/0017.
 *
 * REVIEW FIX (bd Notidian-2yh): the create-path MDB sink is addRowInTable, NOT
 * updateValueInContext. On row-CREATE the new path's MDB row does not exist yet
 * (newPathInSpace writes only the file + its frontmatter), and
 * updateValueInContext mutates ONLY an existing row — it is a silent no-op when no
 * row matches, so the context field would be dropped (persisted nowhere, worse
 * than the un-gated YAML leak). addRowInTable INSERTS the row, carrying the path
 * identity so the later reload reconciliation merges rather than duplicates. These
 * tests assert the INSERT, not the (wrong) update primitive.
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
const addRowInTable = jest.fn();
const saveProperties = jest.fn();
const newPathInSpace = jest.fn();

jest.mock("core/utils/contexts/context", () => ({
  __esModule: true,
  updateValueInContext: (...args: unknown[]) => updateValueInContext(...args),
  addRowInTable: (...args: unknown[]) => addRowInTable(...args),
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
  addRowInTable.mockClear();
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

describe("api.context.insert row-create write path (bd Notidian-1da / Notidian-2yh, ADR 0044 gate)", () => {
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
    // The context MDB sink is never touched when no field routes there.
    expect(addRowInTable).not.toHaveBeenCalled();
    expect(updateValueInContext).not.toHaveBeenCalled();
  });

  it("GATED (ADR 0044, bd Notidian-2yh): routes a Notidian-owned field to the context MDB and drops a computed field, instead of leaking both to frontmatter", async () => {
    // The space defines `manual` as source:notidian and `total` as a computed
    // rollup. On an UPDATE these route to the context MDB / are skipped; insert
    // now applies the SAME gate (ADR 0044 Option B — close the last un-gated
    // value-write verb). This DELIBERATELY re-blesses the prior characterization,
    // which pinned the un-gated "both -> frontmatter" hole (bd Notidian-1da
    // observation): `manual`'s only durable home is the MDB, so seeding it into
    // the new file's YAML re-introduced the frontmatter-vs-MDB split the gate
    // exists to prevent, and the computed `total` was a persisted derived value.
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

    // Gated behavior: saveProperties is still called (the create-path contract),
    // but with the gated subset — neither `manual` (MDB-owned) nor `total`
    // (computed) lands in the new file's YAML.
    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledWith(superstate, createdPath, {});
    // `manual` lands in its declared durable home, the new path's context MDB —
    // INSERTED as a new row (the create-path primitive), carrying the path
    // identity. updateValueInContext (update-only, silent no-op on a missing row)
    // must NOT be used here.
    expect(updateValueInContext).not.toHaveBeenCalled();
    expect(addRowInTable).toHaveBeenCalledTimes(1);
    expect(addRowInTable).toHaveBeenCalledWith(
      superstate.spaceManager,
      { [PathPropertyName]: createdPath, manual: "kept" },
      { path: spacePath, name: "Folder" },
      defaultContextSchemaID
    );
  });

  it("GATED: a mixed row seeds ordinary frontmatter fields to YAML while routing a Notidian field to the MDB", async () => {
    // The seed-the-visible-file job is preserved for ordinary metadata: only the
    // authority-declared field is partitioned away to the MDB.
    const { superstate, spacePath } = buildSuperstate([
      { name: "manual", type: "text", source: notidianPropertySource },
    ]);
    const createdPath = "Folder/Mixed.md";
    newPathInSpace.mockResolvedValue(createdPath);
    const api = new API(superstate);

    await api.context.insert(spacePath, defaultContextSchemaID, "Mixed", {
      status: "done",
      manual: "kept",
    });
    await flushAsync();

    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledWith(superstate, createdPath, {
      status: "done",
    });
    expect(updateValueInContext).not.toHaveBeenCalled();
    expect(addRowInTable).toHaveBeenCalledTimes(1);
    expect(addRowInTable).toHaveBeenCalledWith(
      superstate.spaceManager,
      { [PathPropertyName]: createdPath, manual: "kept" },
      { path: spacePath, name: "Folder" },
      defaultContextSchemaID
    );
  });

  it("REGRESSION (bd Notidian-2yh review): bundles MULTIPLE context-only fields into ONE inserted row and never uses the update primitive on create", async () => {
    // Two declared source:"notidian" columns. The create-path MUST insert a
    // single row carrying both values plus the path identity — not call the
    // update-only updateValueInContext (which maps over existing rows and is a
    // silent no-op when the new path's row does not exist yet, dropping the
    // values entirely). This pins the data-loss fix: the chosen sink can CREATE
    // the row.
    const { superstate, spacePath } = buildSuperstate([
      { name: "manual", type: "text", source: notidianPropertySource },
      { name: "owner", type: "text", source: notidianPropertySource },
    ]);
    const createdPath = "Folder/Multi.md";
    newPathInSpace.mockResolvedValue(createdPath);
    const api = new API(superstate);

    await api.context.insert(spacePath, defaultContextSchemaID, "Multi", {
      manual: "a",
      owner: "b",
    });
    await flushAsync();

    // No context field leaks to YAML; saveProperties still called (empty subset).
    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledWith(superstate, createdPath, {});
    // Exactly one INSERT, both fields in one row, never the update primitive.
    expect(updateValueInContext).not.toHaveBeenCalled();
    expect(addRowInTable).toHaveBeenCalledTimes(1);
    expect(addRowInTable).toHaveBeenCalledWith(
      superstate.spaceManager,
      { [PathPropertyName]: createdPath, manual: "a", owner: "b" },
      { path: spacePath, name: "Folder" },
      defaultContextSchemaID
    );
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
