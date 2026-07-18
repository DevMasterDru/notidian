import {
  NavigatorContentIndex,
  NavigatorContentWorkerRuntime,
  normalizeNavigatorContentText,
} from "./impl";

describe("NavigatorContentIndex", () => {
  it("normalizes Unicode NFKC and case for contiguous body matches", () => {
    const index = new NavigatorContentIndex();
    index.upsert([
      { path: "Alpha.md", body: "---\ntitle: Secret\n---\nThe ＱＵＩＣＫ Brown Fox" },
      { path: "Beta.md", body: "A quick detour before the brown fox" },
    ]);

    expect(normalizeNavigatorContentText("ＦＯＯ")).toBe("foo");
    expect(index.search("quick brown")).toEqual(["Alpha.md"]);
    expect(index.search("QUICK BROWN")).toEqual(["Alpha.md"]);
  });

  it("does not match text that appears only in frontmatter", () => {
    const index = new NavigatorContentIndex();
    index.upsert([
      { path: "Frontmatter.md", body: "---\nsummary: private-token\n---\nVisible body" },
    ]);

    expect(index.search("private-token")).toEqual([]);
    expect(index.search("visible body")).toEqual(["Frontmatter.md"]);
  });

  it("replaces, removes, renames, and reconciles without stale matches", () => {
    const index = new NavigatorContentIndex();
    index.upsert([
      { path: "One.md", body: "first token" },
      { path: "Two.md", body: "shared token" },
    ]);

    index.upsert([{ path: "One.md", body: "replacement token" }]);
    expect(index.search("first token")).toEqual([]);
    expect(index.search("replacement token")).toEqual(["One.md"]);

    index.remove(["One.md"]);
    index.upsert([{ path: "Renamed.md", body: "replacement token" }]);
    expect(index.search("replacement token")).toEqual(["Renamed.md"]);

    index.reconcile(new Set(["Two.md"]));
    expect(index.search("replacement token")).toEqual([]);
    expect(index.paths()).toEqual(["Two.md"]);
  });

  it("returns every match in stable corpus order", () => {
    const index = new NavigatorContentIndex();
    index.upsert(
      Array.from({ length: 25 }, (_, index) => ({
        path: `${String(index).padStart(2, "0")}.md`,
        body: `common body token ${index}`,
      }))
    );

    expect(index.search("common body token")).toEqual(
      Array.from({ length: 25 }, (_, index) =>
        `${String(index).padStart(2, "0")}.md`
      )
    );
  });
});

describe("NavigatorContentWorkerRuntime", () => {
  it("echoes generations and revisions across mutations and queries", () => {
    const runtime = new NavigatorContentWorkerRuntime();

    expect(runtime.handle({ type: "reset", generation: 1 })).toEqual({
      type: "mutation",
      generation: 1,
      revision: 1,
    });
    expect(
      runtime.handle({
        type: "upsert",
        generation: 2,
        documents: [{ path: "Body.md", body: "body-only needle" }],
      })
    ).toEqual({ type: "mutation", generation: 2, revision: 2 });

    expect(
      runtime.handle({
        type: "query",
        requestId: 9,
        query: "NEEDLE",
        revision: 2,
      })
    ).toEqual({
      type: "result",
      requestId: 9,
      query: "needle",
      requestedRevision: 2,
      revision: 2,
      paths: ["Body.md"],
    });
  });

  it("disposes its corpus", () => {
    const runtime = new NavigatorContentWorkerRuntime();
    runtime.handle({
      type: "upsert",
      generation: 1,
      documents: [{ path: "Body.md", body: "needle" }],
    });

    expect(runtime.handle({ type: "dispose" })).toEqual({ type: "disposed" });
    expect(
      runtime.handle({
        type: "query",
        requestId: 1,
        query: "needle",
        revision: 2,
      })
    ).toEqual({
      type: "result",
      requestId: 1,
      query: "needle",
      requestedRevision: 2,
      revision: 2,
      paths: [],
    });
  });
});
