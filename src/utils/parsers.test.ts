import { parseProperty } from "./parsers";

describe("parseProperty", () => {
  it("preserves falsy frontmatter values for typed properties", () => {
    expect(parseProperty("done", false, "boolean")).toBe("false");
    expect(parseProperty("rating", 0, "number")).toBe("0");
  });

  it("does not coerce arbitrary strings into checked booleans", () => {
    expect(parseProperty("done", "active", "boolean")).toBe("");
    expect(parseProperty("done", "false", "boolean")).toBe("false");
    expect(parseProperty("done", "true", "boolean")).toBe("true");
  });
});
