import { newPathInSpace } from "core/superstate/utils/spaces";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";
import { subItemsSchemaCanRoundTrip } from "core/utils/contexts/subItemsResolve";

// The SINGLE source of sub-item creation write semantics (ADR 0050, one-way /
// ADR 0024 B1). Shared by the row context-menu "Add sub-item" action and the
// inline "+" affordance so there is exactly one create path. It re-reads the
// table for a fresh parent row, creates an empty-titled child in the same space
// (mirroring newRow), and writes ONLY the child's parent link — the parent's
// .md is never touched and no reciprocal "children" property is written (the
// parent's children stay the read-time back-relation computed by buildRowTree).
// Returns the new child's path, or null on any guard failure.
export const createSubItemRow = async ({
  superstate,
  contextPath,
  schema,
  index,
  subItemsField,
  parentPath: parentPathArg,
}: {
  superstate: Superstate;
  contextPath: string;
  schema: string;
  // The parent's index in the table — used to resolve the parent path when
  // parentPath isn't supplied. Optional when parentPath is given directly.
  index?: number;
  subItemsField: string | null | undefined;
  // The parent ROW's resolved path key (Notidian-gr8t). When supplied (e.g. by
  // the "+ New sub-item" affordance, which already holds the tree node's path),
  // the index->table re-read is skipped — index-independent and avoids a reorder
  // race. Falls back to the index lookup when absent (the row-menu caller).
  parentPath?: string;
}): Promise<string | null> => {
  if (!subItemsField) return null;
  // Write-path schema guard (bd Notidian-8k9b): the child's parent link only
  // materializes back into the parent's row for the primary files schema
  // (filesystemAdapter syncContextRow). On any other schema the link is written
  // to the canonical .md store but never round-trips into the rendered tree — a
  // silent dead write that produces an orphaned non-nesting child. Refuse it at
  // the single shared create path so no surface (row menu, inline "+") can ever
  // create one off-primary, even if a stale predicate slips past the render gate.
  if (!subItemsSchemaCanRoundTrip(schema)) {
    console.warn(
      "Add sub-item: schema cannot round-trip a parent link, skipping create",
      schema
    );
    return null;
  }
  let parentPath = parentPathArg;
  if (!parentPath) {
    const freshContext = await superstate.spaceManager.readTable(
      contextPath,
      schema
    );
    const freshRows = freshContext?.rows;
    if (!freshRows || index == null || index >= freshRows.length) {
      console.warn("Add sub-item: Row no longer exists at index", index);
      return null;
    }
    parentPath = String(freshRows[index][PathPropertyName] ?? "");
  }
  if (!parentPath) {
    console.warn("Add sub-item: parent row has no path", index);
    return null;
  }
  const space = superstate.spacesIndex.get(contextPath);
  if (!space) {
    console.warn("Add sub-item: space not found for", contextPath);
    return null;
  }
  // PATH-QUALIFIED parent link (Notidian-kg81). The link must resolve back to
  // THIS parent ROW, so it carries the parent's full vault path (minus .md), not
  // just its basename. A bare `[[basename]]` is ambiguous: Obsidian's link index
  // (getFirstLinkpathDest) resolves it to the FIRST same-named file ANYWHERE in
  // the vault, so in any vault with basename collisions the child resolved to the
  // wrong file, never matched its real parent, and the disclosure triangle never
  // appeared. The display alias keeps the clean basename so the cell still reads
  // "Parent", not the full path. resolvePath canonicalizes the path-qualified
  // target to the parent row's path key (file -> ".md", folder/sub-space -> the
  // folder path), and parseRelationLinks strips the alias before resolving.
  const parentLinkTarget = parentPath.replace(/\.md$/, "");
  const parentTitle = parentLinkTarget.split("/").pop() ?? parentLinkTarget;
  // Create the child row (empty title) in the same space, mirroring newRow's
  // newPathInSpace call (dontOpen: true).
  const childPath = await newPathInSpace(superstate, space, "md", "", true);
  if (typeof childPath != "string" || !childPath) {
    console.warn("Add sub-item: child creation failed in", contextPath);
    return null;
  }
  // One-way (ADR 0024 B1): write ONLY the child's parent link.
  await saveFrontmatterProperties({
    superstate,
    path: childPath,
    properties: { [subItemsField]: `[[${parentLinkTarget}|${parentTitle}]]` },
  });
  return childPath;
};
