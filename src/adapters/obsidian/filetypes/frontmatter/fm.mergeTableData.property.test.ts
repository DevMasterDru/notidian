// Property/adversarial tests for mergeTableData — Notidian-e8jz.
//
// Verifies 6 merge invariants across 500+ randomly-generated inputs:
//   (1) output cols are a superset of input cols (none silently dropped)
//   (2) case-insensitive dedup is total (no case-variant duplicates in result.cols)
//   (3) PathPropertyName identity match is stable (order-independent, never misjoined)
//   (4) merge is idempotent (merge(result, yamlmdb, types) === result when state matches)
//   (5) frontmatter values overlay MDB values exactly (spread semantics)
//   (6) yamlTypeToMDBType is deterministic (same input -> same output, always)
//
// Pure, offline — no vault, no DOM, no I/O.

// --- Same jest.mock stubs as fm.mergeTableData.test.ts ---
jest.mock("adapters/obsidian/utils/file", () => ({
  getAllAbstractFilesInVault: (): unknown[] => [],
}));
jest.mock("core/superstate/utils/spaces", () => ({
  saveProperties: (): void => undefined,
}));
jest.mock("main", () => ({}), { virtual: true });
jest.mock(
  "obsidian",
  () => ({ App: class {}, TFile: class {} }),
  { virtual: true }
);

import { mergeTableData } from "./fm";
import { PathPropertyName } from "shared/types/context";
import { DBTable, SpaceTable, SpaceProperty } from "shared/types/mdb";
import { yamlTypeToMDBType } from "utils/properties";

// ---------------------------------------------------------------------------
// Seeded pseudo-random generator (Mulberry32) — deterministic, no externals.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Random generators
// ---------------------------------------------------------------------------

/** Pool of column names including case variants for adversarial coverage. */
const COL_NAME_POOL = [
  "Status", "status", "STATUS", "sTaTuS",
  "Priority", "priority", "PRIORITY",
  "Owner", "owner", "OWNER",
  "Due", "due", "DUE",
  "Tags", "tags", "TAGS",
  "Estimate", "estimate",
  "Sprint", "sprint",
  "Category", "category",
  "Label", "label",
  "Notes", "notes",
  "Link", "link",
  "Color", "color",
  "Score", "score",
  "Blocked", "blocked",
  "Created", "created",
  "Modified", "modified",
  "Assignee", "assignee",
  "Reviewer", "reviewer",
  "Type", "type",
  // Edge cases
  "A", "a", "B", "b", "X", "x", "Z", "z",
  "CamelCase", "camelcase", "CAMELCASE",
  "with space", "With Space",
  "123numeric", "emoji_col",
];

const YAML_TYPE_POOL = [
  "text", "number", "date", "checkbox", "text-multi",
  "duration", "unknown", "link", "context", "image",
  "object", "object-multi", "super", "color", "icon",
  // undefined is handled by not including the col in types map
];

const ROW_VALUE_POOL = [
  "alpha", "beta", "gamma", "delta", "",
  "123", "0", "-1", "true", "false",
  "[[link]]", "a, b, c", "null", "undefined",
  " leading-space", "trailing-space ",
  "line\nbreak", "tab\there",
];

const PATH_POOL = [
  "a.md", "b.md", "c.md", "d.md", "e.md",
  "dir/f.md", "dir/g.md", "notes/h.md",
  "deep/nested/i.md", "j.md", "k.md", "l.md",
  "m.md", "n.md", "o.md", "p.md",
];

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function pickN<T>(arr: readonly T[], n: number, rand: () => number): T[] {
  const result: T[] = [];
  for (let i = 0; i < n; i++) {
    result.push(pick(arr, rand));
  }
  return result;
}

function uniqueSubset<T>(arr: readonly T[], maxN: number, rand: () => number): T[] {
  const shuffled = [...arr].sort(() => rand() - 0.5);
  return shuffled.slice(0, Math.min(maxN, shuffled.length));
}

interface GeneratedInput {
  mdb: SpaceTable;
  yamlmdb: DBTable;
  types: Record<string, string>;
}

