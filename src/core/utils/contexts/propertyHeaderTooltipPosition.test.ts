import { propertyHeaderTooltipPosition } from "./propertyHeaderTooltipPosition";

describe("propertyHeaderTooltipPosition", () => {
  it("positions the tooltip above the property header", () => {
    expect(
      propertyHeaderTooltipPosition({
        anchorRect: { left: 100, top: 80, width: 120, height: 28 },
        tooltipSize: { width: 180, height: 36 },
        viewportWidth: 500,
      })
    ).toEqual({
      left: 70,
      top: 36,
      arrowLeft: 90,
    });
  });

  it("keeps the tooltip inside the viewport while keeping the arrow near the header", () => {
    expect(
      propertyHeaderTooltipPosition({
        anchorRect: { left: 0, top: 80, width: 40, height: 28 },
        tooltipSize: { width: 180, height: 36 },
        viewportWidth: 500,
      })
    ).toEqual({
      left: 8,
      top: 36,
      arrowLeft: 14,
    });
  });
});
