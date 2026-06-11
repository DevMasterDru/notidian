import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { propertyAuthorityForColumn } from "../properties/propertyAuthority";
import { TableCellWrite } from "./tableEditTransaction";

// Build authority-aware value writes for an ordinary row update coming from a
// non-table surface (calendar drag/resize, edit modal, header properties panel).
// Routing these through executeValueWrites gives them the same stale-frontmatter
// conflict gate, file-write-before-accept, MDB stripping, and undo as table cell
// edits. See bd Notidian-f2l.
//
// - The page title (PathPropertyName) is excluded: identity changes must go
//   through the rename transaction, not a detached row-value write.
// - Read-only computed columns are excluded.
// - Only columns whose value actually changed are written.
// - The originally-edited file path is baked in so executeValueWrites resolves
//   the row by file identity, independent of the filtered/sorted view index.
export const buildRowUpdateWrites = (
  row: DBRow,
  currentData: DBRow,
  cols: SpaceTableColumn[],
  index: number
): TableCellWrite[] => {
  const writes: TableCellWrite[] = [];
  for (const name of Object.keys(row)) {
    if (name == PathPropertyName) continue;
    if (row[name] == currentData[name]) continue;
    const col = cols.find((c) => c.name == name);
    if (!col) continue;
    if (propertyAuthorityForColumn(col) == "computed") continue;
    writes.push({
      rowId: index.toString(),
      columnId: col.name + (col.table ?? ""),
      columnName: name,
      table: col.table ?? "",
      value: row[name] ?? "",
      path: currentData[PathPropertyName],
    });
  }
  return writes;
};
