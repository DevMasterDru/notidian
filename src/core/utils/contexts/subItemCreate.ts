import { newPathInSpace } from "core/superstate/utils/spaces";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";

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
}: {
  superstate: Superstate;
  contextPath: string;
  schema: string;
  index: number;
  subItemsField: string | null | undefined;
}): Promise<string | null> => {
  if (!subItemsField) return null;
  const freshContext = await superstate.spaceManager.readTable(
    contextPath,
    schema
  );
  const freshRows = freshContext?.rows;
  if (!freshRows || index >= freshRows.length) {
    console.warn("Add sub-item: Row no longer exists at index", index);
    return null;
  }
  const parentPath = String(freshRows[index][PathPropertyName] ?? "");
  if (!parentPath) {
    console.warn("Add sub-item: parent row has no path", index);
    return null;
  }
  const space = superstate.spacesIndex.get(contextPath);
  if (!space) {
    console.warn("Add sub-item: space not found for", contextPath);
    return null;
  }
  // Parent's display title = basename of its path (matches the basename-only
  // wikilink form the relation resolver canonicalizes).
  const parentTitle =
    parentPath.replace(/\.md$/, "").split("/").pop() ?? parentPath;
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
    properties: { [subItemsField]: `[[${parentTitle}]]` },
  });
  return childPath;
};
