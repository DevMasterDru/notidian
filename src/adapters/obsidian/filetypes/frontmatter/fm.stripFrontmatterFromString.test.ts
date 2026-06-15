// fm.ts statically imports `adapters/obsidian/utils/file`, which transitively
// pulls in the React/Obsidian UI component graph (and an untransformed uuid.js
// ESM module). stripFrontmatterFromString uses NONE of that — it is a pure
// String.replace. Stub the heavy boundary modules so the import graph resolves
// to plain data; the function under test stays the genuine fm.ts impl. This is
// the repo's established pattern (see fm.mergeTableData.test.ts).
jest.mock("adapters/obsidian/utils/file", () => ({
  getAllAbstractFilesInVault: (): unknown[] => [],
}));
jest.mock("core/superstate/utils/spaces", () => ({
  saveProperties: (): void => undefined,
}));
jest.mock("main", () => ({}), { virtual: true });
jest.mock(
  "obsidian",
  () => ({ App: class {}, TFile: class {} }),
  { virtual: true }
);

import { stripFrontmatterFromString } from "./fm";

// ---------------------------------------------------------------------------
// AUTHORITY (Q1) — characterization net for stripFrontmatterFromString
// (fm.ts:17, Notidian-bey). This helper strips a leading YAML frontmatter
// fence off a raw note body before the body is treated as content. Frontmatter
// is the canonical owner of editable properties (ADR 0014/0017); this function
// is the inverse-adjacent "give me the body without the property fence" view.
//
// Its regex is /---(.|\n)*---/ — GREEDY and UNANCHORED. These tests LOCK the
// current observable behaviour, including a KNOWN OVER-GREEDY HAZARD (flagged
// with a code comment at the impl), per the ADR 0025 / ADR 0033
// characterize-then-decide posture: a non-greedy/anchored fix changes what is
// removed from real notes (it is a behavior call), so it is NOT fixed blind
// here — it is pinned and a follow-up decision bead is filed.
//
// Everything here is pure / offline — no vault, no DOM, no I/O. The jest.mock
// calls above only neutralize unused IMPORT-TIME side-effects of fm.ts; the
// function and all test data stay real.
//
// IMPORTANT — characterization, not correction. Quirks (leading newline left
// behind, greedy over-strip of body content, unanchored matching) are pinned
// as PRESENT behaviour, not asserted as correct.
// ---------------------------------------------------------------------------

describe("stripFrontmatterFromString (authority characterization, Notidian-bey)", () => {
  describe("correct/expected cases — leading frontmatter fence removed", () => {
    it("strips a leading fenced frontmatter block (leaving a leading newline)", () => {
      // The match is exactly `---\ntitle: Hi\n---`; what remains is `\nBody text`.
      // QUIRK: the newline between the closing fence and the body is NOT removed.
      const doc = "---\ntitle: Hi\n---\nBody text";
      expect(stripFrontmatterFromString(doc)).toBe("\nBody text");
    });

    it("strips a multi-key frontmatter block", () => {
      const doc = "---\ntitle: Hi\ntags: [a, b]\nstatus: open\n---\nbody";
      expect(stripFrontmatterFromString(doc)).toBe("\nbody");
    });

    it("strips an empty-body frontmatter-only document down to ``", () => {
      // No newline after the closing fence -> nothing remains.
      const doc = "---\nk: v\n---";
      expect(stripFrontmatterFromString(doc)).toBe("");
    });
  });

  describe("no-frontmatter / no-match cases — string returned unchanged", () => {
    it("returns the empty string unchanged", () => {
      expect(stripFrontmatterFromString("")).toBe("");
    });

    it("leaves a plain body with no triple-dash fence untouched", () => {
      const doc = "Just body text\nwith no fence";
      expect(stripFrontmatterFromString(doc)).toBe(doc);
    });

    it("does NOT match a single `---` occurrence (needs two to bound the match)", () => {
      // Only one `---` in the doc -> the regex cannot find a closing fence.
      const doc = "before --- after";
      expect(stripFrontmatterFromString(doc)).toBe("before --- after");
    });
  });

  describe("KNOWN OVER-GREEDY HAZARD — greedy `*` spans first `---` to LAST `---`", () => {
    it("OVER-STRIPS body content when a horizontal-rule `---` follows a real fm block", () => {
      // A legitimate frontmatter block, then body prose, then a body
      // horizontal rule `---`. The greedy `*` makes the match run from the
      // FIRST fence all the way to the body rule, EATING the intervening
      // "Intro" prose. Correct behaviour would strip only the leading fence.
      const doc = "---\ntitle: Hi\n---\nIntro\n\n---\n\nAfter rule";
      // HAZARD pinned: "Intro" and the first fence both disappear.
      expect(stripFrontmatterFromString(doc)).toBe("\n\nAfter rule");
      // Document the defect explicitly: body content was lost.
      expect(stripFrontmatterFromString(doc)).not.toContain("Intro");
    });

    it("greedy match runs to the LAST `---` across multiple fenced blocks", () => {
      // Two frontmatter-like fences: everything from the first `---` to the
      // last `---` is removed, including the `mid` body between them.
      const doc = "---\na: 1\n---\nmid\n---\nb: 2\n---\nend";
      expect(stripFrontmatterFromString(doc)).toBe("\nend");
      expect(stripFrontmatterFromString(doc)).not.toContain("mid");
    });
  });

  describe("UNANCHORED — a frontmatter-like block is matched even mid-document", () => {
    it("strips a triple-dash-bounded block that is NOT at the start of the doc", () => {
      // `lead` precedes the first fence; the regex is unanchored so it still
      // matches `---\nk: v\n---` and removes it, leaving the surrounding text.
      const doc = "lead\n---\nk: v\n---\ntail";
      expect(stripFrontmatterFromString(doc)).toBe("lead\n\ntail");
    });
  });

  describe("structural properties", () => {
    it("is idempotent on already-stripped plain bodies", () => {
      const body = "no fence here";
      expect(stripFrontmatterFromString(stripFrontmatterFromString(body))).toBe(
        body
      );
    });

    it("only ever removes at most one (greedy) match per call", () => {
      // String.prototype.replace with a non-global regex replaces a single
      // (greedy) match. A third trailing `---` with no fourth stays put.
      const doc = "---\na: 1\n---\nbody\n---";
      // Greedy: first `---` to LAST `---` (the trailing one) -> only `\nbody`
      // between them is consumed; nothing after the last fence to keep here.
      expect(stripFrontmatterFromString(doc)).toBe("");
    });
  });
});
