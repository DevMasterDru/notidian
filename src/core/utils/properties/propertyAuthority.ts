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
  if (property?.type === "fileprop" || property?.type === "aggregate") {
    return "computed";
  }
  return "notidian";
};

export const shouldWriteAuthorityValueToFrontmatter = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>,
  saveAllContextToFrontmatter: boolean
): boolean => {
  const authority = propertyAuthorityForColumn(property);
  return (
    authority === "frontmatter" ||
    (authority === "notidian" && saveAllContextToFrontmatter)
  );
};

export const shouldPersistAuthorityValueToContext = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): boolean => {
  const authority = propertyAuthorityForColumn(property);
  return authority === "file" || authority === "notidian";
};
