// Contract for the sub-item link repair planner (Notidian-4xza). It must
// re-qualify ONLY bare links that are currently orphaned but uniquely match an
// in-table parent — never touch a working link, never guess on an ambiguous
// basename, never self-link.
import { planSubItemLinkRepairs } from "./subItemLinkRepair";

const row = (path: string, parent?: string) => ({
  File: path,
  ...(parent !== undefined ? { parent } : {}),
});

// A resolver that mimics Obsidian: a path-qualified link resolves to itself
// (+.md for files); a BARE basename "Atlasidian" resolves to a WRONG vault-wide
// file (the kg81 bug), everything else stays as-is.
const resolve = (link: string): string => {
  if (link === "Atlasidian") return "Portfolio/Atlasidian.md"; // collision -> wrong
  return link;
};

const plan = (rows: any[]) =>
  planSubItemLinkRepairs({ rows, parentKey: "parent", pathKey: "File", resolveLink: resolve });

describe("planSubItemLinkRepairs (Notidian-4xza)", () => {
  it("re-qualifies a bare orphaned link to the unique in-table parent", () => {
    const rows = [
      row("Sandbox/Atlasidian"),
      row("Sandbox/Child.md", "Atlasidian"), // bare -> resolves to Portfolio (wrong)
    ];
    expect(plan(rows)).toEqual([
      { childPath: "Sandbox/Child.md", newTarget: "Sandbox/Atlasidian", basename: "Atlasidian" },
    ]);
  });

  it("leaves a link that already resolves in-table untouched", () => {
    const rows = [
      row("Sandbox/Atlasidian"),
      row("Sandbox/Child.md", "Sandbox/Atlasidian"), // path-qualified -> resolves in-table
    ];
    expect(plan(rows)).toEqual([]);
  });

  it("does NOT guess when the basename matches multiple in-table rows", () => {
    const rows = [
      row("A/Atlasidian.md"),
      row("B/Atlasidian.md"),
      row("Sandbox/Child.md", "Atlasidian"), // ambiguous -> two matches
    ];
    expect(plan(rows)).toEqual([]);
  });

  it("skips a row with no parent link", () => {
    expect(plan([row("Sandbox/Atlasidian"), row("Sandbox/Loose.md")])).toEqual([]);
  });

  it("never self-links (a row whose own basename matches its bare link)", () => {
    // The only "Atlasidian" basename row is the child itself -> no other match.
    expect(plan([row("Sandbox/Atlasidian.md", "Atlasidian")])).toEqual([]);
  });

  it("repairs a file parent with the .md stripped from the target", () => {
    const resolveFileColl = (link: string) =>
      link === "Task A" ? "Elsewhere/Task A.md" : link;
    const rows = [row("Tasks/Task A.md"), row("Tasks/Sub.md", "Task A")];
    expect(
      planSubItemLinkRepairs({ rows, parentKey: "parent", pathKey: "File", resolveLink: resolveFileColl })
    ).toEqual([
      { childPath: "Tasks/Sub.md", newTarget: "Tasks/Task A", basename: "Task A" },
    ]);
  });

  it("handles a wikilink-form value (parses brackets/alias before matching)", () => {
    const rows = [row("Sandbox/Atlasidian"), row("Sandbox/Child.md", "[[Atlasidian]]")];
    expect(plan(rows)).toEqual([
      { childPath: "Sandbox/Child.md", newTarget: "Sandbox/Atlasidian", basename: "Atlasidian" },
    ]);
  });
});
