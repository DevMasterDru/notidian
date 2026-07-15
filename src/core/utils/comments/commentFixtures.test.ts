import { readFileSync } from "fs";
import { join } from "path";

describe("CommentV1 shared fixtures", () => {
  it("ships the complete ADR 0019 v1 producer-consumer matrix", () => {
    const fixtureDir = join(__dirname, "__fixtures__");
    const manifest = JSON.parse(
      readFileSync(join(fixtureDir, "manifest.json"), "utf8")
    ) as { version: number; fixtures: Array<{ file: string; outcome: string }> };

    expect(manifest.version).toBe(1);
    expect(manifest.fixtures).toEqual([
      { file: "general-attached.md", outcome: "ignore-for-ai" },
      { file: "review-attached.md", outcome: "attached" },
      { file: "review-changed.md", outcome: "QUOTE_CHANGED" },
      { file: "review-anchor-missing.md", outcome: "ANCHOR_NOT_FOUND" },
      {
        file: "review-anchor-ambiguous.md",
        outcome: "ANCHOR_AMBIGUOUS",
      },
      { file: "review-malformed-sibling.md", outcome: "one-valid-one-invalid" },
      {
        file: "review-missing-version.md",
        outcome: "MISSING_COMMENTS_VERSION",
      },
      {
        file: "review-unsupported-version.md",
        outcome: "UNSUPPORTED_COMMENTS_VERSION",
      },
      {
        file: "review-comments-not-array.md",
        outcome: "COMMENTS_NOT_ARRAY",
      },
    ]);

    for (const fixture of manifest.fixtures) {
      const bytes = readFileSync(join(fixtureDir, fixture.file), "utf8");
      expect(bytes).toContain("comments");
      expect(bytes).toContain("---");
    }
  });
});
