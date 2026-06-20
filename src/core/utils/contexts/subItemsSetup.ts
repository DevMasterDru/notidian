import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import type { SpaceTableColumn } from "shared/types/mdb";
import type { Predicate } from "shared/types/predicate";

// SINGLE source of the "Turn on sub-items" front-door semantics (bd
// Notidian-xqxc), mirroring how subItemCreate.ts is the single sub-item CREATE
// path. The sub-items tree engine ships and is tested but stays DORMANT until a
// view sets predicate.subItems.field at a self-relation parent-link column —
// which most databases lack and no front-door creates. This makes the engine
// reachable in ONE action: reuse an existing eligible self-relation column if
// there is one, otherwise CREATE a frontmatter-backed parent-link column, then
// set predicate.subItems.field so the chevron / indent / "+ Add sub-item"
// affordance renders.
//
// HARD ROUND-TRIP INVARIANT — the created column MUST stay
//   { type: "link", source: "frontmatter", table: "" }.
// subItemCreate writes a plain `[[Parent]]` wikilink into the CHILD's
// frontmatter under the column NAME; buildRowTree reads row[name+table] and
// resolves it. A "link" col is frontmatter-backed (propertyAuthority -> the
// "frontmatter" authority) and is NOT matched by linkContextRow's relation
// reducer, so the wikilink survives into row[name] exactly as the tree reads it.
// A "context" column would resolve to "notidian"/MDB authority (so the plain
// frontmatter write is never materialized into row[name]) AND would be
// overwritten by linkContextRow's relationFields reducer (it needs a {space}
// value JSON the plain write never supplies) — the round-trip would NOT close
// and it would violate the file-canonical authority model (ADR 0001/0017). Do
// not "upgrade" this to a context relation column without also changing
// subItemCreate's write path.

// The eligible self-relation predicate FilterBar uses (FilterBar.tsx): a
// primary-table (table == "") link/context column whose links can point at
// sibling rows in THIS table. A linked-context column to another space can never
// form the tree.
const isEligibleParentColumn = (f: SpaceTableColumn): boolean =>
  (f.table ?? "") == "" &&
  (f.type?.startsWith("link") || f.type?.startsWith("context"));

// Case-INSENSITIVE unique name matching saveColumn's duplicate guard
// (ContextEditorContext.tsx lowercases both sides). The repo's
// uniqueNameFromString is case-SENSITIVE, so it could hand back a name
// saveColumn then rejects (a silent no-op that leaves sub-items off) — hence
// this inline version. The produced name (e.g. "Parent item 2") is
// sanitizeColumnName-stable, so the predicate field we set (== name) matches the
// stored column name.
const uniqueParentColumnName = (
  base: string,
  cols: SpaceTableColumn[]
): string => {
  const taken = new Set(cols.map((c) => c.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
};

export const enableSubItemsWithColumn = (args: {
  cols: SpaceTableColumn[];
  saveColumn: (col: SpaceTableColumn) => boolean;
  savePredicate: (predicate: Partial<Predicate>) => void;
  currentSubItems?: Predicate["subItems"];
  columnName?: string;
  // The active view's db schema id, used as the created column's schemaId so it
  // matches the table it lands in (sibling create paths tag columns the same
  // way). Defaults to the primary files schema. The caller (FilterBar) only
  // offers create on the primary files schema, where the round-trip works.
  schemaId?: string;
}): { ok: boolean; field: string | null; created: boolean } => {
  const { cols, saveColumn, savePredicate, currentSubItems, columnName, schemaId } =
    args;

  // REUSE-FIRST, over VISIBLE eligible columns only: if an eligible self-relation
  // column the user can see already exists, designate it rather than creating a
  // duplicate. Restricting to visible columns matches the menu's offer gate (it
  // only offers "create" when no VISIBLE eligible col exists), so a HIDDEN
  // eligible column is never silently designated behind a "creates Parent item
  // column" label — it falls through to genuine creation instead. Prefer a
  // link-typed col over a context-typed one so reuse never selects a
  // non-round-tripping context column when a link col is available.
  const eligible = cols.filter(
    (f) => isEligibleParentColumn(f) && f.hidden != "true"
  );
  if (eligible.length > 0) {
    const chosen =
      eligible.find((f) => f.type?.startsWith("link")) ?? eligible[0];
    const field = chosen.name + (chosen.table ?? "");
    savePredicate({ subItems: { ...(currentSubItems ?? {}), field } });
    return { ok: true, field, created: false };
  }

  // CREATE: a frontmatter-backed primary-table link column (see invariant).
  // Dedupe against the FULL cols list (including hidden) so a hidden same-named
  // column still forces a unique name saveColumn won't reject.
  const name = uniqueParentColumnName(columnName ?? "Parent item", cols);
  const col: SpaceTableColumn = {
    name,
    type: "link",
    value: "",
    table: "",
    schemaId: schemaId ?? defaultContextSchemaID,
    source: frontmatterPropertySource,
  };
  const created = saveColumn(col);
  // saveColumn already notified on a dup/empty-name reject; never point the
  // predicate at a column that was not created (that would leave a dangling
  // subItems.field and a flat view).
  if (!created) return { ok: false, field: null, created: false };

  // table is "" for a primary column, so field == name == the write key
  // subItemCreate uses. Spread keeps any existing display / filterScope /
  // collapsed keys (ADR 0050).
  const field = name;
  savePredicate({ subItems: { ...(currentSubItems ?? {}), field } });
  return { ok: true, field, created: true };
};
