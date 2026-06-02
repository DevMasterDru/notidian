import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { fieldTypeForType } from "schemas/mdb";
import {
  propertyTypeLabelForField,
  propertyTypeOptionsForField,
  shouldShowMultiToggleForPropertyType,
} from "./propertyTypeMenu";

describe("propertyTypeOptionsForField", () => {
  it("keeps context-only Make.md types out of frontmatter-backed column menus", () => {
    const optionTypes = propertyTypeOptionsForField({
      name: "status",
      source: frontmatterPropertySource,
    }).map((type) => type.type);

    expect(optionTypes).toEqual([
      "text",
      "number",
      "boolean",
      "date",
      "option",
      "option-multi",
      "link",
      "image",
    ]);
  });

  it("keeps the original Make.md type surface for Notidian-owned columns", () => {
    const optionTypes = propertyTypeOptionsForField({
      name: "manual",
      source: "",
    }).map((type) => type.type);

    expect(optionTypes).toContain("context");
    expect(optionTypes).toContain("aggregate");
    expect(optionTypes).toContain("object");
  });

  it("only exposes Tags for the real tags property", () => {
    expect(
      propertyTypeOptionsForField({
        name: "area",
        source: frontmatterPropertySource,
      }).map((type) => type.type)
    ).not.toContain("tags-multi");

    expect(
      propertyTypeOptionsForField({
        name: "tags",
        source: frontmatterPropertySource,
      }).map((type) => type.type)
    ).toContain("tags-multi");
  });

  it("labels option-family fields as Select and Multi-select", () => {
    expect(
      propertyTypeLabelForField({
        name: "status",
        source: frontmatterPropertySource,
        type: "option",
      })
    ).toBe("Select");

    expect(
      propertyTypeLabelForField({
        name: "status",
        source: frontmatterPropertySource,
        type: "option-multi",
      })
    ).toBe("Multi-select");
  });

  it("does not show the generic Multiple toggle for option-family fields", () => {
    expect(
      shouldShowMultiToggleForPropertyType(fieldTypeForType("option"))
    ).toBe(false);
    expect(
      shouldShowMultiToggleForPropertyType(fieldTypeForType("option-multi"))
    ).toBe(false);
    expect(shouldShowMultiToggleForPropertyType(fieldTypeForType("link"))).toBe(
      true
    );
  });

  it("does not expose the old Option label in frontmatter type menus", () => {
    const labels = propertyTypeOptionsForField({
      name: "status",
      source: frontmatterPropertySource,
    }).map((type) => type.label);

    expect(labels).toContain("Select");
    expect(labels).toContain("Multi-select");
    expect(labels).not.toContain("Option");
  });
});
