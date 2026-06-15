// fm.ts statically imports `adapters/obsidian/utils/file`, which transitively
// pulls in the React/Obsidian UI component graph (and an untransformed
// uuid.js ESM module). mergeTableData uses NONE of that — its only real deps
// are PathPropertyName, onlyUniquePropCaseInsensitive and yamlTypeToMDBType,
// all pure and import-safe. Stub the heavy boundary modules so the import graph
// resolves to plain data; the function under test stays the genuine fm.ts impl.
// This keeps the TEST DATA mock-free / pure while only neutralizing unused
// import-time side-effects (the repo's established pattern — see
// __audit__/file-cache-startup-join.audit.test.ts).
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
import { DBTable, SpaceTable } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// AUTHORITY (Q1) — characterization tests for mergeTableData (fm.ts:33).
// (Notidian-jfj). This pure function is the heart of the file/frontmatter -> MDB
// canonical merge (ADR 0014/0017): file + frontmatter are canonical, durable MDB
// ownership needs an explicit source:"notidian". mergeTableData fuses the
// notidian-owned SpaceTable (mdb) with the live frontmatter-derived DBTable
// (yamlmdb) and pins exactly how the two reconcile.
//
// Everything here is pure / offline — no vault, no DOM, no I/O, no mocks.
// mergeTableData((mdb: SpaceTable), (yamlmdb: DBTable), (types: Record<string,string>)).
//
// IMPORTANT — characterization, not correction. These tests lock the CURRENT
// observable contract; they intentionally encode behavior (e.g. fm-only rows
// being dropped, mdb-driven row set) without asserting it is "right".
//
// The contract being pinned (fm.ts:38-62):
//   cols = [ ...mdb.cols,
//            ...yamlmdb.cols
//               .filter(f => !mdb.cols.find(g => g.name.toLowerCase() == f.toLowerCase()))
//               .map(f => ({ name: f, schemaId: mdb.schema.id, type: yamlTypeToMDBType(types[f]) }))
//          ].filter(onlyUniquePropCaseInsensitive("name"))
//   rows = mdb.rows.map(r => {
//            const fmRow = yamlmdb.rows.find(f => f[PathPropertyName] == r[PathPropertyName]);
//            return fmRow ? { ...r, ...fmRow } : r;
//          })
// ---------------------------------------------------------------------------

// Minimal SpaceTableSchema. mergeTableData only reads `schema.id` (stamped onto
// newly appended yaml-derived columns).
const schema = (id = "schema-1") => ({
  id,
  name: "Test Schema",
  type: "db",
});

const mdbTable = (over: Partial<SpaceTable> = {}): SpaceTable => ({
  schema: schema(),
  cols: [],
  rows: [],
  ...over,
});

const yamlTable = (over: Partial<DBTable> = {}): DBTable => ({
  uniques: [],
  cols: [],
  rows: [],
  ...over,
});

