import {
  normalizeNotidianEmbedDescriptor,
  OVERLAY_OP_MAP,
  parseNotidianEmbedBlock,
  parseWhereClause,
  WHERE_SYMBOL_OPERATORS,
  WHERE_WORD_OPERATORS,
} from "./notidianEmbed";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import { NotidianEmbedDescriptorError } from "./notidianEmbed";

// This project compiles with strictNullChecks OFF, where narrowing the FALSE
// branch of a boolean-literal discriminated union (`if (!result.ok) {...}`)
// does not work. Read the error payload through an explicit cast instead.
const errorsOf = (
  result: ReturnType<typeof parseNotidianEmbedBlock>
): NotidianEmbedDescriptorError[] =>
  (result as { ok: false; errors: NotidianEmbedDescriptorError[] }).errors;

// ADR-0066 / Notidian-ioxi — grammar coverage for the render-path `where:`
// filter overlay on notidian embeds. All offline (pure parse); the read-path
// merge + write-firewall live in overlayFilters.test.ts and the
// ContextEditorContext firewall DOM test.

describe("parseWhereClause", () => {
  it("maps every supported operator to its filter-registry fn + fType", () => {
    expect(parseWhereClause("repo = Gidi")).toEqual({
      ok: true,
      filter: { field: "repo", fn: "is", value: "Gidi", fType: "text" },
    });
    expect(parseWhereClause("repo != Gidi")).toEqual({
      ok: true,
      filter: { field: "repo", fn: "isNot", value: "Gidi", fType: "text" },
    });
    expect(parseWhereClause("count > 5")).toEqual({
      ok: true,
      filter: { field: "count", fn: "isGreatThan", value: "5", fType: "number" },
    });
    expect(parseWhereClause("count < 5")).toEqual({
      ok: true,
      filter: { field: "count", fn: "isLessThan", value: "5", fType: "number" },
    });
    expect(parseWhereClause("tags includes urgent")).toEqual({
      ok: true,
      filter: { field: "tags", fn: "include", value: "urgent", fType: "text" },
    });
  });

  it("routes relative-date operators through the l12a fns (fType date)", () => {
    expect(parseWhereClause("closed withinLast 7d")).toEqual({
      ok: true,
      filter: { field: "closed", fn: "withinLast", value: "7d", fType: "date" },
    });
    expect(parseWhereClause("updated olderThan 10d")).toEqual({
      ok: true,
      filter: { field: "updated", fn: "olderThan", value: "10d", fType: "date" },
    });
  });

  it("supports field names and values with spaces", () => {
    expect(parseWhereClause("Due Date olderThan 2w")).toEqual({
      ok: true,
      filter: { field: "Due Date", fn: "olderThan", value: "2w", fType: "date" },
    });
    expect(parseWhereClause("Project Name = Atlas Vault")).toEqual({
      ok: true,
      filter: {
        field: "Project Name",
        fn: "is",
        value: "Atlas Vault",
        fType: "text",
      },
    });
  });

  it("tolerates missing whitespace around symbolic operators", () => {
    expect(parseWhereClause("repo=Gidi")).toEqual({
      ok: true,
      filter: { field: "repo", fn: "is", value: "Gidi", fType: "text" },
    });
  });

  it("keeps the first symbolic operator as the split and the rest as value", () => {
    // '=' wins (tested before >/<), the '>' stays inside the value verbatim.
    expect(parseWhereClause("note = a > b")).toEqual({
      ok: true,
      filter: { field: "note", fn: "is", value: "a > b", fType: "text" },
    });
  });

  it.each([
    ["repo Gidi", "no operator"],
    ["= Gidi", "missing field (leading operator)"],
    ["!= Gidi", "missing field (leading != )"],
    ["repo =", "missing value"],
    ["", "empty clause"],
    ["   ", "whitespace-only clause"],
  ])("rejects malformed clause %p (%s)", (clause) => {
    const result = parseWhereClause(clause);
    expect(result.ok).toBe(false);
    expect(result.filter).toBeUndefined();
    expect(result.message).toBeTruthy();
  });
});

describe("OVERLAY_OP_MAP registry parity (anti fail-open lock)", () => {
  it("every mapped fn is a real filterFnTypes key whose valueType == fType", () => {
    for (const [operator, mapping] of Object.entries(OVERLAY_OP_MAP)) {
      const entry = (filterFnTypes as Record<string, { valueType: string }>)[
        mapping.fn
      ];
      expect(entry).toBeDefined();
      expect(entry.valueType).toBe(mapping.fType);
      // guard against an accidental empty operator token
      expect(operator.length).toBeGreaterThan(0);
    }
  });

  it("the operator token lists are exactly the OVERLAY_OP_MAP keys", () => {
    const declared = [
      ...WHERE_WORD_OPERATORS,
      ...WHERE_SYMBOL_OPERATORS,
    ].sort();
    expect(declared).toEqual(Object.keys(OVERLAY_OP_MAP).sort());
  });
});

describe("notidian embed block `where:` grammar", () => {
  it("parses a single where clause into descriptor.where (Filter[])", () => {
    expect(
      parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
where: repo = Gidi
`)
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
        where: [{ field: "repo", fn: "is", value: "Gidi", fType: "text" }],
      },
    });
  });

  it("conjuncts multiple where lines in declaration order (AND)", () => {
    const result = parseNotidianEmbedBlock(`
target: Ops HQ
kind: view
id: overview
where: repo = Gidi
where: status != Done
where: closed withinLast 7d
`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.descriptor.where).toEqual([
        { field: "repo", fn: "is", value: "Gidi", fType: "text" },
        { field: "status", fn: "isNot", value: "Done", fType: "text" },
        { field: "closed", fn: "withinLast", value: "7d", fType: "date" },
      ]);
    }
  });

  it("reports an error for each malformed where clause and does not parse", () => {
    const result = parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
where: repo = Gidi
where: broken clause
`);
    expect(result.ok).toBe(false);
    expect(errorsOf(result).some((e) => e.field == "where")).toBe(true);
  });

  it("treats an empty where value as malformed", () => {
    const result = parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
where:
`);
    expect(result.ok).toBe(false);
    expect(errorsOf(result).some((e) => e.field == "where")).toBe(true);
  });

  it("is byte-identical to the legacy descriptor when no where line is present", () => {
    const parsed = parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
height: 480
title: true
editable: false
`);
    expect(parsed).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        height: 480,
        title: true,
        editable: false,
      },
    });
    // Explicitly assert the `where` key is absent (not just undefined-equal).
    if (parsed.ok) {
      expect(Object.prototype.hasOwnProperty.call(parsed.descriptor, "where")).toBe(
        false
      );
    }
  });

  it("does not attach an empty where array (structural byte-identity)", () => {
    const parsed = normalizeNotidianEmbedDescriptor({
      target: "Projects",
      view: "active",
      where: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(
        Object.prototype.hasOwnProperty.call(parsed.descriptor, "where")
      ).toBe(false);
    }
  });
});