function generateInput(rand: () => number): GeneratedInput {
  const schemaId = `schema-${Math.floor(rand() * 1000)}`;

  // MDB columns: 0-20 columns
  const mdbColCount = Math.floor(rand() * 21);
  const mdbColNames = pickN(COL_NAME_POOL, mdbColCount, rand);
  const mdbCols: SpaceProperty[] = mdbColNames.map((name) => ({
    name,
    schemaId,
    type: pick(YAML_TYPE_POOL, rand),
  }));

  // MDB rows: 0-10 rows with random paths and values
  const mdbRowCount = Math.floor(rand() * 11);
  const mdbPaths = uniqueSubset(PATH_POOL, mdbRowCount, rand);
  const mdbRows = mdbPaths.map((path) => {
    const row: Record<string, string> = { [PathPropertyName]: path };
    // Add some random property values
    const propCount = Math.floor(rand() * 6);
    for (let i = 0; i < propCount; i++) {
      const colName = pick(COL_NAME_POOL, rand);
      row[colName] = pick(ROW_VALUE_POOL, rand);
    }
    return row;
  });

  // YAML columns: 0-15 columns
  const yamlColCount = Math.floor(rand() * 16);
  const yamlCols = pickN(COL_NAME_POOL, yamlColCount, rand);

  // YAML rows: mix of matching and non-matching paths
  const yamlRowCount = Math.floor(rand() * 12);
  const yamlRows: Record<string, string>[] = [];
  for (let i = 0; i < yamlRowCount; i++) {
    const path =
      rand() < 0.6 && mdbPaths.length > 0
        ? pick(mdbPaths, rand) // likely overlap with mdb
        : pick(PATH_POOL, rand); // may or may not overlap
    const row: Record<string, string> = { [PathPropertyName]: path };
    const propCount = Math.floor(rand() * 6);
    for (let j = 0; j < propCount; j++) {
      const colName = pick(COL_NAME_POOL, rand);
      row[colName] = pick(ROW_VALUE_POOL, rand);
    }
    yamlRows.push(row);
  }

  // Types map: map some yaml col names to types, leave some unmapped
  const types: Record<string, string> = {};
  for (const col of yamlCols) {
    if (rand() < 0.8) {
      // 80% chance of having a type mapping
      types[col] = pick(YAML_TYPE_POOL, rand);
    }
  }

  return {
    mdb: {
      schema: { id: schemaId, name: "Gen Schema", type: "db" },
      cols: mdbCols,
      rows: mdbRows,
    },
    yamlmdb: {
      uniques: [],
      cols: yamlCols,
      rows: yamlRows,
    },
    types,
  };
}

// ---------------------------------------------------------------------------
// Invariant checkers
// ---------------------------------------------------------------------------

/** (1) Output cols are a superset of input cols (case-insensitive). */
function checkColsSuperset(
  mdb: SpaceTable,
  yamlmdb: DBTable,
  result: SpaceTable
): void {
  const resultColNamesLower = new Set(
    result.cols.map((c) => c.name.toLowerCase())
  );

  // Every MDB col name (case-insensitively) must appear in result
  for (const col of mdb.cols) {
    if (!resultColNamesLower.has(col.name.toLowerCase())) {
      // Exception: if it was a case-duplicate within mdb.cols itself that got
      // deduped by onlyUniquePropCaseInsensitive, the FIRST occurrence survives.
      const firstIdx = mdb.cols.findIndex(
        (c) => c.name.toLowerCase() === col.name.toLowerCase()
      );
      const thisIdx = mdb.cols.indexOf(col);
      if (thisIdx === firstIdx) {
        throw new Error(
          `MDB col "${col.name}" missing from result cols (superset violation)`
        );
      }
      // else: it's a later case-duplicate, rightfully deduped
    }
  }

  // Every YAML col name (case-insensitively) must appear in result
  for (const colName of yamlmdb.cols) {
    if (!resultColNamesLower.has(colName.toLowerCase())) {
      // Again, yaml-vs-yaml case duplicates: first survives
      const firstIdx = [...mdb.cols.map((c) => c.name), ...yamlmdb.cols]
        .findIndex((n) => n.toLowerCase() === colName.toLowerCase());
      const yamlIdx =
        mdb.cols.length +
        yamlmdb.cols.indexOf(colName);
      if (yamlIdx === firstIdx) {
        throw new Error(
          `YAML col "${colName}" missing from result cols (superset violation)`
        );
      }
    }
  }
}

