import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { propertyTypeOptionsForField } from "./propertyTypeMenu";

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
});
