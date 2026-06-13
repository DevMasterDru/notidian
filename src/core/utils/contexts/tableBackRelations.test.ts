import { filterBackRelations } from "core/utils/contexts/tableBackRelations";

describe("filterBackRelations", () => {
  it("keeps candidates whose relation property links to the target", () => {
    const result = filterBackRelations({
      targetPath: "Projects/Alpha.md",
      candidates: [
        { path: "Tasks/1.md", relationValue: "[[Projects/Alpha]]" },
        { path: "Tasks/2.md", relationValue: "[[Projects/Beta]]" },
        { path: "Tasks/3.md", relationValue: "[[Projects/Alpha]]" },
      ],
      resolveLink: (link) => `${link}.md`,
    });
    expect(result).toEqual(["Tasks/1.md", "Tasks/3.md"]);
  });

  it("excludes a candidate that links elsewhere (incidental inlink)", () => {
    const result = filterBackRelations({
      targetPath: "A.md",
      candidates: [{ path: "B.md", relationValue: "[[C]]" }],
      resolveLink: (link) => `${link}.md`,
    });
    expect(result).toEqual([]);
  });

  it("ignores a self-link", () => {
    const result = filterBackRelations({
      targetPath: "A.md",
      candidates: [{ path: "A.md", relationValue: "[[A]]" }],
      resolveLink: (link) => `${link}.md`,
    });
    expect(result).toEqual([]);
  });

  it("matches when the relation property holds multiple links", () => {
    const result = filterBackRelations({
      targetPath: "A.md",
      candidates: [{ path: "B.md", relationValue: "[[X]], [[A]]" }],
      resolveLink: (link) => `${link}.md`,
    });
    expect(result).toEqual(["B.md"]);
  });

  it("dedupes a candidate that appears twice", () => {
    const result = filterBackRelations({
      targetPath: "A.md",
      candidates: [
        { path: "B.md", relationValue: "[[A]]" },
        { path: "B.md", relationValue: "[[A]]" },
      ],
      resolveLink: (link) => `${link}.md`,
    });
    expect(result).toEqual(["B.md"]);
  });

  it("skips candidates with an empty/absent relation value", () => {
    const result = filterBackRelations({
      targetPath: "A.md",
      candidates: [
        { path: "B.md", relationValue: "" },
        { path: "C.md", relationValue: null },
        { path: "D.md", relationValue: "[[A]]" },
      ],
      resolveLink: (link) => `${link}.md`,
    });
    expect(result).toEqual(["D.md"]);
  });

  it("uses identity resolution when no resolver is given (pre-resolved paths)", () => {
    const result = filterBackRelations({
      targetPath: "A.md",
      candidates: [{ path: "B.md", relationValue: "A.md" }],
    });
    expect(result).toEqual(["B.md"]);
  });
});
