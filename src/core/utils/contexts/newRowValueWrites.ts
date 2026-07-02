import { propertyAuthorityForColumn } from "core/utils/properties/propertyAuthority";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";

export type NewRowValuePartition = {
  frontmatter: Record<string, string>;
  context: Record<string, string>;
};

// Partition a new row's seed values by the authority of their ROOT column — the
// same split api.context.insert applies on row-create (ADR 0044). Frontmatter-
// authority values seed the file's YAML; Notidian-owned (source:"notidian") /
// context-only values seed the folder's context MDB. Computed/read-only values
// and values with no matching root column are dropped (they have no durable
// new-row home to write to).
//
// Before this split the grouped-header "add row to this group" path fed every
// seed value through a frontmatter-only writer, so the group value (and any
// inherited/continued defaults) for a source:"notidian" column was filtered out
// and written NOWHERE — the new row rendered in the "No value" bucket instead of
// the group it was created under. bd Notidian-i7jl.
export const partitionNewRowValuesByAuthority = (
  rowData: DBRow | undefined,
  columns: SpaceTableColumn[]
): NewRowValuePartition => {
  const partition: NewRowValuePartition = { frontmatter: {}, context: {} };
  if (!rowData) return partition;

  for (const [name, value] of Object.entries(rowData)) {
    if (name == PathPropertyName) continue;
    // Only the folder's own (root) columns own a durable home on the new row.
    // Linked-context columns (table != "") are not this file's to seed here.
    const column = columns.find(
      (item) => item.name == name && (item.table ?? "") == ""
    );
    if (!column) continue;

    const authority = propertyAuthorityForColumn(column);
    if (authority == "frontmatter") {
      partition.frontmatter[name] = String(value ?? "");
    } else if (authority == "notidian") {
      partition.context[name] = String(value ?? "");
    }
    // "file" identity and "computed" values have no new-row seed home.
  }

  return partition;
};
