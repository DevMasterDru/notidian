import {
  fieldWithPropertyHeaderIcon,
  fieldWithoutPropertyHeaderIcon,
  hasPropertyHeaderIcon,
} from "./propertyHeaderIcon";

describe("propertyHeaderIcon", () => {
  it("sets a configured header icon while preserving other attrs", () => {
    expect(
      fieldWithPropertyHeaderIcon(
        {
          name: "status",
          type: "text",
          attrs: JSON.stringify({ width: 120 }),
        },
        "ui//star"
      )
    ).toEqual({
      name: "status",
      type: "text",
      attrs: JSON.stringify({ width: 120, icon: "ui//star" }),
    });
  });

  it("resets a configured header icon to the field-type default", () => {
    expect(
      fieldWithoutPropertyHeaderIcon({
        name: "status",
        type: "text",
        attrs: JSON.stringify({ icon: "ui//star", width: 120 }),
      })
    ).toEqual({
      name: "status",
      type: "text",
      attrs: JSON.stringify({ width: 120 }),
    });

    expect(
      fieldWithoutPropertyHeaderIcon({
        name: "status",
        type: "text",
        attrs: JSON.stringify({ icon: "ui//star" }),
      })
    ).toEqual({
      name: "status",
      type: "text",
      attrs: undefined,
    });
  });

  it("detects whether a header icon is configured", () => {
    expect(
      hasPropertyHeaderIcon({
        attrs: JSON.stringify({ icon: "ui//star" }),
      })
    ).toBe(true);
    expect(
      hasPropertyHeaderIcon({
        attrs: JSON.stringify({ width: 120 }),
      })
    ).toBe(false);
  });
});
