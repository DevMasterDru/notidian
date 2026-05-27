import { fieldTypes, FieldType } from "schemas/mdb";
import { SpaceProperty } from "shared/types/mdb";
import { frontmatterPropertySource } from "../properties/allProperties";

const frontmatterTableTypes = new Set([
  "text",
  "number",
  "boolean",
  "date",
  "option",
  "link",
  "image",
]);

const isTagsProperty = (field: Pick<SpaceProperty, "name">): boolean =>
  field.name?.toLowerCase() == "tags";

export const propertyTypeOptionsForField = (
  field: Pick<SpaceProperty, "name" | "source">
): FieldType[] =>
  fieldTypes.filter((type) => {
    if (type.restricted) return false;
    if (field.source != frontmatterPropertySource) return true;
    if (type.type == "tags-multi") return isTagsProperty(field);
    return frontmatterTableTypes.has(type.type);
  });
