import {
  parseTableClipboardText,
  serializeTableClipboardGrid,
} from "./tableClipboard";

describe("tableClipboard", () => {
  it("parses tab and newline delimited clipboard text", () => {
    expect(parseTableClipboardText("A\tB\nC\tD")).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("normalizes CRLF line endings and trims only the final clipboard newline", () => {
    expect(parseTableClipboardText("A\tB\r\nC\t\r\n")).toEqual([
      ["A", "B"],
      ["C", ""],
    ]);
  });

  it("serializes rectangular values as TSV", () => {
    expect(
      serializeTableClipboardGrid([
        ["A", "B"],
        ["C", "D"],
      ])
    ).toBe("A\tB\nC\tD");
  });

  it("converts nullish values to empty strings when serializing", () => {
    expect(
      serializeTableClipboardGrid([["A", null as any, undefined as any]])
    ).toBe("A\t\t");
  });
});
