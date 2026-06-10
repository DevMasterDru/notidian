import { DBRow } from "shared/types/mdb";
import { URI } from "shared/types/path";
import { PathState } from "shared/types/PathState";

export const listItemSupportsRowExpansion = (
  itemUri: Pick<URI, "authority" | "ref"> | null | undefined
): boolean => itemUri?.authority == "$kit" && itemUri?.ref == "rowItem";

export const expandableRowNotePath = (
  row: DBRow | null | undefined,
  primaryKey: string | null | undefined,
  getPathState: (path: string) => Partial<PathState> | null | undefined
): string | null => {
  if (!row || !primaryKey) return null;
  const path = row[primaryKey];
  if (typeof path != "string" || path.trim().length == 0) return null;
  const pathState = getPathState(path);
  if (pathState?.type != "file" || pathState?.subtype != "md") return null;
  return path;
};

export const toggleRowExpansion = (
  expandedPaths: Record<string, boolean>,
  notePath: string
): Record<string, boolean> => ({
  ...expandedPaths,
  [notePath]: !expandedPaths[notePath],
});