describe("mergeTableData — column merge (frontmatter -> MDB)", () => {
  it("(1) appends yaml cols absent from mdb.cols, stamped with schema.id + yamlTypeToMDBType(types[f])", () => {
    const mdb = mdbTable({
      schema: schema("S1"),
      cols: [{ name: "Status", schemaId: "S1", type: "text" }],
    });
    const yamlmdb = yamlTable({ cols: ["Priority", "Estimate"] });
    const types = { Priority: "text", Estimate: "number" };

    const result = mergeTableData(mdb, yamlmdb, types);

    expect(result.cols).toEqual([
      { name: "Status", schemaId: "S1", type: "text" },
      { name: "Priority", schemaId: "S1", type: "text" },
      { name: "Estimate", schemaId: "S1", type: "number" },
    ]);
  });

  it("(1b) maps yaml types through yamlTypeToMDBType — duration/unknown collapse to text, others pass through", () => {
    const mdb = mdbTable({ schema: schema("S1"), cols: [] });
    const yamlmdb = yamlTable({ cols: ["Span", "Mystery", "Tags"] });
    const types = { Span: "duration", Mystery: "unknown", Tags: "text-multi" };

    const result = mergeTableData(mdb, yamlmdb, types);

    expect(result.cols).toEqual([
      { name: "Span", schemaId: "S1", type: "text" },
      { name: "Mystery", schemaId: "S1", type: "text" },
      { name: "Tags", schemaId: "S1", type: "text-multi" },
    ]);
  });

  it("(1c) a yaml col with no entry in the types map is stamped type: undefined (types[f] is undefined)", () => {
    const mdb = mdbTable({ schema: schema("S1"), cols: [] });
    const yamlmdb = yamlTable({ cols: ["Untyped"] });
    const types: Record<string, string> = {};

    const result = mergeTableData(mdb, yamlmdb, types);

    expect(result.cols).toEqual([
      { name: "Untyped", schemaId: "S1", type: undefined },
    ]);
  });

  it("(2) case-INSENSITIVE dedup via the inline .find(toLowerCase) guard — yaml 'name' does not duplicate mdb 'Name'", () => {
    const mdb = mdbTable({
      schema: schema("S1"),
      cols: [{ name: "Name", schemaId: "S1", type: "text" }],
    });
    // 'name' differs only by case from existing 'Name' -> filtered out, NOT appended.
    const yamlmdb = yamlTable({ cols: ["name", "Owner"] });
    const types = { name: "text", Owner: "text" };

    const result = mergeTableData(mdb, yamlmdb, types);

    // 'Name' kept (mdb authority, original casing); 'name' dropped; 'Owner' appended.
    expect(result.cols).toEqual([
      { name: "Name", schemaId: "S1", type: "text" },
      { name: "Owner", schemaId: "S1", type: "text" },
    ]);
  });

  it("(2b) trailing onlyUniquePropCaseInsensitive('name') filter dedups case-variant DUPLICATES already inside mdb.cols", () => {
    // The inline guard only protects yaml cols against mdb cols. Pre-existing
    // case-variant duplicates within mdb.cols itself are collapsed by the trailing
    // onlyUniquePropCaseInsensitive('name') — keeping the FIRST occurrence.
    const mdb = mdbTable({
      schema: schema("S1"),
      cols: [
        { name: "Tag", schemaId: "S1", type: "text" },
        { name: "tag", schemaId: "S1", type: "number" },
      ],
    });
    const yamlmdb = yamlTable({ cols: [] });

    const result = mergeTableData(mdb, yamlmdb, {});

    // first 'Tag' survives; second 'tag' removed by the trailing case-insensitive filter.
    expect(result.cols).toEqual([
      { name: "Tag", schemaId: "S1", type: "text" },
    ]);
  });

  it("(2c) trailing filter also collapses a yaml-vs-yaml case duplicate that the inline guard let through", () => {
    // The inline guard compares yaml cols ONLY against mdb.cols, not each other,
    // so two yaml cols that differ only by case both pass the .filter; the trailing
    // onlyUniquePropCaseInsensitive('name') then collapses them to the first.
    const mdb = mdbTable({ schema: schema("S1"), cols: [] });
    const yamlmdb = yamlTable({ cols: ["Due", "due"] });
    const types = { Due: "date", due: "text" };

    const result = mergeTableData(mdb, yamlmdb, types);

    expect(result.cols).toEqual([
      { name: "Due", schemaId: "S1", type: "date" },
    ]);
  });
});

