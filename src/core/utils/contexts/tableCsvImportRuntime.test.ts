import type { CsvImportPlan } from "core/utils/contexts/tableCsvImport";
import type { SpaceTableColumn } from "shared/types/mdb";

// Notidian-n7az: pin the CSV-import data-ingestion bridge
// (executeCsvImport). It is the only CSV-import layer that writes to the
// vault, so we mock its two write sinks — newPathInSpace (file creation) and
// saveFrontmatterProperties (frontmatter write) — to observe the pure decision
// logic with zero I/O and infinite-quota safety. parseMDBStringValue is kept
// REAL on purpose: the coerce-by-column-kind behavior under test IS its output.

const newPathInSpace = jest.fn();
const saveFrontmatterProperties = jest.fn();

jest.mock("core/superstate/utils/spaces", () => ({
  __esModule: true,
  newPathInSpace: (...args: unknown[]) => newPathInSpace(...args),
}));

jest.mock("core/utils/properties/frontmatterWrite", () => ({
  __esModule: true,
  saveFrontmatterProperties: (...args: unknown[]) =>
    saveFrontmatterProperties(...args),
}));

// Imported AFTER the mocks so the bridge binds the mocked sinks.
import { executeCsvImport } from "core/utils/contexts/tableCsvImportRuntime";

const superstate = {} as any;
const space = {} as any;

// A plan with a single row carrying the given raw cell properties. fileName is
// the sanitized basename newPathInSpace receives; title only feeds the failure
// message. The header/title metadata is irrelevant to executeCsvImport (it
// reads plan.rows only), so we keep it minimal.
const planWithRows = (
  rows: Array<{
    fileName: string;
    title: string;
    properties: Record<string, string>;
  }>
): CsvImportPlan =>
  ({
    titleHeader: "Name",
    headers: [],
    rows: rows.map((r) => ({ ...r, collision: "none" as const })),
    totalRecords: rows.length,
    importableCount: rows.length,
    skippedNoTitle: 0,
  } as CsvImportPlan);

const col = (
  name: string,
  type: string,
  table?: string
): SpaceTableColumn => ({ name, type, table });

beforeEach(() => {
  newPathInSpace.mockReset();
  saveFrontmatterProperties.mockReset();
  // Default happy path: each created file gets a path; frontmatter write succeeds.
  newPathInSpace.mockImplementation(async (_ss, _sp, _ext, fileName) =>
    `Space/${fileName}.md`
  );
  saveFrontmatterProperties.mockResolvedValue({ ok: true });
});

describe("executeCsvImport — column matching keys ONLY the primary table", () => {
  it("coerces a matched primary-table column to its kind and never lets a same-named context column win", async () => {
    // Two columns share the name "count": the primary-table one (table == "")
    // is number, a context-table one (table == "ctx") is text. Keying by bare
    // name without the table filter could pick the text column and skip
    // coercion. The map must only contain the primary column.
    const cols = [
      col("count", "number", ""),
      col("count", "text", "ctx"),
    ];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "42" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 1, failed: 0 });
    const written = saveFrontmatterProperties.mock.calls[0][0].properties;
    // Number coercion (parseFloat), not the context column's raw passthrough.
    expect(written).toEqual({ count: 42 });
    expect(typeof written.count).toBe("number");
  });

  it("treats a column with undefined table as primary (table ?? '' == '')", async () => {
    const cols = [col("count", "number", undefined)];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "7" } },
    ]);

    await executeCsvImport({ superstate, space, plan, cols });

    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      count: 7,
    });
  });

  it("a column that ONLY exists in a context table is not matched — its header passes through raw", async () => {
    const cols = [col("count", "number", "ctx")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "42" } },
    ]);

    await executeCsvImport({ superstate, space, plan, cols });

    // No primary "count" column → raw string passthrough, no parseFloat.
    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      count: "42",
    });
  });
});

describe("executeCsvImport — empty cells are skipped", () => {
  it("drops empty / whitespace-only cells so number columns never get NaN and frontmatter stays clean", async () => {
    const cols = [col("count", "number", ""), col("note", "text", "")];
    const plan = planWithRows([
      {
        fileName: "Row1",
        title: "Row1",
        properties: { count: "", note: "   ", keep: "x" },
      },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 1, failed: 0 });
    const written = saveFrontmatterProperties.mock.calls[0][0].properties;
    // count + note dropped (would be NaN / noise); only the non-empty cell kept.
    expect(written).toEqual({ keep: "x" });
    expect("count" in written).toBe(false);
    expect("note" in written).toBe(false);
  });

  it("a row whose every cell is empty still creates the title-only file with no frontmatter (saveFrontmatter no-ops on {})", async () => {
    const cols = [col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "", x: "" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 1, failed: 0 });
    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({});
  });
});

describe("executeCsvImport — matched coerce vs unmatched passthrough", () => {
  it("coerces each matched kind and passes unmatched headers through as raw strings", async () => {
    const cols = [
      col("count", "number", ""),
      col("done", "boolean", ""),
      col("owner", "link", ""),
    ];
    const plan = planWithRows([
      {
        fileName: "Row1",
        title: "Row1",
        properties: {
          count: "10",
          done: "true",
          owner: "Alice",
          extra: "free text",
        },
      },
    ]);

    await executeCsvImport({ superstate, space, plan, cols });

    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      count: 10, // number
      done: true, // boolean
      owner: "[[Alice]]", // link, frontmatter=true wraps in wikilink
      extra: "free text", // unmatched header → raw passthrough
    });
  });
});

