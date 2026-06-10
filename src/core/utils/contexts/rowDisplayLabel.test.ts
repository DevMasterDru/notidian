import { defaultPredicate } from "shared/schemas/predicate";
import {
  defaultPredicateForSchema,
  validatePredicate,
} from "core/utils/contexts/predicate/predicate";
import {
  displayPropertyForPredicate,
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
