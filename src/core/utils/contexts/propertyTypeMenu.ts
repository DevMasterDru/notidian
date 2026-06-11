import { fieldTypeForType, fieldTypes, FieldType } from "schemas/mdb";
import { SpaceProperty } from "shared/types/mdb";
import { frontmatterPropertySource } from "../properties/allProperties";

const selectTypeLabel = "Select";
const multiSelectTypeLabel = "Multi-select";

const frontmatterTableTypes = new Set([
  "text",
  "number",
  "boolean",
  "date",
  "option",
  "option-multi",
  "link",
  "image",
]);

const isTagsProperty = (field: Pick<SpaceProperty, "name">): boolean =>
  field.name?.toLowerCase() == "tags";

// A frontmatter-backed column may only hold a file-backed type. Switching a
// column's storage to frontmatter with a context-only type (aggregate/context/
// object) would make propertyAuthorityForColumn report "frontmatter" over an
// incompatible type — callers should reset the type when this returns false.
export const isFrontmatterCompatibleType = (type?: string): boolean =>
  !!type && (frontmatterTableTypes.has(type) || type == "tags-multi");

export const isOptionPropertyType = (type?: string): boolean =>
  type == "option" || type == "option-multi";

const optionMenuTypeFor = (
  type: "option" | "option-multi",
  base: FieldType
): FieldType => ({
  ...base,
  type,
  label: type == "option" ? selectTypeLabel : multiSelectTypeLabel,
  description:
    type == "option"
      ? "Select one value from a defined list"
      : "Select multiple values from a defined list",
  multi: false,
  multiType: undefined,
});

const expandOptionFamily = (type: FieldType): FieldType[] => {
  if (type.type != "option") return [type];
  return [
    optionMenuTypeFor("option", type),
    optionMenuTypeFor("option-multi", type),
  ];
};

export const propertyTypeOptionsForField = (
  field: Pick<SpaceProperty, "name" | "source">
): FieldType[] =>
  fieldTypes
    .filter((type) => {
      if (type.restricted) return false;
      if (field.source != frontmatterPropertySource) return true;
      if (type.type == "tags-multi") return isTagsProperty(field);
      return frontmatterTableTypes.has(type.type);
    })
    .flatMap(expandOptionFamily);

export const propertyTypeLabelForField = (
  field: Pick<SpaceProperty, "name" | "source" | "type">
): string => {
  if (field.type == "option") return selectTypeLabel;
  if (field.type == "option-multi") return multiSelectTypeLabel;
  return fieldTypeForType(field.type, field.name)?.label ?? "";
};

export const shouldShowMultiToggleForPropertyType = (
  fieldType?: FieldType | null
): boolean => !!fieldType?.multi && fieldType.type != "option";
