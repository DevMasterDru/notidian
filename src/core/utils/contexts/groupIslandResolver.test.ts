import {
  extractKeyMatchFromColumn,
  resolveGroupIslandFields,
} from "core/utils/contexts/groupIslandResolver";
import { KeyMatchRelationConfig } from "core/utils/contexts/keyMatchResolver";

// ===========================================================================
// Unit tests for grouping island header resolution (Notidian-mx0k.2).
//
// resolveGroupIslandFields is a pure function: given unique group values,
// a key-match config, a superstate, and a list of target fields, it returns
// a Map from group value to resolved field values from the target record's
// frontmatter. Read-only; never writes.
//
// Tests cover:
//   1. Correct field resolution per group value
//   2. One resolution per group, not per row (deduplication)
//   3. Empty/missing group values
//   4. Missing target paths
//   5. Missing frontmatter fields
//   6. extractKeyMatchFromColumn
// ===========================================================================

// Minimal superstate factory matching the production shape.
const makeSuperstate = (
  folders: Record<string, Record<string, Record<string, any>>>
) => {
  const pathsIndex = new Map<string, any>();
  const contextsIndex = new Map<string, any>();

  for (const [folder, files] of Object.entries(folders)) {
    const paths: string[] = [];
    for (const [filePath, property] of Object.entries(files)) {
      paths.push(filePath);
      pathsIndex.set(filePath, { metadata: { property } });
    }
    contextsIndex.set(folder, { paths });
  }

  return { pathsIndex, contextsIndex } as any;
};

const cfg = (
  over?: Partial<KeyMatchRelationConfig>
): KeyMatchRelationConfig => ({
  type: "key-match",
  sourceField: "board_id",
  targetFolder: "Hardware/Boards",
  targetField: "board_id",
  ...over,
});

const boardSuperstate = makeSuperstate({
  "Hardware/Boards": {
    "Hardware/Boards/slave-1.md": {
      board_id: "1",
      board_name: "Alpha Board",
      model: "23IOB16",
      board_type: "SSR",
      channels: "16CH",
    },
    "Hardware/Boards/slave-2.md": {
      board_id: "2",
      board_name: "Fill, Tap & Other Sols",
      model: "23IOB16",
      board_type: "SSR",
      channels: "16CH",
    },
    "Hardware/Boards/slave-3.md": {
      board_id: "3",
      board_name: "Nute Peris",
      model: "23IOD32",
      board_type: "SSR",
      channels: "32CH",
    },
  },
});

