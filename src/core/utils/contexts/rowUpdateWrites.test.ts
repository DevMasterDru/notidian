/**
 * Direct unit tests for buildRowUpdateWrites (bd Notidian-8yg).
 *
 * buildRowUpdateWrites is the Notidian-f2l fix that routes row edits coming from
 * NON-table surfaces (calendar drag/resize, the create/edit item modal, the note
 * header properties panel) through the same authority-aware value-write pipeline
 * as table cell edits, so they get the stale-frontmatter conflict gate,
 * file-write-before-accept, MDB stripping, and undo. These tests pin its four
 * documented invariants exhaustively over SpaceTableColumn fixtures spanning
 * frontmatter / notidian-owned / computed authority:
 *
 *   (1) The page title (PathPropertyName) is NEVER emitted as a value write —
 *       identity changes go through the rename transaction, not a detached
 *       row-value write.
 *   (2) Computed / read-only columns (propertyAuthorityForColumn == "computed")
 *       are EXCLUDED.
 *   (3) ONLY columns whose value actually changed vs currentData are written
 *       (unchanged -> no write; a key with no matching column -> skipped).
 *   (4) Each emitted write bakes path = currentData[PathPropertyName]
 *       (identity-stable resolution independent of the filtered/sorted view
 *       index), columnId = col.name + (col.table ?? ""), table = col.table ?? "",
 *       rowId = index.toString().
 *
 * Pure / offline.
 */
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { propertyAuthorityForColumn } from "../properties/propertyAuthority";
import { buildRowUpdateWrites } from "./rowUpdateWrites";
import { TableCellWrite } from "./tableEditTransaction";

// One column per authority class, so every scenario exercises the full
// frontmatter / notidian-owned / computed spectrum.
//
//   status  -> source:"frontmatter"            => authority "frontmatter"
//   manual  -> text, no source marker          => authority "frontmatter"
//              (source-less file-backed type defaults to the visible layer)
//   owned   -> source:"notidian"               => authority "notidian"
//   rel     -> context (no frontmatter form)    => authority "notidian"
//   Created -> fileprop (computed/read-only)    => authority "computed"
//   total   -> rollup   (computed/read-only)    => authority "computed"
const rootCols: SpaceTableColumn[] = [
  { name: PathPropertyName, type: "file", table: "" },
  { name: "status", type: "text", source: "frontmatter", table: "" },
  { name: "manual", type: "text", table: "" },
  { name: "owned", type: "text", source: "notidian", table: "" },
  { name: "rel", type: "context", table: "" },
  { name: "Created", type: "fileprop", table: "" },
  { name: "total", type: "rollup", table: "" },
];

const baseData: DBRow = {
  [PathPropertyName]: "Folder/A.md",
  status: "old",
  manual: "keep",
  owned: "ownedOld",
  rel: "[[X]]",
  Created: "2026-01-01",
  total: "10",
};

// The exact write a given column+value would produce for the fixture path/index.
const writeFor = (
  cols: SpaceTableColumn[],
  name: string,
  value: string,
  index: number,
  path = baseData[PathPropertyName]
): TableCellWrite => {
  const col = cols.find((c) => c.name == name)!;
  return {
    rowId: index.toString(),
    columnId: col.name + (col.table ?? ""),
    columnName: name,
    table: col.table ?? "",
    value,
    path,
  };
};

describe("buildRowUpdateWrites — fixture authority sanity", () => {
  it("the fixtures actually span all three relevant authority classes", () => {
    const authorityOf = (name: string) =>
      propertyAuthorityForColumn(rootCols.find((c) => c.name == name));
    expect(authorityOf(PathPropertyName)).toBe("file");
    expect(authorityOf("status")).toBe("frontmatter");
    expect(authorityOf("manual")).toBe("frontmatter");
    expect(authorityOf("owned")).toBe("notidian");
    expect(authorityOf("rel")).toBe("notidian");
    expect(authorityOf("Created")).toBe("computed");
    expect(authorityOf("total")).toBe("computed");
  });
});

describe("buildRowUpdateWrites — invariant (1): page title is never a value write", () => {
  it("emits nothing when ONLY the title (PathPropertyName) changed", () => {
    const writes = buildRowUpdateWrites(
      { ...baseData, [PathPropertyName]: "Folder/Renamed.md" },
      baseData,
      rootCols,
      0
    );
    expect(writes).toEqual([]);
  });

  it("never emits a write for the title even when other columns change with it", () => {
    const writes = buildRowUpdateWrites(
      {
        ...baseData,
        [PathPropertyName]: "Folder/Renamed.md",
        status: "new",
      },
      baseData,
      rootCols,
      2
    );
    // Only the status change survives; the title rename is omitted entirely.
    expect(writes).toEqual([writeFor(rootCols, "status", "new", 2)]);
    expect(writes.some((w) => w.columnName == PathPropertyName)).toBe(false);
  });

  it("excludes the title even if it is somehow ALSO declared as a writable column", () => {
    // A PathPropertyName column typed as plain text (a corrupt/mislabeled schema):
    // the early name guard runs BEFORE authority resolution, so identity is still
    // routed through rename, never a detached value write.
    const colsWithTitleAsText: SpaceTableColumn[] = [
      { name: PathPropertyName, type: "text", source: "frontmatter", table: "" },
      ...rootCols.slice(1),
    ];
    const writes = buildRowUpdateWrites(
      { ...baseData, [PathPropertyName]: "Folder/Renamed.md" },
      baseData,
      colsWithTitleAsText,
      0
    );
    expect(writes).toEqual([]);
  });
});