describe("executeCsvImport — coerce BEFORE create ordering", () => {
  it("a throwing parse increments failed and creates NOTHING (no stray empty note)", async () => {
    // object columns coerce via JSON.parse, which throws on a non-JSON cell.
    const cols = [col("payload", "object", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { payload: "not json" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 0, failed: 1 });
    // The throw happened during coercion, before any file was created.
    expect(newPathInSpace).not.toHaveBeenCalled();
    expect(saveFrontmatterProperties).not.toHaveBeenCalled();
  });

  it("a throwing row is isolated — later valid rows still import", async () => {
    const cols = [col("payload", "object", ""), col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Bad", title: "Bad", properties: { payload: "{oops" } },
      { fileName: "Good", title: "Good", properties: { count: "5" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 1, failed: 1 });
    // Only the good row reached creation.
    expect(newPathInSpace).toHaveBeenCalledTimes(1);
    expect(newPathInSpace.mock.calls[0][3]).toBe("Good");
  });
});

describe("executeCsvImport — non-string / empty path from newPathInSpace", () => {
  it("a non-string path → failed, no frontmatter write", async () => {
    newPathInSpace.mockResolvedValueOnce(undefined);
    const cols = [col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "1" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 0, failed: 1 });
    expect(saveFrontmatterProperties).not.toHaveBeenCalled();
  });

  it("an empty-string path → failed, no frontmatter write", async () => {
    newPathInSpace.mockResolvedValueOnce("");
    const cols = [col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "1" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 0, failed: 1 });
    expect(saveFrontmatterProperties).not.toHaveBeenCalled();
  });
});

describe("executeCsvImport — created vs failed accounting", () => {
  it("a frontmatter-write failure is counted as failed even though the title-only file exists", async () => {
    saveFrontmatterProperties.mockResolvedValueOnce({ ok: false });
    const cols = [col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "1" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    // The file WAS created (newPathInSpace returned a path) but properties did
    // not write, so it counts as failed for the summary to flag.
    expect(newPathInSpace).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: 0, failed: 1 });
  });

  it("a throw from newPathInSpace is caught and counted as failed", async () => {
    newPathInSpace.mockRejectedValueOnce(new Error("disk full"));
    const cols = [col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "1" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 0, failed: 1 });
    expect(saveFrontmatterProperties).not.toHaveBeenCalled();
  });

  it("a throw from saveFrontmatterProperties is caught and counted as failed (file already created)", async () => {
    saveFrontmatterProperties.mockRejectedValueOnce(new Error("boom"));
    const cols = [col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "1" } },
    ]);

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 0, failed: 1 });
  });

  it("tallies a mixed batch across every outcome and preserves row order to the sinks", async () => {
    // Row1 ok, Row2 throws on coerce (never created), Row3 bad path,
    // Row4 frontmatter-fail, Row5 ok.
    const cols = [col("payload", "object", ""), col("count", "number", "")];
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { count: "1" } },
      { fileName: "Row2", title: "Row2", properties: { payload: "{" } },
      { fileName: "Row3", title: "Row3", properties: { count: "3" } },
      { fileName: "Row4", title: "Row4", properties: { count: "4" } },
      { fileName: "Row5", title: "Row5", properties: { count: "5" } },
    ]);

    // Sequential calls: Row1 path ok, Row3 bad path, Row4 path ok, Row5 path ok.
    newPathInSpace
      .mockResolvedValueOnce("Space/Row1.md")
      .mockResolvedValueOnce("") // Row3 → bad path
      .mockResolvedValueOnce("Space/Row4.md")
      .mockResolvedValueOnce("Space/Row5.md");
    saveFrontmatterProperties
      .mockResolvedValueOnce({ ok: true }) // Row1
      .mockResolvedValueOnce({ ok: false }) // Row4
      .mockResolvedValueOnce({ ok: true }); // Row5

    const result = await executeCsvImport({ superstate, space, plan, cols });

    expect(result).toEqual({ created: 2, failed: 3 });
    // Row2 never reached creation (coerce throw); the rest hit the sink in order.
    expect(newPathInSpace.mock.calls.map((c) => c[3])).toEqual([
      "Row1",
      "Row3",
      "Row4",
      "Row5",
    ]);
  });

  it("an empty plan creates and fails nothing", async () => {
    const result = await executeCsvImport({
      superstate,
      space,
      plan: planWithRows([]),
      cols: [],
    });

    expect(result).toEqual({ created: 0, failed: 0 });
    expect(newPathInSpace).not.toHaveBeenCalled();
  });
});

describe("executeCsvImport — newPathInSpace invocation contract", () => {
  it("creates 'md' files with dontOpen=true so bulk import never steals focus", async () => {
    const plan = planWithRows([
      { fileName: "Row1", title: "Row1", properties: { x: "1" } },
    ]);

    await executeCsvImport({ superstate, space, plan, cols: [] });

    const callArgs = newPathInSpace.mock.calls[0];
    expect(callArgs[0]).toBe(superstate);
    expect(callArgs[1]).toBe(space);
    expect(callArgs[2]).toBe("md");
    expect(callArgs[3]).toBe("Row1");
    expect(callArgs[4]).toBe(true); // dontOpen
  });
});
