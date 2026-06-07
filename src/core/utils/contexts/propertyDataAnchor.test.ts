import {
  columnDataAnchorForCells,
  columnDataAnchorModeForValue,
  containsRTLText,
} from "./propertyDataAnchor";

describe("columnDataAnchorModeForValue", () => {
  it("falls back to auto for missing or invalid values", () => {
    expect(columnDataAnchorModeForValue()).toBe("auto");
    expect(columnDataAnchorModeForValue("wide")).toBe("auto");
  });

  it("accepts explicit data anchor values", () => {
    expect(columnDataAnchorModeForValue("left")).toBe("left");
    expect(columnDataAnchorModeForValue("center")).toBe("center");
    expect(columnDataAnchorModeForValue("right")).toBe("right");
  });
});

describe("containsRTLText", () => {
  it("detects Hebrew and ignores non-string empty values", () => {
    expect(containsRTLText(["", null, undefined, "Relay א"])).toBe(true);
    expect(containsRTLText(["", null, undefined, "Relay A"])).toBe(false);
  });
});

describe("columnDataAnchorForCells", () => {
  it("lets explicit anchors override automatic behavior", () => {
    expect(
      columnDataAnchorForCells({
        mode: "right",
        headerDisplayMode: "icon",
        columnWidth: 24,
        values: ["Relay A"],
      })
    ).toBe("right");
  });

  it("centers data when the header resolves to icon-only", () => {
    expect(
      columnDataAnchorForCells({
        mode: "auto",
        headerDisplayMode: "adaptive",
        columnWidth: 24,
        values: ["Relay A"],
      })
    ).toBe("center");
  });

  it("uses right alignment for Hebrew data outside icon-only mode", () => {
    expect(
      columnDataAnchorForCells({
        mode: "auto",
        headerDisplayMode: "full",
        columnWidth: 150,
        values: ["בקר"],
      })
    ).toBe("right");
  });

  it("uses left alignment for non-Hebrew data outside icon-only mode", () => {
    expect(
      columnDataAnchorForCells({
        mode: "auto",
        headerDisplayMode: "full",
        columnWidth: 150,
        values: ["Controller"],
      })
    ).toBe("left");
  });
});
