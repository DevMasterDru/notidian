import { authorComment } from "./commentAuthoring";

describe("authorComment", () => {
  it("awaits durable anchor persistence before starting the frontmatter write", async () => {
    const events: string[] = [];
    let releaseAnchor: ((saved: boolean) => void) | undefined;
    const anchorSaved = new Promise<boolean>((resolve) => {
      releaseAnchor = resolve;
    });

    const pending = authorComment({
      document: "Selected paragraph",
      from: 0,
      to: "Selected".length,
      body: "Please clarify this.",
      frontmatter: {},
      generateBlockId: () => "c-anchor",
      generateCommentId: () => "cmt-comment1",
      now: () => new Date("2026-07-15T10:00:00.000Z"),
      applyAnchorChange: async () => {
        events.push("anchor-start");
        const saved = await anchorSaved;
        events.push("anchor-saved");
        return saved;
      },
      saveProperties: async () => {
        events.push("frontmatter");
        return { ok: true };
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["anchor-start"]);

    releaseAnchor?.(true);
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(events).toEqual(["anchor-start", "anchor-saved", "frontmatter"]);
  });

  it("applies the body anchor before persisting the general comment entry", async () => {
    const events: string[] = [];
    const saved: Record<string, unknown>[] = [];

    const result = await authorComment({
      document: "Selected paragraph",
      from: 0,
      to: "Selected".length,
      body: "Please clarify this.",
      frontmatter: { title: "Note" },
      generateBlockId: () => "c-anchor",
      generateCommentId: () => "cmt-comment1",
      now: () => new Date("2026-07-15T10:00:00.000Z"),
      applyAnchorChange: (change) => {
        events.push("anchor");
        expect(change).toEqual({
          from: "Selected paragraph".length,
          to: "Selected paragraph".length,
          insert: " ^c-anchor",
        });
        return true;
      },
      saveProperties: async (properties) => {
        events.push("frontmatter");
        saved.push(properties);
        return { ok: true };
      },
    });

    expect(events).toEqual(["anchor", "frontmatter"]);
    expect(saved).toEqual([
      {
        comments_version: 1,
        comments: [
          {
            id: "cmt-comment1",
            anchor: "^c-anchor",
            quote: "Selected",
            body: "Please clarify this.",
            by: "human",
            ts: "2026-07-15T10:00:00.000Z",
            status: "open",
          },
        ],
      },
    ]);
    expect(result).toMatchObject({ ok: true, destination: "general" });
  });

  it("does not persist frontmatter when the editor rejects the anchor change", async () => {
    let saveCalls = 0;

    const result = await authorComment({
      document: "Selected paragraph",
      from: 0,
      to: "Selected".length,
      body: "Comment",
      frontmatter: {},
      generateBlockId: () => "c-anchor",
      generateCommentId: () => "cmt-comment1",
      now: () => new Date("2026-07-15T10:00:00.000Z"),
      applyAnchorChange: () => false,
      saveProperties: async () => {
        saveCalls += 1;
        return { ok: true };
      },
    });

    expect(result).toEqual({ ok: false, code: "ANCHOR_WRITE_FAILED" });
    expect(saveCalls).toBe(0);
  });

  it("reports a frontmatter failure after leaving only the harmless block id", async () => {
    let anchorCalls = 0;
    const writeError = new Error("save failed");

    const result = await authorComment({
      document: "Selected paragraph",
      from: 0,
      to: "Selected".length,
      body: "Comment",
      frontmatter: {},
      generateBlockId: () => "c-anchor",
      generateCommentId: () => "cmt-comment1",
      now: () => new Date("2026-07-15T10:00:00.000Z"),
      applyAnchorChange: () => {
        anchorCalls += 1;
        return true;
      },
      saveProperties: async () => ({ ok: false, error: writeError }),
    });

    expect(anchorCalls).toBe(1);
    expect(result).toEqual({
      ok: false,
      code: "FRONTMATTER_WRITE_FAILED",
      error: writeError,
    });
  });

  it("persists review-page comments only under the AI-directed review channel", async () => {
    let saved: Record<string, unknown> | undefined;

    const result = await authorComment({
      document: "Selected paragraph ^existing",
      from: 0,
      to: "Selected".length,
      body: "AI review feedback",
      frontmatter: {
        type: "review",
        review: { verdicts: [{ id: "decision-1" }] },
      },
      generateBlockId: () => "unused",
      generateCommentId: () => "cmt-review1",
      now: () => new Date("2026-07-15T10:00:00.000Z"),
      applyAnchorChange: () => {
        throw new Error("existing anchor should not be rewritten");
      },
      saveProperties: async (properties) => {
        saved = properties;
        return { ok: true };
      },
    });

    expect(result).toMatchObject({ ok: true, destination: "review" });
    expect(saved).toMatchObject({
      review: {
        verdicts: [{ id: "decision-1" }],
        comments_version: 1,
        comments: [
          {
            id: "cmt-review1",
            anchor: "^existing",
            body: "AI review feedback",
          },
        ],
      },
    });
    expect(saved).not.toHaveProperty("comments");
  });

  it("rejects invalid comment data before changing the editor or frontmatter", async () => {
    let sideEffects = 0;

    const result = await authorComment({
      document: "Selected paragraph",
      from: 0,
      to: "Selected".length,
      body: "   ",
      frontmatter: {},
      generateBlockId: () => "c-anchor",
      generateCommentId: () => "cmt-comment1",
      now: () => new Date("2026-07-15T10:00:00.000Z"),
      applyAnchorChange: () => {
        sideEffects += 1;
        return true;
      },
      saveProperties: async () => {
        sideEffects += 1;
        return { ok: true };
      },
    });

    expect(result).toMatchObject({ ok: false, code: "INVALID_BODY" });
    expect(sideEffects).toBe(0);
  });
});
