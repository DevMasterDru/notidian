import { defaultPredicate } from "shared/schemas/predicate";
import {
  defaultPredicateForSchema,
  validatePredicate,
} from "core/utils/contexts/predicate/predicate";
import {
  displayPropertyForPredicate,
  isLinkLikeDisplayType,
  resolveRowDisplayLabel,
  rowDisplayLabelOverride,
} from "./rowDisplayLabel";

describe("displayPropertyForPredicate", () => {
  it("returns the configured display property", () => {
    expect(
      displayPropertyForPredicate({
        listViewProps: { displayProperty: "title" },
      })
    ).toBe("title");
  });

  it("returns null when no display property is configured", () => {
    expect(displayPropertyForPredicate(null)).toBeNull();
    expect(displayPropertyForPredicate({})).toBeNull();
    expect(displayPropertyForPredicate({ listViewProps: {} })).toBeNull();
  });

  it("returns null for empty, whitespace, or non-string values", () => {
    expect(
      displayPropertyForPredicate({ listViewProps: { displayProperty: "" } })
    ).toBeNull();
    expect(
      displayPropertyForPredicate({ listViewProps: { displayProperty: "  " } })
    ).toBeNull();
    expect(
      displayPropertyForPredicate({ listViewProps: { displayProperty: 3 } })
    ).toBeNull();
  });
});

describe("rowDisplayLabelOverride", () => {
  it("returns the row's display property value when present", () => {
    expect(
      rowDisplayLabelOverride(
        { title: "Archive mining: distillation-first desire registry" },
        "title"
      )
    ).toBe("Archive mining: distillation-first desire registry");
  });

  it("returns null when no display property is set", () => {
    expect(rowDisplayLabelOverride({ title: "A Title" }, null)).toBeNull();
    expect(rowDisplayLabelOverride({ title: "A Title" }, "")).toBeNull();
  });

  it("returns null when the row value is missing or empty so callers fall back to the basename", () => {
    expect(rowDisplayLabelOverride({}, "title")).toBeNull();
    expect(rowDisplayLabelOverride(null, "title")).toBeNull();
    expect(rowDisplayLabelOverride({ title: "" }, "title")).toBeNull();
    expect(rowDisplayLabelOverride({ title: "   " }, "title")).toBeNull();
  });

  it("composes with a basename fallback", () => {
    const row = { title: "" };
    expect(rowDisplayLabelOverride(row, "title") ?? "Atlasidian-0c4.8").toBe(
      "Atlasidian-0c4.8"
    );
  });

  it("extracts the basename for a link-typed column (Notidian-xsau)", () => {
    expect(
      rowDisplayLabelOverride({ parent: "Folder/Parent" }, "parent", "link")
    ).toBe("Parent");
    expect(
      rowDisplayLabelOverride(
        { parent: "[[Folder/Parent|Parent]]" },
        "parent",
        "context"
      )
    ).toBe("Parent");
  });

  it("leaves a non-link column value unchanged", () => {
    expect(
      rowDisplayLabelOverride({ parent: "Folder/Parent" }, "parent", "text")
    ).toBe("Folder/Parent");
  });
});

describe("display property predicate persistence", () => {
  it("survives predicate validation on save and load", () => {
    const validated = validatePredicate(
      {
        ...defaultPredicate,
        listViewProps: { displayProperty: "title" },
      },
      defaultPredicate
    );
    expect(validated.listViewProps.displayProperty).toBe("title");

    const roundTripped = validatePredicate(
      JSON.parse(JSON.stringify(validated)),
      defaultPredicate
    );
    expect(displayPropertyForPredicate(roundTripped)).toBe("title");
  });

  it("stays absent for predicates that never set it", () => {
    const validated = validatePredicate(
      defaultPredicateForSchema({ primary: "true" } as any),
      defaultPredicate
    );
    expect(displayPropertyForPredicate(validated)).toBeNull();
  });
});