/** (2) No case-variant duplicates in result.cols. */
function checkNoCaseDuplicates(result: SpaceTable): void {
  const seen = new Set<string>();
  for (const col of result.cols) {
    const lower = col.name.toLowerCase();
    if (seen.has(lower)) {
      throw new Error(
        `Case-insensitive duplicate in result cols: "${col.name}" (dedup failure)`
      );
    }
    seen.add(lower);
  }
}

/** (3) PathPropertyName identity match is stable — correct row joins. */
function checkPathIdentityMatch(
  mdb: SpaceTable,
  yamlmdb: DBTable,
  result: SpaceTable
): void {
  // Result row count must equal MDB row count (mdb-driven row set)
  if (result.rows.length !== mdb.rows.length) {
    throw new Error(
      `Row count mismatch: result=${result.rows.length}, mdb=${mdb.rows.length}`
    );
  }

  // Each result row must have the same PathPropertyName as the corresponding mdb row
  for (let i = 0; i < result.rows.length; i++) {
    const resultPath = result.rows[i][PathPropertyName];
    const mdbPath = mdb.rows[i][PathPropertyName];
    if (resultPath !== mdbPath) {
      throw new Error(
        `Row ${i} path mismatch: result="${resultPath}", mdb="${mdbPath}"`
      );
    }
  }

  // If a result row has values from frontmatter, those values must come from
  // a yamlmdb row with the SAME PathPropertyName (never misjoined)
  for (let i = 0; i < result.rows.length; i++) {
    const mdbRow = mdb.rows[i];
    const path = mdbRow[PathPropertyName];
    const fmRow = yamlmdb.rows.find(
      (f) => f[PathPropertyName] === path
    );

    if (fmRow) {
      // Every key from fmRow should appear in result row with fmRow's value
      // (because spread puts fmRow values last)
      for (const key of Object.keys(fmRow)) {
        if (result.rows[i][key] !== fmRow[key]) {
          throw new Error(
            `Row ${i} key "${key}": expected fm value "${fmRow[key]}", got "${result.rows[i][key]}"`
          );
        }
      }
    }
  }
}

/** (4) Merge is idempotent. */
function checkIdempotent(
  result: SpaceTable,
  yamlmdb: DBTable,
  types: Record<string, string>
): void {
  // Build a "stabilized" yamlmdb from the result — cols as strings, rows as-is
  const stabilizedYaml: DBTable = {
    uniques: yamlmdb.uniques,
    cols: result.cols.map((c) => c.name),
    rows: result.rows,
  };

  // Build stabilized types from result cols
  const stabilizedTypes: Record<string, string> = {};
  for (const col of result.cols) {
    stabilizedTypes[col.name] = col.type;
  }

  const result2 = mergeTableData(result, stabilizedYaml, stabilizedTypes);

  // Cols should be identical
  if (result2.cols.length !== result.cols.length) {
    throw new Error(
      `Idempotency: col count changed from ${result.cols.length} to ${result2.cols.length}`
    );
  }
  for (let i = 0; i < result.cols.length; i++) {
    if (
      result2.cols[i].name !== result.cols[i].name ||
      result2.cols[i].schemaId !== result.cols[i].schemaId ||
      result2.cols[i].type !== result.cols[i].type
    ) {
      throw new Error(
        `Idempotency: col ${i} changed from ${JSON.stringify(result.cols[i])} to ${JSON.stringify(result2.cols[i])}`
      );
    }
  }

  // Rows should be identical
  if (result2.rows.length !== result.rows.length) {
    throw new Error(
      `Idempotency: row count changed from ${result.rows.length} to ${result2.rows.length}`
    );
  }
  for (let i = 0; i < result.rows.length; i++) {
    const r1 = JSON.stringify(result.rows[i]);
    const r2 = JSON.stringify(result2.rows[i]);
    if (r1 !== r2) {
      throw new Error(
        `Idempotency: row ${i} changed from ${r1} to ${r2}`
      );
    }
  }
}