describe("buildRowUpdateWrites — invariant (2): computed/read-only columns excluded", () => {
  it("emits nothing when only computed columns (fileprop / rollup) changed", () => {
    const writes = buildRowUpdateWrites(
      { ...baseData, Created: "2027-09-09", total: "999" },
      baseData,
      rootCols,
      0
    );
    expect(writes).toEqual([]);
  });

  it("drops the computed change but keeps the writable change in the same edit", () => {
    const writes = buildRowUpdateWrites(
      { ...baseData, Created: "2027-09-09", status: "new" },
      baseData,
      rootCols,
      4
    );
    expect(writes).toEqual([writeFor(rootCols, "status", "new", 4)]);
  });

  it("excludes a computed column even when it carries a stray frontmatter source marker", () => {
    // "skip IFF computed" is an invariant: the computed type wins over a mislabel
    // so a DERIVED value can never leak into the durable file layer.
    const colsMislabeled: SpaceTableColumn[] = [
      ...rootCols.slice(0, 5),
      { name: "Created", type: "fileprop", source: "frontmatter", table: "" },
      { name: "total", type: "rollup", source: "frontmatter", table: "" },
    ];
    const writes = buildRowUpdateWrites(
      { ...baseData, Created: "2027-09-09", total: "999" },
      baseData,
      colsMislabeled,
      0
    );
    expect(writes).toEqual([]);
  });
});

describe("buildRowUpdateWrites — invariant (3): only actually-changed, mapped columns", () => {
  it("emits nothing for an exact no-op (identical row and currentData)", () => {
    expect(buildRowUpdateWrites(baseData, baseData, rootCols, 0)).toEqual([]);
    expect(buildRowUpdateWrites({ ...baseData }, baseData, rootCols, 7)).toEqual(
      []
    );
  });

  it("skips an unchanged column while emitting a sibling changed column", () => {
    const writes = buildRowUpdateWrites(
      { ...baseData, manual: "changed" }, // status unchanged, manual changed
      baseData,
      rootCols,
      1
    );
    expect(writes).toEqual([writeFor(rootCols, "manual", "changed", 1)]);
  });

  it("skips a key present in the row but with NO matching column definition", () => {
    const writes = buildRowUpdateWrites(
      { ...baseData, ghost: "value", status: "new" }, // ghost not in cols
      { ...baseData, ghost: "old" },
      rootCols,
      0
    );
    expect(writes).toEqual([writeFor(rootCols, "status", "new", 0)]);
    expect(writes.some((w) => w.columnName == "ghost")).toBe(false);
  });

  it("treats a value newly set against an ABSENT currentData key as a change", () => {
    // currentData has no `status` key (undefined); row sets it. undefined != "set"
    // under the loose comparison, so it is a real change and is emitted.
    const noStatusCurrent: DBRow = { ...baseData };
    delete noStatusCurrent.status;
    const writes = buildRowUpdateWrites(
      { ...noStatusCurrent, status: "set" },
      noStatusCurrent,
      rootCols,
      0
    );
    expect(writes).toEqual([writeFor(rootCols, "status", "set", 0)]);
  });

  it("only iterates keys PRESENT in row — an absent row key is never a clearing write", () => {
    // currentData has `status`, the new row omits it. buildRowUpdateWrites walks
    // Object.keys(row), so a missing key produces no write (clearing a removed
    // key is not this builder's job).
    const rowWithoutStatus: DBRow = { ...baseData };
    delete rowWithoutStatus.status;
    const writes = buildRowUpdateWrites(rowWithoutStatus, baseData, rootCols, 0);
    expect(writes).toEqual([]);
  });

  it("emits one precise write per changed writable column across mixed authority, in row-key order", () => {
    const writes = buildRowUpdateWrites(
      {
        ...baseData,
        [PathPropertyName]: "Folder/Renamed.md", // (1) excluded
        status: "new", // frontmatter (source) -> emitted
        manual: "changed", // frontmatter (default) -> emitted
        owned: "ownedNew", // notidian (source) -> emitted
        rel: "[[Y]]", // notidian (context-only) -> emitted
        Created: "2027-09-09", // (2) computed -> excluded
        total: "999", // (2) computed -> excluded
      },
      baseData,
      rootCols,
      3
    );
    expect(writes).toEqual([
      writeFor(rootCols, "status", "new", 3),
      writeFor(rootCols, "manual", "changed", 3),
      writeFor(rootCols, "owned", "ownedNew", 3),
      writeFor(rootCols, "rel", "[[Y]]", 3),
    ]);
  });
});

