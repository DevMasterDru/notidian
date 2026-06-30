import { KeyMatchRelationConfig } from "core/utils/contexts/keyMatchResolver";
import {
  computeRowRollup,
  computeRowRollupDetailed,
} from "core/utils/contexts/tableRollupRuntime";
import { RollupConfig } from "core/utils/contexts/tableRollup";

// ===========================================================================
// Integration test (Notidian-mx0k.1): rollup column using key-match relation
// computes correctly end-to-end through the runtime bridge. Proves that the
// key-match resolution and rollup engine compose correctly.
//
// Scenario: A "Tasks" database has rows with a `board_id` field. A "Boards"
// database has rows with matching `board_id` and a `cost` field. A rollup on
// a Tasks row aggregates `cost` across the Boards matched by `board_id`.
//
// Also includes regression tests ensuring existing wikilink rollups are
// unchanged by the key-match addition.
// ===========================================================================

// Shared superstate factory supporting both wikilink and key-match scenarios.
const makeSuperstate = (
  folders: Record<string, Record<string, Record<string, any>>>,
  extraPaths?: Record<string, Record<string, any>>
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

  // Extra paths for wikilink resolution (not in any folder context).
  if (extraPaths) {
    for (const [path, property] of Object.entries(extraPaths)) {
      pathsIndex.set(path, { metadata: { property } });
    }
  }

  const resolvePath = (link: string, _source?: string): string => {
    if (pathsIndex.has(link)) return link;
    if (pathsIndex.has(link + ".md")) return link + ".md";
    const wanted = link.split("/").pop();
    for (const key of pathsIndex.keys()) {
      const base = key.replace(/\.md$/, "").split("/").pop();
      if (base === wanted) return key;
    }
    return link;
  };

  return {
    pathsIndex,
    contextsIndex,
    spacesIndex: new Map(),
    spaceManager: { resolvePath },
  } as any;
};

describe("Key-match rollup integration (Notidian-mx0k.1)", () => {
  const superstate = makeSuperstate({
    "Boards": {
      "Boards/Board Alpha.md": { board_id: "1", cost: 50, status: "active" },
      "Boards/Board Beta.md": { board_id: "2", cost: 75, status: "retired" },
      "Boards/Board Gamma.md": { board_id: "1", cost: 30, status: "active" },
    },
  });

  const keyMatchConfig: KeyMatchRelationConfig = {
    type: "key-match",
    sourceField: "board_id",
    targetFolder: "Boards",
    targetField: "board_id",
  };

  const rollupConfig: RollupConfig = {
    relationProperty: "board_id",
    targetProperty: "cost",
    fn: "sum",
  };

  it("aggregates cost across key-matched boards (sum)", () => {
    // Task with board_id="1" matches Board Alpha (50) + Board Gamma (30).
    expect(
      computeRowRollup(superstate, "1", rollupConfig, "Tasks/T1.md", keyMatchConfig)
    ).toBe("80");
  });

  it("single match returns that row's value", () => {
    // board_id="2" matches Board Beta only (75).
    expect(
      computeRowRollup(superstate, "2", rollupConfig, "Tasks/T2.md", keyMatchConfig)
    ).toBe("75");
  });

  it("no match returns sum=0", () => {
    expect(
      computeRowRollup(superstate, "999", rollupConfig, "Tasks/T3.md", keyMatchConfig)
    ).toBe("0");
  });

  it("count returns the number of matched rows", () => {
    const countConfig: RollupConfig = { ...rollupConfig, fn: "count" };
    expect(
      computeRowRollup(superstate, "1", countConfig, "Tasks/T1.md", keyMatchConfig)
    ).toBe("2");
    expect(
      computeRowRollup(superstate, "2", countConfig, "Tasks/T2.md", keyMatchConfig)
    ).toBe("1");
    expect(
      computeRowRollup(superstate, "999", countConfig, "Tasks/T3.md", keyMatchConfig)
    ).toBe("0");
  });

  it("values lists the matched rows' target property", () => {
    const valuesConfig: RollupConfig = {
      ...rollupConfig,
      fn: "values",
      targetProperty: "status",
    };
    expect(
      computeRowRollup(superstate, "1", valuesConfig, "Tasks/T1.md", keyMatchConfig)
    ).toBe("active");
  });

  it("avg computes correctly across key-matched rows", () => {
    const avgConfig: RollupConfig = { ...rollupConfig, fn: "avg" };
    // (50 + 30) / 2 = 40
    expect(
      computeRowRollup(superstate, "1", avgConfig, "Tasks/T1.md", keyMatchConfig)
    ).toBe("40");
  });

  it("detailed variant returns correct counts for partial resolution", () => {
    // All matched paths exist in pathsIndex, so resolvedCount == relationCount.
    const result = computeRowRollupDetailed(
      superstate,
      "1",
      rollupConfig,
      "Tasks/T1.md",
      keyMatchConfig
    );
    expect(result.value).toBe("80");
    expect(result.relationCount).toBe(2);
    expect(result.resolvedCount).toBe(2);
  });

  it("null/empty source value produces zero result", () => {
    expect(
      computeRowRollup(superstate, null, rollupConfig, "Tasks/T4.md", keyMatchConfig)
    ).toBe("0");
    expect(
      computeRowRollup(superstate, "", rollupConfig, "Tasks/T4.md", keyMatchConfig)
    ).toBe("0");
  });
});

describe("Wikilink rollup regression (unchanged by key-match)", () => {
  // Existing wikilink-based rollups must produce identical results.
  const superstate = makeSuperstate(
    {},
    {
      "Tasks/A.md": { hours: 3 },
      "Tasks/B.md": { hours: 5 },
    }
  );

  it("wikilink relation still resolves and aggregates", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/B]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
        "Projects/X.md"
        // No keyMatchConfig — wikilink path.
      )
    ).toBe("8");
  });

  it("count is independent of resolution (wikilink)", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/Missing]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "count" },
        "Projects/X.md"
      )
    ).toBe("2");
  });

  it("canonicalizes bare and basename-only links (wikilink)", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[B]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
        "Projects/X.md"
      )
    ).toBe("8");
  });

  it("detailed variant preserves existing contract (wikilink)", () => {
    const result = computeRowRollupDetailed(
      superstate,
      "[[Tasks/A]], [[Tasks/B]]",
      { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
      "Projects/X.md"
    );
    expect(result.value).toBe("8");
    expect(result.relationCount).toBe(2);
    expect(result.resolvedCount).toBe(2);
  });
});
