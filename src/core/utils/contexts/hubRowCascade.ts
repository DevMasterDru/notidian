// Row-as-child-hub (Notidian-z21a, Atlas Method ADR-0042 D1 — depth 1): a
// database row whose file has a same-named sibling FOLDER is itself the hub
// of a nested child database. Space resolution already treats that sibling
// file as the folder-space's note when adjacent mode is on (settings
// `folderNoteInsideFolder === false`; ADR 0008; see
// core/spaceManager/filesystemAdapter/spaceInfo.ts and
// superstate.onPathCreated's `siblingSpacePath`) — so a folder + adjacent
// note pair is ALREADY a recognized space relationship, not a new heuristic.
//
// What is missing (the "breaks" half of verify-then-build): nothing keeps
// that folder in sync when the row's FILE is renamed, moved, or deleted.
// `core/superstate/utils/path.ts`'s renamePathByName/movePathToSpace/
// deletePath only ever touch the single file for a plain (non-space) row —
// the sibling folder is silently orphaned under its old name (rename/move)
// or left behind (delete). This module is the pure planner for closing that
// gap: no filesystem/superstate access, so it is fully unit-testable; callers
// own the read (does the sibling folder exist, and does IT already consider
// this exact file its own note?) and the write (spaceManager.renameSpace /
// deleteSpace for the folder, alongside the normal file rename/move/delete).
//
// Pure — no I/O, no throws. Gated end-to-end behind settings.enableNestedHubRows.

export const hubRowChildFolderPath = (path: string): string | null => {
  if (!path || !path.toLowerCase().endsWith(".md")) return null;
  const withoutExt = path.slice(0, -3);
  const lastSlash = withoutExt.lastIndexOf("/");
  const base = lastSlash === -1 ? withoutExt : withoutExt.slice(lastSlash + 1);
  if (!base) return null; // e.g. "Folder/.md" — no real basename to nest under
  return withoutExt;
};

// True only when `folderPath` is ALREADY an indexed space whose own
// configured note is exactly `rowPath` — i.e. the same test the space system
// itself uses (spaceInfo.notePath), never a bare name-collision guess. A
// same-named sibling folder that is NOT actually configured with this file as
// its note (inside-mode, or a coincidental unrelated folder) must never be
// treated as this row's child hub.
const isConfiguredHubFolder = (
  folderPath: string,
  rowPath: string,
  notePathForFolder: (folderPath: string) => string | null | undefined
): boolean => notePathForFolder(folderPath) === rowPath;

export const isHubRowPath = (
  path: string,
  notePathForFolder: (folderPath: string) => string | null | undefined
): boolean => {
  const folder = hubRowChildFolderPath(path);
  if (!folder) return false;
  return isConfiguredHubFolder(folder, path, notePathForFolder);
};

// Render gate for the hub-row indicator affordance (Notidian-b0fm). The
// standalone HubRowIndicator carries no gating logic of its own; a row-render
// surface (TableView gutter) shows it for a row only when BOTH the opt-in
// indicator flag AND the underlying nested-hub feature are enabled AND the
// row's path is a configured hub row. Kept pure (no I/O, no throws — caller
// supplies the notePath read) so the flag/relationship gate is unit-testable
// off the render path, same posture as isHubRowPath.
export const shouldRenderHubRowIndicator = (
  settings: {
    enableHubRowIndicator?: boolean;
    enableNestedHubRows?: boolean;
  },
  path: string,
  notePathForFolder: (folderPath: string) => string | null | undefined
): boolean => {
  if (!settings.enableHubRowIndicator || !settings.enableNestedHubRows) {
    return false;
  }
  return isHubRowPath(path, notePathForFolder);
};

export type HubRowCascadePlan =
  | { kind: "rename"; fromFolder: string; toFolder: string }
  | { kind: "delete"; folder: string }
  | { kind: "none" };

export const planHubRowRenameCascade = (
  oldPath: string,
  newPath: string,
  notePathForFolder: (folderPath: string) => string | null | undefined
): HubRowCascadePlan => {
  const fromFolder = hubRowChildFolderPath(oldPath);
  const toFolder = hubRowChildFolderPath(newPath);
  if (!fromFolder || !toFolder) return { kind: "none" };
  if (fromFolder === toFolder) return { kind: "none" };
  if (!isConfiguredHubFolder(fromFolder, oldPath, notePathForFolder))
    return { kind: "none" };
  return { kind: "rename", fromFolder, toFolder };
};

export const planHubRowDeleteCascade = (
  path: string,
  notePathForFolder: (folderPath: string) => string | null | undefined
): HubRowCascadePlan => {
  const folder = hubRowChildFolderPath(path);
  if (!folder) return { kind: "none" };
  if (!isConfiguredHubFolder(folder, path, notePathForFolder))
    return { kind: "none" };
  return { kind: "delete", folder };
};

// Type Profile structural keys (core/utils/contexts/typeProfile.ts's
// `parseTypeProfile`): reserved for a hub note's OWN nested-database schema
// declaration, never row data. A row that is itself a child-hub (this
// module's subject) legitimately carries these on its own frontmatter — the
// PARENT database's frontmatter column discovery must not surface them as
// noisy parent-table columns. `database`/`slug` are deliberately NOT included
// here: they double as ordinary row fields on many hub-declared schemas
// (e.g. the vault Knowledge database's own `database` field), so excluding
// them would hide a legitimate column, not just structural noise.
export const typeProfileReservedFrontmatterKeys: readonly string[] = [
  "schema_type",
  "fields",
  "kind_fields",
  "invariants",
];