describe("buildRowUpdateWrites — invariant (4): baked identity-stable fields", () => {
  it("bakes columnId = name + (table ?? '') and table = '' for a root column", () => {
    const writes = buildRowUpdateWrites(
      { ...baseData, status: "new" },
      baseData,
      rootCols,
      5
    );
    expect(writes).toEqual([
      {
        rowId: "5",
        columnId: "status", // "status" + ("" ?? "")
        columnName: "status",
        table: "",
        value: "new",
        path: "Folder/A.md",
      },
    ]);
  });

  it("bakes columnId = name + table and table = the linked table for a context column", () => {
    // A column whose `table` is a non-empty linked context table: the columnId
    // disambiguates same-named fields across linked tables, and `table` routes the
    // write to that context store rather than the root table.
    const linkedCols: SpaceTableColumn[] = [
      { name: PathPropertyName, type: "file", table: "" },
      { name: "status", type: "text", source: "frontmatter", table: "Linked" },
    ];
    const writes = buildRowUpdateWrites(
      { ...baseData, status: "new" },
      baseData,
      linkedCols,
      2
    );
    expect(writes).toEqual([
      {
        rowId: "2",
        columnId: "statusLinked", // "status" + "Linked"
        columnName: "status",
        table: "Linked",
        value: "new",
        path: "Folder/A.md",
      },
    ]);
  });

  it("treats a column with an undefined `table` as a root write (table '' , columnId = name)", () => {
    const colsNoTable: SpaceTableColumn[] = [
      { name: PathPropertyName, type: "file" },
      { name: "status", type: "text", source: "frontmatter" }, // table undefined
    ];
    const writes = buildRowUpdateWrites(
      { ...baseData, status: "new" },
      baseData,
      colsNoTable,
      0
    );
    expect(writes).toEqual([
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "new",
        path: "Folder/A.md",
      },
    ]);
  });

  it("bakes rowId from the supplied view index, not the row identity", () => {
    for (const index of [0, 5, 42]) {
      const writes = buildRowUpdateWrites(
        { ...baseData, status: `v${index}` },
        baseData,
        rootCols,
        index
      );
      expect(writes).toHaveLength(1);
      expect(writes[0].rowId).toBe(index.toString());
    }
  });

  it("bakes path from currentData[PathPropertyName] — identity-stable, NOT the new row path", () => {
    // The new row carries a renamed/different path; the baked path must still be
    // the ORIGINALLY-edited file's identity from currentData, so executeValueWrites
    // resolves the row by file regardless of view sort/filter order.
    const writes = buildRowUpdateWrites(
      { ...baseData, [PathPropertyName]: "Folder/Renamed.md", status: "new" },
      baseData,
      rootCols,
      0
    );
    expect(writes).toEqual([writeFor(rootCols, "status", "new", 0)]);
    expect(writes[0].path).toBe("Folder/A.md");
  });

  it("bakes an empty-string path when currentData has no PathPropertyName", () => {
    const noPathCurrent: DBRow = { status: "old" };
    const writes = buildRowUpdateWrites(
      { status: "new" },
      noPathCurrent,
      rootCols,
      0
    );
    // currentData[PathPropertyName] is undefined; it is baked verbatim into path.
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBeUndefined();
    expect(writes[0]).toEqual({
      rowId: "0",
      columnId: "status",
      columnName: "status",
      table: "",
      value: "new",
      path: undefined,
    });
  });

  it("coalesces a null/undefined new value to '' in the emitted write", () => {
    // DBRow is typed Record<string, string>, but defensive `value: row[name] ?? ""`
    // guards a runtime null/undefined leaking from an upstream surface.
    const rowWithNull = { ...baseData, status: null } as unknown as DBRow;
    const writes = buildRowUpdateWrites(rowWithNull, baseData, rootCols, 0);
    expect(writes).toHaveLength(1);
    expect(writes[0].value).toBe("");
    expect(writes[0].columnName).toBe("status");
  });

  it("never sets clear/fieldValue/expectedCurrentValue/forceFrontmatterWrite", () => {
    // This builder produces a plain authority-aware value write — none of the
    // replay/clear/field-config flags belong to a fresh non-table-surface edit.
    const [write] = buildRowUpdateWrites(
      { ...baseData, status: "new" },
      baseData,
      rootCols,
      0
    );
    expect(write.clear).toBeUndefined();
    expect(write.fieldValue).toBeUndefined();
    expect(write.expectedCurrentValue).toBeUndefined();
    expect(write.forceFrontmatterWrite).toBeUndefined();
    expect(Object.keys(write).sort()).toEqual(
      ["columnId", "columnName", "path", "rowId", "table", "value"].sort()
    );
  });
});
