/**
 * Regression test for bd Notidian-oec: grouped board/list drag wrote a literal
 * "[object Object]" key into the dragged note's frontmatter, because `_groupField`
 * is the full SpaceProperty column object and was used directly as a computed key.
 *
 * These tests exercise the pure helpers the drag handler now uses. They FAIL
 * against the pre-fix code (which produced "[object Object]") and PASS with the fix.
 */
import {
  frontmatterGroupDragWrite,
  resolveGroupFieldName,
} from "core/utils/contexts/groupDrag";

describe("oec: grouped drag key resolution", () => {
  it("resolves the canonical column name from a SpaceProperty object", () => {
    const groupField = { name: "status", table: "", type: "option" };
    expect(resolveGroupFieldName(groupField)).toBe("status");
    // The bug: String(groupField) === "[object Object]"
    expect(resolveGroupFieldName(groupField)).not.toBe("[object Object]");
  });

  it("writes a frontmatter-backed group column under its real key (never [object Object])", () => {
    const groupField = { name: "status", table: "", type: "option", source: "frontmatter" };
    const write = frontmatterGroupDragWrite(groupField, "Done");
    expect(write).toEqual({ key: "status", value: "Done" });

    // Prove the value actually lands under the column name, not the coerced object.
    const fm = write ? { [write.key]: write.value } : {};
    expect(fm).toEqual({ status: "Done" });
    expect(Object.keys(fm)).not.toContain("[object Object]");
  });

  it("does not write Notidian-owned (non-frontmatter) group columns to YAML", () => {
    // A source-less / context-owned column must not be written to the Markdown file.
    expect(
      frontmatterGroupDragWrite({ name: "relation", table: "", type: "context" }, "x")
    ).toBeNull();
  });

  it("returns null for an unresolvable group field instead of corrupting data", () => {
    expect(resolveGroupFieldName(undefined)).toBeNull();
    expect(resolveGroupFieldName({})).toBeNull();
    expect(frontmatterGroupDragWrite(undefined, "x")).toBeNull();
  });
});
