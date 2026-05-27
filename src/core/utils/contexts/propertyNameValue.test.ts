import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { fieldForPropertyNameInput } from "./propertyNameValue";

describe("fieldForPropertyNameInput", () => {
  it("keeps frontmatter-backed property keys canonical and stores header edits as aliases", () => {
    const result = fieldForPropertyNameInput({
      field: {
        name: "status",
        type: "option",
        value: JSON.stringify({
          options: [{ name: "active", value: "active" }],
        }),
        source: frontmatterPropertySource,
      },
      value: "State",
      editable: true,
    });

    expect(result).toEqual({
      name: "status",
      type: "option",
      value: JSON.stringify({
        options: [{ name: "active", value: "active" }],
        alias: "State",
      }),
      source: frontmatterPropertySource,
    });
  });

  it("renames Notidian-owned columns when the input is a valid canonical name", () => {
    expect(
      fieldForPropertyNameInput({
        field: { name: "manual", type: "text", value: "" },
        value: "owner",
        editable: true,
      })
    ).toEqual({ name: "owner", type: "text", value: "" });
  });

  it("stores invalid or non-editable name edits as aliases", () => {
    expect(
      fieldForPropertyNameInput({
        field: { name: "manual", type: "text", value: "" },
        value: "_Manual Label",
        editable: true,
      })
    ).toEqual({
      name: "manual",
      type: "text",
      value: JSON.stringify({ alias: "_Manual Label" }),
    });

    expect(
      fieldForPropertyNameInput({
        field: { name: "manual", type: "text", value: "" },
        value: "owner",
        editable: false,
      })
    ).toEqual({
      name: "manual",
      type: "text",
      value: JSON.stringify({ alias: "owner" }),
    });
  });
});