describe("resolveGroupIslandFields", () => {
  it("resolves correct fields for each group value", () => {
    const result = resolveGroupIslandFields(
      boardSuperstate,
      ["1", "2", "3"],
      cfg(),
      ["board_name", "model", "board_type", "channels"]
    );

    expect(result.size).toBe(3);
    expect(result.get("1")).toEqual([
      "Alpha Board",
      "23IOB16",
      "SSR",
      "16CH",
    ]);
    expect(result.get("2")).toEqual([
      "Fill, Tap & Other Sols",
      "23IOB16",
      "SSR",
      "16CH",
    ]);
    expect(result.get("3")).toEqual(["Nute Peris", "23IOD32", "SSR", "32CH"]);
  });

  it("resolves each group value exactly once even when duplicated", () => {
    // Simulate what happens when multiple rows have the same group value:
    // the caller passes ["2", "2", "2", "3", "3"] — the resolver should
    // still resolve "2" and "3" only once each.
    const spy = jest.spyOn(boardSuperstate.contextsIndex, "get");

    const result = resolveGroupIslandFields(
      boardSuperstate,
      ["2", "2", "2", "3", "3"],
      cfg(),
      ["board_name"]
    );

    // Two unique values resolved
    expect(result.size).toBe(2);
    expect(result.get("2")).toEqual(["Fill, Tap & Other Sols"]);
    expect(result.get("3")).toEqual(["Nute Peris"]);

    // contextsIndex.get was called exactly TWICE (once per unique value),
    // NOT five times (once per row input).
    const targetFolderCalls = spy.mock.calls.filter(
      ([key]) => key === "Hardware/Boards"
    );
    expect(targetFolderCalls.length).toBe(2);

    spy.mockRestore();
  });

  it("returns empty map for empty group values", () => {
    const result = resolveGroupIslandFields(
      boardSuperstate,
      ["", "   "],
      cfg(),
      ["board_name"]
    );
    expect(result.size).toBe(0);
  });

  it("returns empty map when no groups provided", () => {
    const result = resolveGroupIslandFields(
      boardSuperstate,
      [],
      cfg(),
      ["board_name"]
    );
    expect(result.size).toBe(0);
  });

  it("returns empty map when fields list is empty", () => {
    const result = resolveGroupIslandFields(
      boardSuperstate,
      ["1", "2"],
      cfg(),
      []
    );
    expect(result.size).toBe(0);
  });

  it("omits groups whose key does not match any target row", () => {
    const result = resolveGroupIslandFields(
      boardSuperstate,
      ["1", "999"],
      cfg(),
      ["board_name"]
    );
    expect(result.size).toBe(1);
    expect(result.get("1")).toEqual(["Alpha Board"]);
    expect(result.has("999")).toBe(false);
  });

  it("omits fields that are null/undefined/empty on the target", () => {
    const ss = makeSuperstate({
      DB: {
        "DB/a.md": { key: "x", name: "Alpha", desc: null, notes: "" },
      },
    });
    const result = resolveGroupIslandFields(
      ss,
      ["x"],
      cfg({ targetFolder: "DB", targetField: "key" }),
      ["name", "desc", "notes", "missing_field"]
    );
    expect(result.get("x")).toEqual(["Alpha"]);
  });

  it("omits groups entirely when all requested fields are empty/missing", () => {
    const ss = makeSuperstate({
      DB: {
        "DB/a.md": { key: "x" },
      },
    });
    const result = resolveGroupIslandFields(
      ss,
      ["x"],
      cfg({ targetFolder: "DB", targetField: "key" }),
      ["nonexistent_field"]
    );
    expect(result.size).toBe(0);
  });

  it("uses the first matched path when multiple rows share the same key", () => {
    const ss = makeSuperstate({
      DB: {
        "DB/a.md": { key: "dup", label: "First" },
        "DB/b.md": { key: "dup", label: "Second" },
      },
    });
    const result = resolveGroupIslandFields(
      ss,
      ["dup"],
      cfg({ targetFolder: "DB", targetField: "key" }),
      ["label"]
    );
    // Uses the first match (iteration order of contextsIndex.paths)
    expect(result.get("dup")).toEqual(["First"]);
  });

  it("never throws for any well-formed superstate (totality)", () => {
    expect(() =>
      resolveGroupIslandFields(
        { pathsIndex: new Map(), contextsIndex: new Map() } as any,
        ["a", "b", "c"],
        cfg(),
        ["field1", "field2"]
      )
    ).not.toThrow();
  });

  it("never mutates the superstate", () => {
    const before = JSON.stringify([...boardSuperstate.pathsIndex.entries()]);
    resolveGroupIslandFields(
      boardSuperstate,
      ["1", "2"],
      cfg(),
      ["board_name"]
    );
    expect(JSON.stringify([...boardSuperstate.pathsIndex.entries()])).toBe(
      before
    );
  });
});

describe("extractKeyMatchFromColumn", () => {
  it("extracts valid key-match config from a column's value JSON", () => {
    const column = {
      name: "rollup",
      schemaId: "files",
      type: "rollup",
      table: "",
      value: JSON.stringify({
        ref: "board_ref",
        field: "board_name",
        fn: "values",
        keyMatch: {
          type: "key-match",
          sourceField: "board_id",
          targetFolder: "Hardware/Boards",
          targetField: "board_id",
        },
      }),
    };
    const result = extractKeyMatchFromColumn(column);
    expect(result).toEqual({
      type: "key-match",
      sourceField: "board_id",
      targetFolder: "Hardware/Boards",
      targetField: "board_id",
    });
  });

  it("returns null for a column with no value", () => {
    expect(extractKeyMatchFromColumn({ value: "" } as any)).toBeNull();
    expect(extractKeyMatchFromColumn({ value: undefined } as any)).toBeNull();
    expect(extractKeyMatchFromColumn(undefined)).toBeNull();
    expect(extractKeyMatchFromColumn(null)).toBeNull();
  });

  it("returns null for a column with invalid JSON", () => {
    expect(
      extractKeyMatchFromColumn({ value: "not json" } as any)
    ).toBeNull();
  });

  it("returns null when the parsed value has no keyMatch", () => {
    expect(
      extractKeyMatchFromColumn({
        value: JSON.stringify({ ref: "x", field: "y", fn: "count" }),
      } as any)
    ).toBeNull();
  });

  it("returns null when keyMatch is invalid (missing required fields)", () => {
    expect(
      extractKeyMatchFromColumn({
        value: JSON.stringify({
          keyMatch: { type: "key-match", sourceField: "", targetFolder: "X", targetField: "y" },
        }),
      } as any)
    ).toBeNull();
  });
});
