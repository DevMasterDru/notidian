import {
  colsSizeWithPreservedPropertyHeaderWidth,
  propertyHeaderDisplayParts,
  propertyHeaderDisplayModeForValue,
} from "./propertyHeaderDisplayMode";

describe("propertyHeaderDisplayModeForValue", () => {
  it("falls back to adaptive for missing or invalid values", () => {
    expect(propertyHeaderDisplayModeForValue()).toBe("adaptive");
    expect(propertyHeaderDisplayModeForValue("compact")).toBe("adaptive");
  });
});

describe("propertyHeaderDisplayParts", () => {
  it("keeps icon and text visible in full mode", () => {
    expect(
      propertyHeaderDisplayParts({
        mode: "full",
        columnWidth: 32,
      })
    ).toEqual({
      showIcon: true,
      showText: true,
      effectiveMode: "full",
    });
  });

  it("supports text-only and icon-only modes", () => {
    expect(
      propertyHeaderDisplayParts({
        mode: "text",
        columnWidth: 32,
      })
    ).toEqual({
      showIcon: false,
      showText: true,
      effectiveMode: "text",
    });

    expect(
      propertyHeaderDisplayParts({
        mode: "icon",
        columnWidth: 140,
      })
    ).toEqual({
      showIcon: true,
      showText: false,
      effectiveMode: "icon",
    });
  });

  it("adapts from full to text-only to icon-only as width shrinks", () => {
    expect(
      [120, 72, 36].map((columnWidth) =>
        propertyHeaderDisplayParts({
          mode: "adaptive",
          columnWidth,
        })
      )
    ).toEqual([
      {
        showIcon: true,
        showText: true,
        effectiveMode: "full",
      },
      {
        showIcon: false,
        showText: true,
        effectiveMode: "text",
      },
      {
        showIcon: true,
        showText: false,
        effectiveMode: "icon",
      },
    ]);
  });
});

describe("colsSizeWithPreservedPropertyHeaderWidth", () => {
  it("keeps the current in-memory width before a header icon save reloads the table", () => {
    expect(
      colsSizeWithPreservedPropertyHeaderWidth({
        colsSize: {
          status: 150,
          sensor_id: 132,
        },
        columnId: "sensor_id",
        columnWidth: 34,
      })
    ).toEqual({
      status: 150,
      sensor_id: 34,
    });
  });
});
