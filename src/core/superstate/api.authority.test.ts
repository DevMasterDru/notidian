/**
 * bd Notidian-1da: api.context.update and api.path.setProperty must route value
 * writes through the authority gate, exactly like the calendar/modal/header
 * edits. These integration tests construct the API over a fake superstate and
 * assert WHICH durable layer each verb writes to (frontmatter vs context MDB).
 */
import { IndexMap } from "shared/types/indexMap";
import { ContextState, ISuperstate } from "shared/types/superstate";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { notidianPropertySource } from "core/utils/properties/propertyAuthority";
import { frontmatterPropertySource } from "core/utils/properties/allProperties";

// Mock the durable write sinks so we can observe routing without any I/O.
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

beforeEach(() => {
  updateValueInContext.mockClear();
  saveProperties.mockClear();
  newPathInSpace.mockClear();
});

describe("api.context.update authority gate (bd Notidian-1da)", () => {
  it("routes a frontmatter-authority column to frontmatter, not the context MDB", () => {
    const { superstate, spacePath, filePath } = buildSuperstate([
      { name: "status", type: "text", source: frontmatterPropertySource },
    ]);
    const api = new API(superstate);

    api.context.update(spacePath, filePath, "status", "done");

    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledWith(superstate, filePath, {
      status: "done",
    });
    expect(updateValueInContext).not.toHaveBeenCalled();
  });

  it("routes a source:notidian column to the context MDB", () => {
    const { superstate, spacePath, filePath } = buildSuperstate([
      { name: "manual", type: "text", source: notidianPropertySource },
    ]);
    const api = new API(superstate);

    api.context.update(spacePath, filePath, "manual", "kept");

    expect(updateValueInContext).toHaveBeenCalledTimes(1);
    expect(updateValueInContext).toHaveBeenCalledWith(
      superstate.spaceManager,
      filePath,
      "manual",
      "kept",
      { path: spacePath, name: "Folder" }
    );
    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("writes nothing for a computed/read-only column", () => {
    const { superstate, spacePath, filePath } = buildSuperstate([
      { name: "total", type: "rollup" },
    ]);
    const api = new API(superstate);

    api.context.update(spacePath, filePath, "total", "999");

    expect(updateValueInContext).not.toHaveBeenCalled();
    expect(saveProperties).not.toHaveBeenCalled();
  });
});

describe("api.path.setProperty authority gate (bd Notidian-1da)", () => {
  it("routes a frontmatter-authority column to frontmatter (historical default preserved)", () => {
    const { superstate, filePath } = buildSuperstate([
      { name: "status", type: "text", source: frontmatterPropertySource },
    ]);
    const api = new API(superstate);

    api.path.setProperty(filePath, "status", "done");

    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(saveProperties).toHaveBeenCalledWith(superstate, filePath, {
      status: "done",
    });
    expect(updateValueInContext).not.toHaveBeenCalled();
  });

  it("routes a source:notidian column to the context MDB instead of frontmatter", () => {
    const { superstate, spacePath, filePath } = buildSuperstate([
      { name: "manual", type: "text", source: notidianPropertySource },
    ]);
    const api = new API(superstate);

    api.path.setProperty(filePath, "manual", "kept");

    expect(updateValueInContext).toHaveBeenCalledTimes(1);
    expect(updateValueInContext).toHaveBeenCalledWith(
      superstate.spaceManager,
      filePath,
      "manual",
      "kept",
      { path: spacePath, name: "Folder" }
    );
    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("falls back to frontmatter for an unresolved column (no context definition)", () => {
    const { superstate, filePath } = buildSuperstate([]);
    const api = new API(superstate);

    api.path.setProperty(filePath, "ghost", "v");

    expect(saveProperties).toHaveBeenCalledTimes(1);
    expect(updateValueInContext).not.toHaveBeenCalled();
  });
});

describe("api.path.create return contract (bd Notidian-0le / te8)", () => {
  it("resolves to the created path when content is a plain string", async () => {
    const { superstate, spacePath } = buildSuperstate([]);
    newPathInSpace.mockResolvedValue("Folder/New.md");
    const api = new API(superstate);

    const result = await api.path.create("New", spacePath, "md", "");

    expect(result).toBe("Folder/New.md");
    expect(newPathInSpace).toHaveBeenCalledTimes(1);
  });

  it("resolves to the created path when content is a Promise (regression: async branch no longer drops the result)", async () => {
    const { superstate, spacePath } = buildSuperstate([]);
    newPathInSpace.mockResolvedValue("Folder/Async.md");
    const api = new API(superstate);

    // The async-content branch previously used a block-body `.then` that
    // returned undefined, so the caller could not target the created path.
    const result = await api.path.create(
      "Async",
      spacePath,
      "md",
      Promise.resolve("body")
    );

    expect(result).toBe("Folder/Async.md");
    // The resolved content string is forwarded to newPathInSpace.
    expect(newPathInSpace).toHaveBeenCalledWith(
      superstate,
      expect.anything(),
      "md",
      "Async",
      true,
      "body"
    );
  });
});
