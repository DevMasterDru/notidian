import {
  isKeyMatchConfig,
  KeyMatchRelationConfig,
  resolveKeyMatch,
} from "core/utils/contexts/keyMatchResolver";

// ===========================================================================
// Unit + property tests for the key-match FK resolution engine
// (Notidian-mx0k.1). resolveKeyMatch is a pure function: given a source value,
// a key-match config, and a superstate, it returns the file paths in the target
// folder whose targetField matches the source value. Read-only; never writes.
//
// Tests cover: match found, no match, multiple matches, case sensitivity,
// array-valued targets, null/empty handling, and determinism (property tests).
// ===========================================================================

// Minimal superstate factory matching the production shape used by the rollup
// runtime tests. contextsIndex.get(folder).paths lists the rows (file paths);
// pathsIndex.get(path).metadata.property holds the frontmatter.
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

  return {
    pathsIndex,
    contextsIndex,
    spacesIndex: new Map(),
    spaceManager: {
      resolvePath: (link: string) => link,
    },
  } as any;
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

describe("resolveKeyMatch", () => {
  const superstate = makeSuperstate({
    "Hardware/Boards": {
      "Hardware/Boards/Board A.md": { board_id: "1", name: "Alpha" },
      "Hardware/Boards/Board B.md": { board_id: "2", name: "Beta" },
      "Hardware/Boards/Board C.md": { board_id: "3", name: "Gamma" },
      "Hardware/Boards/Board D.md": { board_id: "2", name: "Delta" }, // duplicate key
    },
  });

  it("returns matched file paths when targetField matches sourceValue", () => {
    expect(resolveKeyMatch(superstate, "1", cfg())).toEqual([
      "Hardware/Boards/Board A.md",
    ]);
  });

  it("returns empty when no match exists", () => {
    expect(resolveKeyMatch(superstate, "999", cfg())).toEqual([]);
  });

  it("returns multiple matches when multiple rows have the same key", () => {
    const result = resolveKeyMatch(superstate, "2", cfg());
    expect(result).toEqual([
      "Hardware/Boards/Board B.md",
      "Hardware/Boards/Board D.md",
    ]);
  });

  it("is case-sensitive: 'abc' does not match 'ABC'", () => {
    const ss = makeSuperstate({
      "DB": {
        "DB/A.md": { key: "ABC" },
        "DB/B.md": { key: "abc" },
      },
    });
    expect(
      resolveKeyMatch(
        ss,
        "abc",
        cfg({ targetFolder: "DB", targetField: "key" })
      )
    ).toEqual(["DB/B.md"]);
    expect(
      resolveKeyMatch(
        ss,
        "ABC",
        cfg({ targetFolder: "DB", targetField: "key" })
      )
    ).toEqual(["DB/A.md"]);
  });

  it("returns empty for null/undefined/empty source values", () => {
    expect(resolveKeyMatch(superstate, null, cfg())).toEqual([]);
    expect(resolveKeyMatch(superstate, undefined, cfg())).toEqual([]);
    expect(resolveKeyMatch(superstate, "", cfg())).toEqual([]);
    expect(resolveKeyMatch(superstate, "   ", cfg())).toEqual([]);
  });

  it("returns empty when targetFolder does not exist in contextsIndex", () => {
    expect(
      resolveKeyMatch(
        superstate,
        "1",
        cfg({ targetFolder: "Nonexistent/Folder" })
      )
    ).toEqual([]);
  });

  it("returns empty when targetField is missing from config", () => {
    expect(
      resolveKeyMatch(superstate, "1", cfg({ targetField: "" }))
    ).toEqual([]);
  });

  it("returns empty when targetFolder is missing from config", () => {
    expect(
      resolveKeyMatch(superstate, "1", cfg({ targetFolder: "" }))
    ).toEqual([]);
  });

  it("matches numeric source values via string coercion", () => {
    // Source value is a number, target value is a string "1" — match via String().
    expect(resolveKeyMatch(superstate, 1, cfg())).toEqual([
      "Hardware/Boards/Board A.md",
    ]);
  });

  it("trims whitespace from source and target values", () => {
    const ss = makeSuperstate({
      "DB": {
        "DB/A.md": { key: "  foo  " },
      },
    });
    expect(
      resolveKeyMatch(
        ss,
        "foo",
        cfg({ targetFolder: "DB", targetField: "key" })
      )
    ).toEqual(["DB/A.md"]);
    expect(
      resolveKeyMatch(
        ss,
        "  foo  ",
        cfg({ targetFolder: "DB", targetField: "key" })
      )
    ).toEqual(["DB/A.md"]);
  });

  it("matches against array-valued target fields (any element match)", () => {
    const ss = makeSuperstate({
      "DB": {
        "DB/A.md": { tags: ["alpha", "beta"] },
        "DB/B.md": { tags: ["gamma"] },
      },
    });
    expect(
      resolveKeyMatch(
        ss,
        "beta",
        cfg({ targetFolder: "DB", targetField: "tags" })
      )
    ).toEqual(["DB/A.md"]);
  });

  it("skips rows with null/undefined targetField value", () => {
    const ss = makeSuperstate({
      "DB": {
        "DB/A.md": { key: null },
        "DB/B.md": {}, // key absent
        "DB/C.md": { key: "match" },
      },
    });
    expect(
      resolveKeyMatch(
        ss,
        "match",
        cfg({ targetFolder: "DB", targetField: "key" })
      )
    ).toEqual(["DB/C.md"]);
  });

  it("skips rows with no frontmatter (pathsIndex miss)", () => {
    // A path listed in contextsIndex.paths but not in pathsIndex.
    const ss = makeSuperstate({ "DB": {} });
    // Manually add a path without pathsIndex entry.
    (ss.contextsIndex.get("DB") as any).paths = ["DB/Ghost.md"];
    expect(
      resolveKeyMatch(
        ss,
        "anything",
        cfg({ targetFolder: "DB", targetField: "key" })
      )
    ).toEqual([]);
  });

  it("handles boolean source values via string coercion", () => {
    const ss = makeSuperstate({
      "DB": {
        "DB/A.md": { active: "true" },
        "DB/B.md": { active: "false" },
      },
    });
    expect(
      resolveKeyMatch(
        ss,
        true,
        cfg({ targetFolder: "DB", targetField: "active" })
      )
    ).toEqual(["DB/A.md"]);
  });
});

