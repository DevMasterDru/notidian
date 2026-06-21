// ---------------------------------------------------------------------------
// label.ts — updatePrimaryAlias regression net (Notidian-r58c).
//
// updatePrimaryAlias is the SOLE writer of the 'aliases' frontmatter key. It is
// reached when the owner renames a title in alias mode (TitleComponent onBlur,
// both the alias-mode and post-sanitize-rename branches) and when the Path Fixer
// batch-renames badly-named files (fileSystemPathFixer). Frontmatter is canonical
// owner data (ADR 0001/0014), so a silent drop here is real, irreversible loss.
//
// THE BUG (now fixed): the helper built its new alias list as
//   serializeMultiDisplayString([value, ...ensureArray(aliases).filter(f => f == value)])
// The `f == value` predicate is INVERTED — it keeps only aliases that EQUAL
// `value`, so (a) every OTHER existing alias is DROPPED and (b) when `value` was
// already present it duplicates to [value, value]. The Path Fixer loop made it
// batch-destructive (one wipe per touched file). The fix inverts the predicate
// to `f != value`: prepend `value` as the primary, keep all other aliases in
// order, never duplicate.
//
// STRATEGY: stub only the I/O seam (`./spaces` -> saveProperties) so we can
// capture exactly what gets written, while exercising the REAL transform stack
// (ensureArray + serializeMultiDisplayString + parseMDBStringValue). The captured
// value is the same array the vault adapter receives, so these assertions pin the
// end-to-end frontmatter write, including the comma escape/un-escape round-trip.
// ---------------------------------------------------------------------------

// Mock the data-authority write seam. The factory must be self-contained
// (jest.mock is hoisted above imports), so we expose the spy and reach it after.
jest.mock("./spaces", () => ({
  saveProperties: jest.fn(),
}));

import { updatePrimaryAlias } from "./label";
import { saveProperties } from "./spaces";

const saveMock = saveProperties as jest.MockedFunction<typeof saveProperties>;

const FM_KEY = "aliases";

// Minimal Superstate stub: updatePrimaryAlias only reads settings.fmKeyAlias and
// hands `path` straight to saveProperties (which we mock). Everything else is
// pure and untouched.
const makeSuperstate = (fmKeyAlias = FM_KEY) =>
  ({ settings: { fmKeyAlias } } as any);

// The value updatePrimaryAlias writes is
//   parseMDBStringValue("option-multi", serializeMultiDisplayString([...]), true)
// which is the parsed-back array. Capture it from the single saveProperties call.
const writtenAliases = (): unknown => {
  expect(saveMock).toHaveBeenCalledTimes(1);
  const [, , properties] = saveMock.mock.calls[0];
  return (properties as Record<string, unknown>)[FM_KEY];
};

beforeEach(() => {
  saveMock.mockReset();
});

describe("updatePrimaryAlias", () => {
  it("writes to the configured fmKeyAlias on the given path", () => {
    const superstate = makeSuperstate("my_aliases");
    updatePrimaryAlias(superstate, "Notes/Foo.md", ["old"], "New Title");

    expect(saveMock).toHaveBeenCalledTimes(1);
    const [passedSuperstate, passedPath, properties] = saveMock.mock.calls[0];
    expect(passedSuperstate).toBe(superstate);
    expect(passedPath).toBe("Notes/Foo.md");
    expect(properties).toEqual({ my_aliases: ["New Title", "old"] });
  });

  it("sets value as the PRIMARY (index-0) alias", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", ["a", "b", "c"], "Primary");
    const out = writtenAliases() as string[];
    expect(out[0]).toBe("Primary");
  });

  // THE FIX — the core regression. Pre-fix this dropped a/b/c entirely.
  it("PRESERVES every other existing alias, in order, after the new primary", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", ["a", "b", "c"], "Primary");
    expect(writtenAliases()).toEqual(["Primary", "a", "b", "c"]);
  });

  it("preserves ordering of the surviving aliases exactly", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", ["zeta", "alpha", "mu"], "head");
    expect(writtenAliases()).toEqual(["head", "zeta", "alpha", "mu"]);
  });

  // THE FIX — the duplication half. Pre-fix value-already-present -> [value, value].
  it("does NOT duplicate value when it is already present (de-dup to a single primary)", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", ["Primary", "other"], "Primary");
    expect(writtenAliases()).toEqual(["Primary", "other"]);
  });

  it("does not duplicate even when value is present mid-list (moves it to head once)", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", ["a", "Primary", "b"], "Primary");
    expect(writtenAliases()).toEqual(["Primary", "a", "b"]);
  });

  it("removes EVERY duplicate of value, not just the first", () => {
    updatePrimaryAlias(
      makeSuperstate(),
      "p.md",
      ["Primary", "x", "Primary", "y", "Primary"],
      "Primary"
    );
    expect(writtenAliases()).toEqual(["Primary", "x", "y"]);
  });

  it("empty aliases array -> [value]", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", [], "Solo");
    expect(writtenAliases()).toEqual(["Solo"]);
  });

  it("undefined aliases -> [value] (ensureArray guard, real call-site shape)", () => {
    // TitleComponent / Path Fixer pass metadata?.property?.aliases, which is
    // undefined when the file has no aliases yet.
    updatePrimaryAlias(makeSuperstate(), "p.md", undefined as unknown as string[], "Solo");
    expect(writtenAliases()).toEqual(["Solo"]);
  });

  it("null aliases -> [value] (ensureArray guard)", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", null as unknown as string[], "Solo");
    expect(writtenAliases()).toEqual(["Solo"]);
  });

  it("a single string alias (non-array) -> [value, thatAlias] (ensureArray wraps)", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", "lone" as unknown as string[], "head");
    expect(writtenAliases()).toEqual(["head", "lone"]);
  });

  // Comma-bearing aliases must survive the serialize/parse round-trip (ADR 0030).
  it("comma-bearing OTHER aliases round-trip losslessly through serialize+parse", () => {
    updatePrimaryAlias(
      makeSuperstate(),
      "p.md",
      ["alias, with, commas", "plain"],
      "Primary"
    );
    expect(writtenAliases()).toEqual([
      "Primary",
      "alias, with, commas",
      "plain",
    ]);
  });

  it("a comma-bearing value as the new primary round-trips losslessly", () => {
    updatePrimaryAlias(makeSuperstate(), "p.md", ["other"], "Last, First");
    expect(writtenAliases()).toEqual(["Last, First", "other"]);
  });

  it("de-dups a comma-bearing value already present (no duplicate primary)", () => {
    updatePrimaryAlias(
      makeSuperstate(),
      "p.md",
      ["Last, First", "other"],
      "Last, First"
    );
    expect(writtenAliases()).toEqual(["Last, First", "other"]);
  });

  // Path Fixer batch scenario: calling repeatedly over files must be idempotent
  // on a file that already has the primary — it must NOT erode the alias list.
  it("is idempotent: re-applying the same primary preserves the full list (Path Fixer loop safety)", () => {
    const superstate = makeSuperstate();

    updatePrimaryAlias(superstate, "p.md", ["a", "b"], "Primary");
    const first = writtenAliases() as string[];
    expect(first).toEqual(["Primary", "a", "b"]);

    // Feed the first result back in (what a second pass over the same file sees).
    saveMock.mockReset();
    updatePrimaryAlias(superstate, "p.md", first, "Primary");
    expect(writtenAliases()).toEqual(["Primary", "a", "b"]);
  });
});
