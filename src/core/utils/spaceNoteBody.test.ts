import { isNoteBodyEmpty, stripFrontmatter } from "core/utils/spaceNoteBody";

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block", () => {
    expect(
      stripFrontmatter("---\ntags:\n  - database\n---\n# Body\n")
    ).toBe("# Body\n");
  });

  it("keeps content without frontmatter", () => {
    expect(stripFrontmatter("# Body\n")).toBe("# Body\n");
  });

  it("does not treat a mid-document divider as frontmatter", () => {
    const content = "intro\n---\nmore\n---\nend";
    expect(stripFrontmatter(content)).toBe(content);
  });

  it("handles frontmatter with no trailing newline", () => {
    expect(stripFrontmatter("---\na: 1\n---")).toBe("");
  });

  it("handles crlf frontmatter", () => {
    expect(stripFrontmatter("---\r\na: 1\r\n---\r\nBody")).toBe("Body");
  });

  it("handles empty input", () => {
    expect(stripFrontmatter("")).toBe("");
  });
});

describe("isNoteBodyEmpty", () => {
  it("is empty for null content (missing file)", () => {
    expect(isNoteBodyEmpty(null)).toBe(true);
    expect(isNoteBodyEmpty(undefined)).toBe(true);
  });

  it("is empty for a frontmatter-only note", () => {
    expect(
      isNoteBodyEmpty("---\nschema_type: notidian_type_profile\nfields:\n  status:\n    kind: select\n---\n")
    ).toBe(true);
  });

  it("is empty for whitespace-only body", () => {
    expect(isNoteBodyEmpty("---\na: 1\n---\n\n   \n")).toBe(true);
    expect(isNoteBodyEmpty("\n  \n")).toBe(true);
  });

  it("is non-empty when a body follows frontmatter", () => {
    expect(isNoteBodyEmpty("---\na: 1\n---\n# Legend\n")).toBe(false);
  });

  it("is non-empty for body without frontmatter", () => {
    expect(isNoteBodyEmpty("Just text")).toBe(false);
  });
});