describe("resolveKeyMatch — property tests (determinism)", () => {
  // mulberry32 PRNG (repo convention, no external dep).
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
  const PROPERTY_RUNS = 500;

  const SOURCE_VALUES: readonly unknown[] = [
    "1",
    "2",
    "abc",
    "ABC",
    "",
    "   ",
    null,
    undefined,
    0,
    42,
    true,
    false,
    "key with spaces",
  ] as const;

  const TARGET_VALUES: readonly unknown[] = [
    "1",
    "2",
    "abc",
    "ABC",
    "",
    null,
    undefined,
    ["a", "b"],
    [1, 2],
    42,
    true,
  ] as const;

  const buildSuperstate = (rng: () => number) => {
    const files: Record<string, Record<string, any>> = {};
    const n = randInt(rng, 0, 8);
    for (let i = 0; i < n; i++) {
      files[`DB/Row${i}.md`] = { key: pick(rng, TARGET_VALUES) };
    }
    return makeSuperstate({ "DB": files });
  };

  it("TOTAL: never throws for any (sourceValue, config) over a production superstate", () => {
    const rng = makeRng(0xfeed01);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const sourceValue = pick(rng, SOURCE_VALUES);
      expect(() =>
        resolveKeyMatch(
          ss,
          sourceValue,
          cfg({ targetFolder: "DB", targetField: "key" })
        )
      ).not.toThrow();
    }
  });

  it("always returns an array of strings", () => {
    const rng = makeRng(0xfeed02);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const result = resolveKeyMatch(
        ss,
        pick(rng, SOURCE_VALUES),
        cfg({ targetFolder: "DB", targetField: "key" })
      );
      expect(Array.isArray(result)).toBe(true);
      for (const el of result) {
        expect(typeof el).toBe("string");
      }
    }
  });

  it("STABLE: same inputs produce identical output", () => {
    const rng = makeRng(0xfeed03);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const sourceValue = pick(rng, SOURCE_VALUES);
      const config = cfg({ targetFolder: "DB", targetField: "key" });
      const a = resolveKeyMatch(ss, sourceValue, config);
      const b = resolveKeyMatch(ss, sourceValue, config);
      expect(a).toEqual(b);
    }
  });

  it("READ-ONLY: never mutates the superstate or config", () => {
    const rng = makeRng(0xfeed04);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const sourceValue = pick(rng, SOURCE_VALUES);
      const config = cfg({ targetFolder: "DB", targetField: "key" });
      const pathsBefore = JSON.stringify([...ss.pathsIndex.entries()]);
      const configBefore = JSON.stringify(config);
      resolveKeyMatch(ss, sourceValue, config);
      expect(JSON.stringify([...ss.pathsIndex.entries()])).toBe(pathsBefore);
      expect(JSON.stringify(config)).toBe(configBefore);
    }
  });
});

describe("isKeyMatchConfig", () => {
  it("returns true for a valid key-match config", () => {
    expect(
      isKeyMatchConfig({
        keyMatch: {
          type: "key-match",
          sourceField: "board_id",
          targetFolder: "Hardware/Boards",
          targetField: "board_id",
        },
      })
    ).toBe(true);
  });

  it("returns false when keyMatch is missing", () => {
    expect(isKeyMatchConfig({})).toBe(false);
    expect(isKeyMatchConfig(null)).toBe(false);
    expect(isKeyMatchConfig(undefined)).toBe(false);
  });

  it("returns false when keyMatch fields are empty strings", () => {
    expect(
      isKeyMatchConfig({
        keyMatch: {
          type: "key-match",
          sourceField: "",
          targetFolder: "DB",
          targetField: "key",
        },
      })
    ).toBe(false);
    expect(
      isKeyMatchConfig({
        keyMatch: {
          type: "key-match",
          sourceField: "x",
          targetFolder: "",
          targetField: "key",
        },
      })
    ).toBe(false);
    expect(
      isKeyMatchConfig({
        keyMatch: {
          type: "key-match",
          sourceField: "x",
          targetFolder: "DB",
          targetField: "",
        },
      })
    ).toBe(false);
  });

  it("returns false when type is not 'key-match'", () => {
    expect(
      isKeyMatchConfig({
        keyMatch: {
          type: "wikilink",
          sourceField: "x",
          targetFolder: "DB",
          targetField: "key",
        },
      })
    ).toBe(false);
  });
});