/** (5) Frontmatter values overlay MDB values via spread. */
function checkFmOverlay(
  mdb: SpaceTable,
  yamlmdb: DBTable,
  result: SpaceTable
): void {
  for (let i = 0; i < mdb.rows.length; i++) {
    const mdbRow = mdb.rows[i];
    const path = mdbRow[PathPropertyName];
    // Use .find to match the actual algorithm (first match wins)
    const fmRow = yamlmdb.rows.find(
      (f) => f[PathPropertyName] === path
    );

    const resultRow = result.rows[i];

    if (fmRow) {
      // For keys in fmRow, the result must have the fm value (spread last wins)
      for (const key of Object.keys(fmRow)) {
        if (resultRow[key] !== fmRow[key]) {
          throw new Error(
            `Overlay violation row ${i}, key "${key}": fm="${fmRow[key]}", result="${resultRow[key]}"`
          );
        }
      }
      // For keys in mdbRow NOT in fmRow, the result must preserve mdb value
      for (const key of Object.keys(mdbRow)) {
        if (!(key in fmRow) && resultRow[key] !== mdbRow[key]) {
          throw new Error(
            `Overlay violation row ${i}, key "${key}": mdb="${mdbRow[key]}", result="${resultRow[key]}" (should preserve mdb when fm absent)`
          );
        }
      }
    } else {
      // No fm row — result row must be identical to mdb row
      for (const key of Object.keys(mdbRow)) {
        if (resultRow[key] !== mdbRow[key]) {
          throw new Error(
            `Passthrough violation row ${i}, key "${key}": mdb="${mdbRow[key]}", result="${resultRow[key]}"`
          );
        }
      }
      // Result row must not have keys absent from mdb row
      for (const key of Object.keys(resultRow)) {
        if (!(key in mdbRow)) {
          throw new Error(
            `Passthrough violation row ${i}: unexpected key "${key}" in result (no fm match)`
          );
        }
      }
    }
  }
}

