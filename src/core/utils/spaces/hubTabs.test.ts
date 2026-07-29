// ADR 0065 (Atlas ADR-0096 H1, bd Notidian-pb7p.1) — hub `tabs:` declaration
// grammar. Classification keeps unrelated user `tabs:` frontmatter from ever
// entering the strict path; declaration attempts validate fail-closed in the
// ADR 0062 posture (unknown keys, duplicate ids, malformed entries all error).
import {
  hubTabLabel,
  hubTabPageCandidates,
  parseHubTabsDeclaration,
  resolveActiveHubTab,
} from "./hubTabs";

describe("parseHubTabsDeclaration — classification", () => {
  it("treats absent, scalar, empty, and string-list values as no declaration", () => {
    expect(parseHubTabsDeclaration(undefined).kind).toBe("none");
    expect(parseHubTabsDeclaration(null).kind).toBe("none");
    expect(parseHubTabsDeclaration("").kind).toBe("none");
    expect(parseHubTabsDeclaration("overview").kind).toBe("none");
    expect(parseHubTabsDeclaration(7).kind).toBe("none");
    expect(parseHubTabsDeclaration([]).kind).toBe("none");
    expect(parseHubTabsDeclaration(["Next", "State"]).kind).toBe("none");
    expect(parseHubTabsDeclaration({ id: "next" }).kind).toBe("none");
  });

  it("treats a non-empty array containing a mapping as a declaration attempt", () => {
    expect(
      parseHubTabsDeclaration([{ id: "next", page: "Tabs/Next.md" }]).kind
    ).toBe("ok");
    // Mixed entries are a malformed ATTEMPT (strict), not user data.
    expect(
      parseHubTabsDeclaration([{ id: "next", page: "Tabs/Next.md" }, "State"])
        .kind
    ).toBe("error");
  });
});

describe("parseHubTabsDeclaration — valid declarations", () => {
  it("parses ordered tabs with required id/page and optional name", () => {
    const result = parseHubTabsDeclaration([
      { id: "next", page: "Tabs/Next.md" },
      { id: "state", page: "Tabs/State.md", name: "Current State" },
    ]);
    expect(result).toEqual({
      kind: "ok",
      tabs: [
        { id: "next", page: "Tabs/Next.md" },
        { id: "state", page: "Tabs/State.md", name: "Current State" },
      ],
    });
  });

  it("trims field whitespace and preserves declaration order", () => {
    const result = parseHubTabsDeclaration([
      { id: " ready ", page: " Tabs/Ready.md " },
      { id: "done", page: "Tabs/Done.md" },
    ]);
    expect(result.kind).toBe("ok");
    expect(result.tabs.map((t) => t.id)).toEqual(["ready", "done"]);
    expect(result.tabs[0].page).toBe("Tabs/Ready.md");
  });
});

describe("parseHubTabsDeclaration — fail-closed validation", () => {
  it("errors on a missing or non-string id", () => {
    expect(
      parseHubTabsDeclaration([{ page: "Tabs/Next.md" }]).kind
    ).toBe("error");
    expect(
      parseHubTabsDeclaration([{ id: 3, page: "Tabs/Next.md" }]).kind
    ).toBe("error");
  });

  it("errors on a non-slug id", () => {
    for (const id of ["Next", "with space", "nope!", "a/b", ""]) {
      const result = parseHubTabsDeclaration([{ id, page: "Tabs/Next.md" }]);
      expect(result.kind).toBe("error");
    }
  });

  it("errors on a missing, non-string, or empty page", () => {
    expect(parseHubTabsDeclaration([{ id: "next" }]).kind).toBe("error");
    expect(parseHubTabsDeclaration([{ id: "next", page: 4 }]).kind).toBe(
      "error"
    );
    expect(parseHubTabsDeclaration([{ id: "next", page: "  " }]).kind).toBe(
      "error"
    );
  });

  it("errors on duplicate ids", () => {
    const result = parseHubTabsDeclaration([
      { id: "next", page: "A.md" },
      { id: "next", page: "B.md" },
    ]);
    expect(result.kind).toBe("error");
    expect(result.errors.join(" ")).toContain("next");
  });

  it("errors on unknown entry keys", () => {
    const result = parseHubTabsDeclaration([
      { id: "next", page: "A.md", icon: "ui//star" },
    ]);
    expect(result.kind).toBe("error");
    expect(result.errors.join(" ")).toContain("icon");
  });

  it("errors on a non-string name", () => {
    expect(
      parseHubTabsDeclaration([{ id: "next", page: "A.md", name: 5 }]).kind
    ).toBe("error");
  });

  it("collects every violation rather than stopping at the first", () => {
    const result = parseHubTabsDeclaration([
      { id: "NEXT", page: "A.md" },
      { id: "state" },
    ]);
    expect(result.kind).toBe("error");
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("resolveActiveHubTab", () => {
  const tabs = [
    { id: "next", page: "A.md" },
    { id: "state", page: "B.md" },
  ];

  it("returns the persisted id when it is still declared", () => {
    expect(resolveActiveHubTab(tabs, "state")).toBe("state");
  });

  it("falls back to the first tab when the persisted id is gone or invalid", () => {
    expect(resolveActiveHubTab(tabs, "retired")).toBe("next");
    expect(resolveActiveHubTab(tabs, undefined)).toBe("next");
    expect(resolveActiveHubTab(tabs, 42)).toBe("next");
  });

  it("returns null for an empty tab set", () => {
    expect(resolveActiveHubTab([], "next")).toBeNull();
  });
});

describe("hubTabLabel", () => {
  it("prefers the declared name", () => {
    expect(
      hubTabLabel({ id: "next", page: "Tabs/Next.md", name: "Up Next" })
    ).toBe("Up Next");
  });

  it("falls back to the page basename without extension", () => {
    expect(hubTabLabel({ id: "next", page: "Tabs/My Tab.md" })).toBe("My Tab");
    expect(hubTabLabel({ id: "next", page: "Deep/Nested/State.md" })).toBe(
      "State"
    );
  });

  it("falls back to the id when the page has no usable basename", () => {
    expect(hubTabLabel({ id: "next", page: ".md" })).toBe("next");
  });
});

describe("hubTabPageCandidates", () => {
  it("resolves space-relative first, then vault-absolute", () => {
    expect(hubTabPageCandidates("Tabs/Next.md", "Life HQ")).toEqual([
      "Life HQ/Tabs/Next.md",
      "Tabs/Next.md",
    ]);
  });

  it("strips a leading ./ and deduplicates for a root space", () => {
    expect(hubTabPageCandidates("./Next.md", "Life HQ")).toEqual([
      "Life HQ/Next.md",
      "Next.md",
    ]);
    expect(hubTabPageCandidates("Next.md", "")).toEqual(["Next.md"]);
  });
});