describe("mergeTableData — row merge (keyed on PathPropertyName)", () => {
  it("(3) frontmatter row OVERRIDES mdb row for shared keys (…r, …fmRow spread order)", () => {
    const mdb = mdbTable({
      schema: schema("S1"),
      cols: [],
      rows: [
        { [PathPropertyName]: "a.md", Status: "old", Owner: "alice" },
      ],
    });
    const yamlmdb = yamlTable({
      rows: [
        { [PathPropertyName]: "a.md", Status: "new" },
      ],
    });

    const result = mergeTableData(mdb, yamlmdb, {});

    // Shared key Status -> fm value wins; mdb-only key Owner preserved; path preserved.
    expect(result.rows).toEqual([
      { [PathPropertyName]: "a.md", Status: "new", Owner: "alice" },
    ]);
  });

  it("(3b) the fm row can introduce new keys not present on the mdb row", () => {
    const mdb = mdbTable({
      rows: [{ [PathPropertyName]: "a.md", Owner: "alice" }],
    });
    const yamlmdb = yamlTable({
      rows: [{ [PathPropertyName]: "a.md", Priority: "high" }],
    });

    const result = mergeTableData(mdb, yamlmdb, {});

    expect(result.rows).toEqual([
      { [PathPropertyName]: "a.md", Owner: "alice", Priority: "high" },
    ]);
  });

  it("(4) mdb rows with no matching fm row pass through UNCHANGED", () => {
    const mdb = mdbTable({
      rows: [
        { [PathPropertyName]: "a.md", Status: "keep" },
        { [PathPropertyName]: "b.md", Status: "alsokeep" },
      ],
    });
    // fm row keyed to a different path — matches neither.
    const yamlmdb = yamlTable({
      rows: [{ [PathPropertyName]: "z.md", Status: "ignored" }],
    });

    const result = mergeTableData(mdb, yamlmdb, {});

    expect(result.rows).toEqual([
      { [PathPropertyName]: "a.md", Status: "keep" },
      { [PathPropertyName]: "b.md", Status: "alsokeep" },
    ]);
  });

  it("(5) fm-only rows (no matching mdb row) are DROPPED — the merge is mdb-driven", () => {
    const mdb = mdbTable({
      rows: [{ [PathPropertyName]: "a.md", Status: "keep" }],
    });
    const yamlmdb = yamlTable({
      rows: [
        { [PathPropertyName]: "a.md", Status: "merged" },
        { [PathPropertyName]: "ghost.md", Status: "orphan" },
      ],
    });

    const result = mergeTableData(mdb, yamlmdb, {});

    // Only the mdb-anchored row survives; ghost.md is not introduced.
    expect(result.rows).toEqual([
      { [PathPropertyName]: "a.md", Status: "merged" },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(
      result.rows.find((r) => r[PathPropertyName] == "ghost.md")
    ).toBeUndefined();
  });

  it("(5b) row count always equals mdb.rows.length regardless of fm row count", () => {
    const mdb = mdbTable({
      rows: [
        { [PathPropertyName]: "a.md" },
        { [PathPropertyName]: "b.md" },
        { [PathPropertyName]: "c.md" },
      ],
    });
    const yamlmdb = yamlTable({
      rows: [
        { [PathPropertyName]: "a.md", X: "1" },
        { [PathPropertyName]: "extra1.md", X: "2" },
        { [PathPropertyName]: "extra2.md", X: "3" },
      ],
    });

    const result = mergeTableData(mdb, yamlmdb, {});

    expect(result.rows).toHaveLength(mdb.rows.length);
  });

  it("(3c) for duplicate fm rows on the same path, .find picks the FIRST match", () => {
    const mdb = mdbTable({
      rows: [{ [PathPropertyName]: "a.md", V: "mdb" }],
    });
    const yamlmdb = yamlTable({
      rows: [
        { [PathPropertyName]: "a.md", V: "first" },
        { [PathPropertyName]: "a.md", V: "second" },
      ],
    });

    const result = mergeTableData(mdb, yamlmdb, {});

    expect(result.rows).toEqual([{ [PathPropertyName]: "a.md", V: "first" }]);
  });
});

describe("mergeTableData — schema + non-col/row fields preserved", () => {
  it("spreads ...mdb so schema (and any extra mdb fields) carry through unchanged", () => {
    const sch = schema("KEEP-ME");
    const mdb = mdbTable({ schema: sch, cols: [], rows: [] });

    const result = mergeTableData(mdb, yamlTable(), {});

    expect(result.schema).toBe(sch);
  });
});

describe("mergeTableData — empty / degenerate inputs", () => {
  it("(6) empty cols + empty rows + empty types map -> empty cols/rows, schema preserved", () => {
    const sch = schema("S-EMPTY");
    const mdb = mdbTable({ schema: sch, cols: [], rows: [] });
    const yamlmdb = yamlTable({ cols: [], rows: [] });

    const result = mergeTableData(mdb, yamlmdb, {});

    expect(result).toEqual({ schema: sch, cols: [], rows: [] });
  });

  it("(6b) empty yaml against a populated mdb returns the mdb cols/rows intact", () => {
    const mdb = mdbTable({
      schema: schema("S1"),
      cols: [{ name: "Status", schemaId: "S1", type: "text" }],
      rows: [{ [PathPropertyName]: "a.md", Status: "x" }],
    });

    const result = mergeTableData(mdb, yamlTable(), {});

    expect(result.cols).toEqual([
      { name: "Status", schemaId: "S1", type: "text" },
    ]);
    expect(result.rows).toEqual([{ [PathPropertyName]: "a.md", Status: "x" }]);
  });

  it("(6c) populated yaml against an empty mdb yields all yaml cols but ZERO rows (mdb-driven row set)", () => {
    const mdb = mdbTable({ schema: schema("S1"), cols: [], rows: [] });
    const yamlmdb = yamlTable({
      cols: ["A", "B"],
      rows: [{ [PathPropertyName]: "a.md", A: "1" }],
    });
    const types = { A: "text", B: "number" };

    const result = mergeTableData(mdb, yamlmdb, types);

    expect(result.cols).toEqual([
      { name: "A", schemaId: "S1", type: "text" },
      { name: "B", schemaId: "S1", type: "number" },
    ]);
    // No mdb rows to anchor against -> empty row set even though yaml has a row.
    expect(result.rows).toEqual([]);
  });
});

describe("mergeTableData — purity / non-mutation", () => {
  it("does not mutate the input mdb or yamlmdb objects", () => {
    const mdb = mdbTable({
      schema: schema("S1"),
      cols: [{ name: "Status", schemaId: "S1", type: "text" }],
      rows: [{ [PathPropertyName]: "a.md", Status: "old" }],
    });
    const yamlmdb = yamlTable({
      cols: ["Priority"],
      rows: [{ [PathPropertyName]: "a.md", Status: "new" }],
    });
    const mdbSnapshot = JSON.parse(JSON.stringify(mdb));
    const yamlSnapshot = JSON.parse(JSON.stringify(yamlmdb));

    mergeTableData(mdb, yamlmdb, { Priority: "text" });

    expect(mdb).toEqual(mdbSnapshot);
    expect(yamlmdb).toEqual(yamlSnapshot);
  });
});
