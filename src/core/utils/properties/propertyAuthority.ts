import { PathPropertyName } from "shared/types/context";
import { SpaceProperty } from "shared/types/mdb";

export type PropertyAuthority =
  | "file"
  | "frontmatter"
  | "notidian"
  | "computed";

const frontmatterSource = "frontmatter";

export const propertyAuthorityForColumn = (
  property?: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): PropertyAuthority => {
  if (property?.name === PathPropertyName) return "file";
  if (property?.source === frontmatterSource) return "frontmatter";
  // Computed/read-only column types: their value is derived at render time and
  // must never be persisted from a paste/undo into the context table. rollup
  // (8pl) and backlink (ahk) are computed like fileprop/aggregate.
  if (
    property?.type === "fileprop" ||
    property?.type === "aggregate" ||
    property?.type === "rollup" ||
    property?.type === "backlink"
  ) {
    return "computed";
  }
  return "notidian";
};

export const shouldWriteAuthorityValueToFrontmatter = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): boolean => {
  const authority = propertyAuthorityForColumn(property);
  return authority === "frontmatter";
};

export const shouldPersistAuthorityValueToContext = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): boolean => {
  const authority = propertyAuthorityForColumn(property);
  return authority === "file" || authority === "notidian";
};