/** (6) yamlTypeToMDBType is deterministic. */
function checkYamlTypeDeterminism(): void {
  const allTypes = [
    "text", "number", "date", "checkbox", "text-multi",
    "duration", "unknown", "link", "context", "image",
    "object", "object-multi", "super", "color", "icon",
    // edge cases
    "", "UNKNOWN", "Duration", "TEXT", "NuMbEr",
  ];

  for (const t of allTypes) {
    const r1 = yamlTypeToMDBType(t);
    const r2 = yamlTypeToMDBType(t);
    if (r1 !== r2) {
      throw new Error(
        `yamlTypeToMDBType not deterministic for "${t}": "${r1}" vs "${r2}"`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const TOTAL_RUNS = 600;

describe("mergeTableData — property/adversarial tests (Notidian-e8jz)", () => {
  // yamlTypeToMDBType determinism — a single check, not per-run
  it("(6) yamlTypeToMDBType is deterministic for all tested type strings", () => {
    checkYamlTypeDeterminism();
  });

  it("(6b) yamlTypeToMDBType known mappings: duration->text, unknown->text, others passthrough", () => {
    expect(yamlTypeToMDBType("duration")).toBe("text");
    expect(yamlTypeToMDBType("unknown")).toBe("text");
    expect(yamlTypeToMDBType("text")).toBe("text");
    expect(yamlTypeToMDBType("number")).toBe("number");
    expect(yamlTypeToMDBType("date")).toBe("date");
    expect(yamlTypeToMDBType("checkbox")).toBe("checkbox");
    expect(yamlTypeToMDBType("text-multi")).toBe("text-multi");
    expect(yamlTypeToMDBType("link")).toBe("link");
    // undefined input
    expect(yamlTypeToMDBType(undefined as unknown as string)).toBe(undefined);
  });

  // Run 600 randomized inputs, each checking invariants 1-5
  describe(`${TOTAL_RUNS} randomized inputs — invariants 1-5`, () => {
    const rand = mulberry32(42); // deterministic seed for reproducibility

    for (let run = 0; run < TOTAL_RUNS; run++) {
      it(`run ${run + 1}`, () => {
        const { mdb, yamlmdb, types } = generateInput(rand);
        const result = mergeTableData(mdb, yamlmdb, types);

        // (1) Output cols superset of input cols
        checkColsSuperset(mdb, yamlmdb, result);

        // (2) Case-insensitive dedup total
        checkNoCaseDuplicates(result);

        // (3) PathPropertyName identity match stable
        checkPathIdentityMatch(mdb, yamlmdb, result);

        // (4) Idempotent merge
        checkIdempotent(result, yamlmdb, types);

        // (5) Frontmatter values overlay MDB values via spread
        checkFmOverlay(mdb, yamlmdb, result);
      });
    }
  });

  // Targeted adversarial scenarios beyond random generation
  describe("adversarial edge cases", () => {
    it("all columns are case-variants of the same name", () => {
      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: [
          { name: "Name", schemaId: "s1", type: "text" },
          { name: "NAME", schemaId: "s1", type: "number" },
          { name: "name", schemaId: "s1", type: "date" },
        ],
        rows: [{ [PathPropertyName]: "a.md", Name: "v1" }],
      };
      const yamlmdb: DBTable = {
        uniques: [],
        cols: ["nAmE", "NaMe", "NAME"],
        rows: [{ [PathPropertyName]: "a.md", Name: "fm-v" }],
      };
      const types = { nAmE: "text", NaMe: "number", NAME: "date" };

      const result = mergeTableData(mdb, yamlmdb, types);

      // Only one column should survive (the first occurrence: "Name")
      checkNoCaseDuplicates(result);
      expect(result.cols).toHaveLength(1);
      expect(result.cols[0].name).toBe("Name");
    });

    it("20 columns with no overlap between mdb and yaml", () => {
      const mdbCols: SpaceProperty[] = [];
      for (let i = 0; i < 10; i++) {
        mdbCols.push({ name: `mdb_col_${i}`, schemaId: "s1", type: "text" });
      }
      const yamlCols: string[] = [];
      const types: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        yamlCols.push(`yaml_col_${i}`);
        types[`yaml_col_${i}`] = "number";
      }

      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: mdbCols,
        rows: [],
      };
      const yamlmdb: DBTable = { uniques: [], cols: yamlCols, rows: [] };

      const result = mergeTableData(mdb, yamlmdb, types);

      // All 20 columns should be present
      expect(result.cols).toHaveLength(20);
      checkNoCaseDuplicates(result);
      checkColsSuperset(mdb, yamlmdb, result);
    });

    it("empty string column name in both mdb and yaml", () => {
      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: [{ name: "", schemaId: "s1", type: "text" }],
        rows: [],
      };
      const yamlmdb: DBTable = { uniques: [], cols: [""], rows: [] };

      const result = mergeTableData(mdb, yamlmdb, {});

      // The empty-name col from mdb should be kept; yaml's "" is a case-insensitive
      // duplicate and should be filtered
      checkNoCaseDuplicates(result);
      expect(result.cols).toHaveLength(1);
    });

    it("rows with identical PathPropertyName — first fm match wins", () => {
      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: [],
        rows: [{ [PathPropertyName]: "dup.md", V: "mdb" }],
      };
      const yamlmdb: DBTable = {
        uniques: [],
        cols: [],
        rows: [
          { [PathPropertyName]: "dup.md", V: "first-fm" },
          { [PathPropertyName]: "dup.md", V: "second-fm" },
          { [PathPropertyName]: "dup.md", V: "third-fm" },
        ],
      };

      const result = mergeTableData(mdb, yamlmdb, {});

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].V).toBe("first-fm");
    });

    it("mdb row has many keys that fm row should not erase", () => {
      const mdbRow: Record<string, string> = {
        [PathPropertyName]: "rich.md",
      };
      for (let i = 0; i < 20; i++) {
        mdbRow[`prop_${i}`] = `mdb_val_${i}`;
      }

      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: [],
        rows: [mdbRow],
      };
      const yamlmdb: DBTable = {
        uniques: [],
        cols: [],
        rows: [{ [PathPropertyName]: "rich.md", prop_5: "overwritten" }],
      };

      const result = mergeTableData(mdb, yamlmdb, {});

      expect(result.rows[0].prop_5).toBe("overwritten");
      // All other props should be preserved
      for (let i = 0; i < 20; i++) {
        if (i !== 5) {
          expect(result.rows[0][`prop_${i}`]).toBe(`mdb_val_${i}`);
        }
      }
    });

    it("types map has entries for non-existent yaml cols — ignored", () => {
      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: [],
        rows: [],
      };
      const yamlmdb: DBTable = {
        uniques: [],
        cols: ["RealCol"],
        rows: [],
      };
      const types = {
        RealCol: "number",
        GhostCol: "date",
        AnotherGhost: "text",
      };

      const result = mergeTableData(mdb, yamlmdb, types);

      // Only RealCol should appear
      expect(result.cols).toHaveLength(1);
      expect(result.cols[0].name).toBe("RealCol");
      expect(result.cols[0].type).toBe("number");
    });

    it("schema.id is stamped on all yaml-derived columns", () => {
      const mdb: SpaceTable = {
        schema: { id: "unique-schema-xyz", name: "S", type: "db" },
        cols: [{ name: "Existing", schemaId: "other-schema", type: "text" }],
        rows: [],
      };
      const yamlmdb: DBTable = {
        uniques: [],
        cols: ["New1", "New2", "New3"],
        rows: [],
      };
      const types = { New1: "text", New2: "number", New3: "date" };

      const result = mergeTableData(mdb, yamlmdb, types);

      // Existing col keeps its original schemaId
      expect(result.cols[0].schemaId).toBe("other-schema");
      // Yaml-derived cols get mdb.schema.id
      for (let i = 1; i < result.cols.length; i++) {
        expect(result.cols[i].schemaId).toBe("unique-schema-xyz");
      }
    });

    it("large input: 20 mdb cols + 20 yaml cols + 10 rows", () => {
      const mdbCols: SpaceProperty[] = [];
      for (let i = 0; i < 20; i++) {
        mdbCols.push({ name: `Col${i}`, schemaId: "s1", type: "text" });
      }
      const yamlCols: string[] = [];
      const types: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        yamlCols.push(`YCol${i}`);
        types[`YCol${i}`] = "number";
      }
      const rows: Record<string, string>[] = [];
      const fmRows: Record<string, string>[] = [];
      for (let i = 0; i < 10; i++) {
        const path = `file_${i}.md`;
        rows.push({ [PathPropertyName]: path, Col0: `v${i}` });
        fmRows.push({ [PathPropertyName]: path, YCol0: `fv${i}` });
      }

      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: mdbCols,
        rows,
      };
      const yamlmdb: DBTable = { uniques: [], cols: yamlCols, rows: fmRows };

      const result = mergeTableData(mdb, yamlmdb, types);

      expect(result.cols).toHaveLength(40); // all unique
      expect(result.rows).toHaveLength(10);
      checkNoCaseDuplicates(result);
      checkColsSuperset(mdb, yamlmdb, result);
      checkPathIdentityMatch(mdb, yamlmdb, result);
      checkFmOverlay(mdb, yamlmdb, result);
      checkIdempotent(result, yamlmdb, types);
    });

    it("zero cols, many rows — cols are empty, rows pass through", () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({
        [PathPropertyName]: `f${i}.md`,
        Val: `v${i}`,
      }));
      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: [],
        rows,
      };
      const yamlmdb: DBTable = { uniques: [], cols: [], rows: [] };

      const result = mergeTableData(mdb, yamlmdb, {});

      expect(result.cols).toHaveLength(0);
      expect(result.rows).toHaveLength(10);
      // Rows unchanged since no fm rows match
      for (let i = 0; i < 10; i++) {
        expect(result.rows[i]).toEqual(rows[i]);
      }
    });

    it("fm row overwrites PathPropertyName key with same value (no-op stability)", () => {
      const mdb: SpaceTable = {
        schema: { id: "s1", name: "S", type: "db" },
        cols: [],
        rows: [{ [PathPropertyName]: "x.md", A: "1" }],
      };
      const yamlmdb: DBTable = {
        uniques: [],
        cols: [],
        rows: [{ [PathPropertyName]: "x.md", A: "1" }],
      };

      const result = mergeTableData(mdb, yamlmdb, {});

      expect(result.rows).toEqual([{ [PathPropertyName]: "x.md", A: "1" }]);
    });
  });
});