describe("resolveRowDisplayLabel", () => {
  const pathState = {
    metadata: {
      property: {
        title: "S6 - B6 overview layer",
        priority_num: 1,
        empty: "   ",
      },
    },
  };

  it("prefers the row value when the property is a persisted column", () => {
    expect(
      resolveRowDisplayLabel({ title: "Row Title" }, pathState, "title")
    ).toBe("Row Title");
  });

  it("falls back to frontmatter when the row dict lacks the property", () => {
    expect(resolveRowDisplayLabel({}, pathState, "title")).toBe(
      "S6 - B6 overview layer"
    );
    expect(resolveRowDisplayLabel(null, pathState, "title")).toBe(
      "S6 - B6 overview layer"
    );
  });

  it("stringifies non-string frontmatter values", () => {
    expect(resolveRowDisplayLabel({}, pathState, "priority_num")).toBe("1");
  });

  it("returns null for empty frontmatter values and missing keys", () => {
    expect(resolveRowDisplayLabel({}, pathState, "empty")).toBeNull();
    expect(resolveRowDisplayLabel({}, pathState, "missing")).toBeNull();
    expect(resolveRowDisplayLabel({}, null, "title")).toBeNull();
  });

  it("returns null without a display property", () => {
    expect(resolveRowDisplayLabel({ title: "x" }, pathState, null)).toBeNull();
    expect(resolveRowDisplayLabel({ title: "x" }, pathState, "")).toBeNull();
  });

  // Notidian-xsau: when the user picks a path-qualified parent-link column
  // (kg81 writer) as the list-view displayProperty, the raw materialized value
  // is "Folder/Parent" (optionally wikilink-wrapped). A link/context-typed
  // display column must resolve to the human-facing basename, not the path.
  describe("link/context-typed display columns (Notidian-xsau)", () => {
    it("extracts the basename from a path-qualified link value", () => {
      expect(
        resolveRowDisplayLabel(
          { parent: "Folder/Parent" },
          pathState,
          "parent",
          "link"
        )
      ).toBe("Parent");
    });

    it("extracts the basename from a bare wikilink", () => {
      expect(
        resolveRowDisplayLabel(
          { parent: "[[Folder/Parent]]" },
          pathState,
          "parent",
          "link"
        )
      ).toBe("Parent");
    });

    it("extracts the basename from an alias-bearing wikilink", () => {
      expect(
        resolveRowDisplayLabel(
          { parent: "[[Folder/Parent|Parent]]" },
          pathState,
          "parent",
          "link"
        )
      ).toBe("Parent");
    });

    it("handles context-multi typed columns the same way", () => {
      expect(
        resolveRowDisplayLabel(
          { parent: "Deep/Nested/Folder/Parent" },
          pathState,
          "parent",
          "context-multi"
        )
      ).toBe("Parent");
    });

    it("returns a vault-root (folderless) link value unchanged", () => {
      expect(
        resolveRowDisplayLabel(
          { parent: "Parent" },
          pathState,
          "parent",
          "link"
        )
      ).toBe("Parent");
    });

    it("leaves a non-link display value path-qualified (no behavior change)", () => {
      expect(
        resolveRowDisplayLabel(
          { parent: "Folder/Parent" },
          pathState,
          "parent",
          "text"
        )
      ).toBe("Folder/Parent");
      // Absent type behaves like a plain (non-link) value.
      expect(
        resolveRowDisplayLabel(
          { parent: "Folder/Parent" },
          pathState,
          "parent"
        )
      ).toBe("Folder/Parent");
    });

    it("resolves a link-typed displayProperty from the frontmatter cache too", () => {
      const fmPathState = {
        metadata: { property: { parent: "Folder/Parent" } },
      };
      expect(
        resolveRowDisplayLabel({}, fmPathState, "parent", "link")
      ).toBe("Parent");
    });

    it("returns null for null/empty link values regardless of type", () => {
      expect(
        resolveRowDisplayLabel({ parent: "" }, pathState, "parent", "link")
      ).toBeNull();
      expect(
        resolveRowDisplayLabel({ parent: "   " }, pathState, "parent", "link")
      ).toBeNull();
      expect(
        resolveRowDisplayLabel({}, pathState, "parent", "link")
      ).toBeNull();
    });
  });
});

describe("isLinkLikeDisplayType", () => {
  it("is true for link- and context-prefixed types", () => {
    expect(isLinkLikeDisplayType("link")).toBe(true);
    expect(isLinkLikeDisplayType("link-multi")).toBe(true);
    expect(isLinkLikeDisplayType("context")).toBe(true);
    expect(isLinkLikeDisplayType("context-multi")).toBe(true);
  });

  it("is false for non-link types and nullish", () => {
    expect(isLinkLikeDisplayType("text")).toBe(false);
    expect(isLinkLikeDisplayType("number")).toBe(false);
    expect(isLinkLikeDisplayType("")).toBe(false);
    expect(isLinkLikeDisplayType(null)).toBe(false);
    expect(isLinkLikeDisplayType(undefined)).toBe(false);
  });
});
