import {
  propertyHeaderColumnSizingWithMinimum,
  propertyHeaderColumnWidthForSize,
  colsSizeWithPreservedPropertyHeaderWidth,
  propertyHeaderDisplayParts,
  propertyHeaderDisplayModeForValue,
  propertyHeaderMinimumColumnWidth,
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
      showContextMarker: true,
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
      showContextMarker: true,
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
      showContextMarker: false,
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
        showContextMarker: true,
        effectiveMode: "full",
      },
      {
        showIcon: false,
        showText: true,
        showContextMarker: true,
        effectiveMode: "text",
      },
      {
        showIcon: true,
        showText: false,
        showContextMarker: false,
        effectiveMode: "icon",
      },
    ]);
  });
});

describe("propertyHeaderColumnWidthForSize", () => {
  it("allows property headers to collapse to the sticker-only footprint", () => {
    expect(propertyHeaderMinimumColumnWidth).toBe(26);
    expect(propertyHeaderColumnWidthForSize(8)).toBe(
      propertyHeaderMinimumColumnWidth
    );
    expect(propertyHeaderColumnWidthForSize(34)).toBe(34);
  });

  it("clamps persisted column sizing to the sticker-only footprint", () => {
    expect(
      propertyHeaderColumnSizingWithMinimum({
        sensor_id: 8,
        status: 48,
        "+": 30,
      })
    ).toEqual({
      sensor_id: propertyHeaderMinimumColumnWidth,
      status: 48,
      "+": 30,
    });
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
