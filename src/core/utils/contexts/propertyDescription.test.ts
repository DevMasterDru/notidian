// H3 hover-tooltip elaboration (Notidian-pb7p.3 / Atlas ADR-0096 D1: elaboration
// is carried by hover tooltips, not body prose). A column's description rides
// the existing `attrs` metadata envelope — `m_fields` has no arbitrary extension
// columns, so a new SpaceProperty field would be discarded on every database
// write (the groupedIslandOrder precedent).
import {
  attrsWithPropertyDescription,
  propertyDescriptionFromAttrs,
} from "./propertyDescription";
import { attrsWithTextGroupOrder } from "./groupedIslandOrder";

describe("propertyDescriptionFromAttrs", () => {
  it("reads a stored description", () => {
    expect(
      propertyDescriptionFromAttrs(JSON.stringify({ notidianDescription: "Why it matters" }))
    ).toBe("Why it matters");
  });

  it("trims surrounding whitespace", () => {
    expect(
      propertyDescriptionFromAttrs(JSON.stringify({ notidianDescription: "  padded  " }))
    ).toBe("padded");
  });

  it("returns undefined for absent, blank, malformed, or non-text values", () => {
    expect(propertyDescriptionFromAttrs(undefined)).toBeUndefined();
    expect(propertyDescriptionFromAttrs("")).toBeUndefined();
    expect(propertyDescriptionFromAttrs("not json")).toBeUndefined();
    expect(propertyDescriptionFromAttrs("[1,2]")).toBeUndefined();
    expect(propertyDescriptionFromAttrs(JSON.stringify({}))).toBeUndefined();
    expect(
      propertyDescriptionFromAttrs(JSON.stringify({ notidianDescription: "   " }))
    ).toBeUndefined();
    expect(
      propertyDescriptionFromAttrs(JSON.stringify({ notidianDescription: 42 }))
    ).toBeUndefined();
  });
});

describe("attrsWithPropertyDescription", () => {
  it("stores a description into empty attrs", () => {
    const next = attrsWithPropertyDescription(undefined, "Why it matters");
    expect(propertyDescriptionFromAttrs(next)).toBe("Why it matters");
  });

  it("clears the description on blank input and drops empty attrs entirely", () => {
    const stored = attrsWithPropertyDescription(undefined, "gone soon");
    expect(attrsWithPropertyDescription(stored, "  ")).toBeUndefined();
    expect(attrsWithPropertyDescription(stored, undefined)).toBeUndefined();
  });

  it("preserves every unrelated attrs key (no clobber of sibling metadata)", () => {
    // The shipped sibling writer in the SAME envelope — proves the two
    // round-trip through each other rather than overwriting.
    const withOrder = attrsWithTextGroupOrder(undefined, ["b", "a"]);
    const withBoth = attrsWithPropertyDescription(withOrder, "Sorted by hand");

    expect(propertyDescriptionFromAttrs(withBoth)).toBe("Sorted by hand");
    expect(JSON.parse(withBoth).notidianGroupOrder).toEqual(["b", "a"]);

    const cleared = attrsWithPropertyDescription(withBoth, "");
    expect(propertyDescriptionFromAttrs(cleared)).toBeUndefined();
    expect(JSON.parse(cleared).notidianGroupOrder).toEqual(["b", "a"]);
  });

  it("leaves malformed attrs behind rather than propagating the garbage", () => {
    const next = attrsWithPropertyDescription("not json", "fresh");
    expect(propertyDescriptionFromAttrs(next)).toBe("fresh");
  });
});
