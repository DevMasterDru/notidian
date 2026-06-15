import { SpaceManager } from "core/spaceManager/spaceManager";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceProperty } from "shared/types/mdb";
import { parseLinkString, parseMultiString } from "utils/parsers";
import { serializeMultiString } from "utils/serializers";
import {
  removeLinkInValue,
  removeLinksInRow,
  renameLinksInRow,
  replaceLinkInValue,
  valueContainsLink,
} from "./links";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — adversarial + property tests for the authority-gated link
// rewrite helpers in src/core/utils/contexts/links.ts (Notidian-a3g).
//
// links.ts had ZERO direct tests yet encodes BOTH:
//   (A) the P0 link-corruption / authority-bypass bug (Notidian-5tl / 97l):
//       a link rename/remove must touch ONLY the targeted parseLinkString
//       identity inside a multi-string value and preserve every other entry
//       (a naive substring replace corrupted unrelated links), AND
//   (B) the authority-partition invariant (ADR 0001/0017): saveProperties may
//       write the Markdown file's frontmatter ONLY for frontmatter-backed
//       columns; Notidian-owned (context / source:"notidian" link) columns
//       must update the returned row delta only — never the file.
//
// Pure / offline: the SpaceManager is a hand-rolled spy; no vault, no I/O.
// ---------------------------------------------------------------------------

// --- spy SpaceManager -------------------------------------------------------
type SaveCall = { path: string; payload: Record<string, any> };

const makeSpyManager = () => {
  const calls: SaveCall[] = [];
  const manager = {
    saveProperties: (path: string, payload: Record<string, any>) => {
      calls.push({ path, payload });
      return Promise.resolve();
    },
  } as unknown as SpaceManager;
  return { manager, calls };
};

// --- column factories -------------------------------------------------------
// A frontmatter-backed link column (no source marker => storable link type =>
// resolves to "frontmatter" authority => MAY write the file).
const fmLinkCol = (name: string): SpaceProperty =>
  ({ name, type: "link", schemaId: "files" } as SpaceProperty);

// NOTE: "link-multi" is NOT in propertyAuthority.frontmatterStorableTypes
// (only the singular "link" is), so a SOURCE-LESS link-multi column resolves to
// Notidian authority and would NOT write the file. To represent a genuinely
// frontmatter-backed multi-link column we mark it source:"frontmatter"
// explicitly (the visible, portable layer). The source-less link-multi case is
// covered separately below as a Notidian-owned column.
const fmLinkMultiCol = (name: string): SpaceProperty =>
  ({
    name,
    type: "link-multi",
    source: "frontmatter",
    schemaId: "files",
  } as SpaceProperty);

// A source-less link-multi column: ambiguous authority resolves to Notidian
// (no frontmatter form for the -multi link type), so it MUST NOT write the file.
const sourcelessLinkMultiCol = (name: string): SpaceProperty =>
  ({ name, type: "link-multi", schemaId: "files" } as SpaceProperty);

// A Notidian-owned link column (explicit source:"notidian" => never writes the
// file even though the type is link).
const notidianLinkCol = (name: string): SpaceProperty =>
  ({ name, type: "link", source: "notidian", schemaId: "files" } as SpaceProperty);

// A context-only column (no frontmatter representation => Notidian-owned even
// without a source marker).
const contextCol = (name: string): SpaceProperty =>
  ({ name, type: "context", value: '{"space":"X"}', schemaId: "files" } as SpaceProperty);

// --- value-shape helpers ----------------------------------------------------
// The durable multi-string row value is a JSON array (what serializeMultiString
// produces and what the context table stores). Critically, a wikilink token
// "[[Foo]]" starts with "[", so a *bare* "[[Foo]]" string would be misparsed by
// parseMultiString as JSON; multi-link values MUST therefore be serialized
// arrays. We build them through serializeMultiString to mirror real storage.
const multi = (...entries: string[]) => serializeMultiString(entries);

// ===========================================================================
// (1) PROPERTY: replace/removeLinkInValue touch ONLY the targeted identity
// ===========================================================================

describe("parseLinkString identity (the matching contract)", () => {
  it("strips wikilink + alias to bare identity, leaves bare paths intact", () => {
    expect(parseLinkString("[[Old.md]]")).toBe("Old.md");
    expect(parseLinkString("[[Old.md|Alias]]")).toBe("Old.md");
    expect(parseLinkString("[[Old]]")).toBe("Old");
    expect(parseLinkString("Old.md")).toBe("Old.md");
    // substring-distinct identities must NOT collapse together
    expect(parseLinkString("[[Foo]]")).not.toBe(parseLinkString("[[Foobar]]"));
  });
});

describe("replaceLinkInValue / removeLinkInValue — identity-scoped, value-preserving", () => {
  // The matrix of multi-string values to exercise. Each entry is a distinct
  // parseLinkString identity; bare and wikilink forms are intentionally mixed.
  const corpus: string[][] = [
    ["[[Alpha.md]]", "[[Beta.md]]", "[[Gamma.md]]"],
    ["Alpha.md", "Beta.md", "Gamma.md"],
    ["[[Alpha.md|A]]", "Beta.md", "[[Gamma.md|G]]"],
    ["[[Foo]]", "[[Foobar]]", "[[Foobaz]]"], // substring collisions
    ["[[Note (1).md]]", "[[Note (2).md]]"], // parens in path
    ["[[A]]"],
    [],
  ];

  // The target identity we will rename/remove, plus its representation forms.
  const targetForms = ["[[Alpha.md]]", "[[Alpha.md|A]]", "Alpha.md", "[[Foo]]"];

  for (const entries of corpus) {
    for (const targetForm of targetForms) {
      const targetIdentity = parseLinkString(targetForm);
      const value = multi(...entries);
      const present = entries.some((e) => parseLinkString(e) === targetIdentity);

      it(`renames only "${targetIdentity}" in [${entries.join(", ")}]`, () => {
        const newLink = "Renamed.md";
        const out = replaceLinkInValue(targetIdentity, newLink, value);
        const outArr = parseMultiString(out);
        const inArr = parseMultiString(value);

        expect(outArr.length).toBe(inArr.length); // arity preserved
        for (let i = 0; i < inArr.length; i++) {
          if (parseLinkString(inArr[i]) === targetIdentity) {
            // matched slot -> exactly the new link, nothing else
            expect(outArr[i]).toBe(newLink);
          } else {
            // every non-matching entry is byte-for-byte preserved
            expect(outArr[i]).toBe(inArr[i]);
          }
        }
      });

      it(`removes only "${targetIdentity}" in [${entries.join(", ")}]`, () => {
        const out = removeLinkInValue(targetIdentity, value);
        const outArr = parseMultiString(out);
        const inArr = parseMultiString(value);
        const expected = inArr.filter(
          (e) => parseLinkString(e) !== targetIdentity
        );
        expect(outArr).toEqual(expected);
        // no non-matching entry was lost
        for (const e of inArr) {
          if (parseLinkString(e) !== targetIdentity) {
            expect(outArr).toContain(e);
          }
        }
      });

      it(`no-match is identity for "${targetIdentity}" in [${entries.join(", ")}]`, () => {
        if (present) return; // only assert when the target is absent
        expect(replaceLinkInValue(targetIdentity, "Renamed.md", value)).toBe(
          serializeMultiString(parseMultiString(value))
        );
        expect(removeLinkInValue(targetIdentity, value)).toBe(
          serializeMultiString(parseMultiString(value))
        );
      });
    }
  }

  it("rename is idempotent under the NEW identity (re-applying old target is a no-op)", () => {
    const value = multi("[[Alpha.md]]", "[[Beta.md]]");
    const once = replaceLinkInValue("Alpha.md", "[[Renamed.md]]", value);
    // Re-running the SAME old->new rename no longer finds the old identity.
    const twice = replaceLinkInValue("Alpha.md", "[[Renamed.md]]", once);
    expect(twice).toBe(once);
  });

  it("remove is idempotent (removing again is a no-op)", () => {
    const value = multi("[[Alpha.md]]", "[[Beta.md]]");
    const once = removeLinkInValue("Alpha.md", value);
    const twice = removeLinkInValue("Alpha.md", once);
    expect(twice).toBe(once);
  });
});

// ===========================================================================
// (1b) ADVERSARIAL value-level edge cases
// ===========================================================================

describe("adversarial value cases", () => {
  it("substring collision: removing [[Foo]] keeps [[Foobar]] and [[Foobaz]]", () => {
    const value = multi("[[Foo]]", "[[Foobar]]", "[[Foobaz]]");
    const out = parseMultiString(removeLinkInValue("Foo", value));
    expect(out).toEqual(["[[Foobar]]", "[[Foobaz]]"]);
  });

  it("substring collision: renaming Foo does not touch Foobar / Foobaz", () => {
    const value = multi("[[Foo]]", "[[Foobar]]", "[[Foobaz]]");
    const out = parseMultiString(replaceLinkInValue("Foo", "[[Zap]]", value));
    expect(out).toEqual(["[[Zap]]", "[[Foobar]]", "[[Foobaz]]"]);
  });

  it("duplicates: removing an identity removes ALL of its occurrences", () => {
    const value = multi("[[Dup.md]]", "[[Keep.md]]", "[[Dup.md|alias]]");
    // both "[[Dup.md]]" and "[[Dup.md|alias]]" share identity "Dup.md"
    const out = parseMultiString(removeLinkInValue("Dup.md", value));
    expect(out).toEqual(["[[Keep.md]]"]);
  });

  it("duplicates: renaming an identity rewrites EVERY occurrence", () => {
    const value = multi("[[Dup.md]]", "[[Keep.md]]", "[[Dup.md|alias]]");
    const out = parseMultiString(replaceLinkInValue("Dup.md", "[[New.md]]", value));
    expect(out).toEqual(["[[New.md]]", "[[Keep.md]]", "[[New.md]]"]);
  });

  it("empty value: no match, returns empty serialization", () => {
    expect(removeLinkInValue("Anything", "")).toBe(serializeMultiString([]));
    expect(replaceLinkInValue("Anything", "X", "")).toBe(serializeMultiString([]));
    expect(valueContainsLink("Anything", "")).toBe(false);
  });

  it("whitespace entries are trimmed by parseMultiString and not falsely matched", () => {
    // comma form: parseMultiDisplayString trims each entry
    const value = "Alpha.md ,  Beta.md ";
    expect(valueContainsLink("Alpha.md", value)).toBe(true);
    expect(valueContainsLink("Beta.md", value)).toBe(true);
    expect(valueContainsLink(" Alpha.md ", value)).toBe(false); // padded != trimmed identity
    const out = parseMultiString(removeLinkInValue("Alpha.md", value));
    expect(out).toEqual(["Beta.md"]);
  });
});

// ===========================================================================
// (2) AUTHORITY MATRIX — removeLinksInRow / renameLinksInRow
// ===========================================================================

describe("AUTHORITY MATRIX: removeLinksInRow / renameLinksInRow", () => {
  const PATH = "Folder/Row.md";

  // A row with the SAME link present in four column kinds + one non-matching
  // frontmatter column. saveProperties must fire for frontmatter columns ONLY.
  const buildRow = (): DBRow => ({
    [PathPropertyName]: PATH,
    fmLink: multi("[[Target.md]]", "[[Other.md]]"),
    fmLinkMulti: multi("[[Target.md]]", "[[Keep.md]]"),
    notidianLink: multi("[[Target.md]]", "[[Stay.md]]"),
    sourcelessMulti: multi("[[Target.md]]", "[[Held.md]]"),
    ctx: multi("[[Target.md]]", "[[Rel.md]]"),
    fmNoMatch: multi("[[Unrelated.md]]"),
  });

  const cols: SpaceProperty[] = [
    fmLinkCol("fmLink"),
    fmLinkMultiCol("fmLinkMulti"),
    notidianLinkCol("notidianLink"),
    sourcelessLinkMultiCol("sourcelessMulti"),
    contextCol("ctx"),
    fmLinkCol("fmNoMatch"),
  ];

  const savedColumns = (calls: SaveCall[]) =>
    calls.flatMap((c) => Object.keys(c.payload));

  it("removeLinksInRow: saveProperties ONLY for frontmatter-backed MATCHED columns", () => {
    const { manager, calls } = makeSpyManager();
    const out = removeLinksInRow(manager, buildRow(), "Target.md", cols);

    // Authority gate: file writes only for the frontmatter columns that matched.
    const saved = savedColumns(calls).sort();
    expect(saved).toEqual(["fmLink", "fmLinkMulti"]);
    // Notidian-owned columns NEVER reach the file (explicit source:"notidian",
    // source-less link-multi, and context-only).
    expect(saved).not.toContain("notidianLink");
    expect(saved).not.toContain("sourcelessMulti");
    expect(saved).not.toContain("ctx");
    // Non-matching column is never saved (and never even iterated into a write).
    expect(saved).not.toContain("fmNoMatch");
    // Every save targets the row's own file path.
    for (const c of calls) expect(c.path).toBe(PATH);

    // Row delta: ALL matched columns updated regardless of authority.
    expect(parseMultiString(out.fmLink)).toEqual(["[[Other.md]]"]);
    expect(parseMultiString(out.fmLinkMulti)).toEqual(["[[Keep.md]]"]);
    expect(parseMultiString(out.notidianLink)).toEqual(["[[Stay.md]]"]);
    expect(parseMultiString(out.sourcelessMulti)).toEqual(["[[Held.md]]"]);
    expect(parseMultiString(out.ctx)).toEqual(["[[Rel.md]]"]);
    // Untouched columns are returned verbatim (no spurious delta).
    expect(out.fmNoMatch).toBe(multi("[[Unrelated.md]]"));
    expect(out[PathPropertyName]).toBe(PATH);
  });

  it("renameLinksInRow: saveProperties ONLY for frontmatter-backed MATCHED columns", () => {
    const { manager, calls } = makeSpyManager();
    const out = renameLinksInRow(
      manager,
      buildRow(),
      "Target.md",
      "[[Renamed.md]]",
      cols
    );

    const saved = savedColumns(calls).sort();
    expect(saved).toEqual(["fmLink", "fmLinkMulti"]);
    expect(saved).not.toContain("notidianLink");
    expect(saved).not.toContain("sourcelessMulti");
    expect(saved).not.toContain("ctx");
    expect(saved).not.toContain("fmNoMatch");
    for (const c of calls) expect(c.path).toBe(PATH);

    // Row delta updates ALL matched columns; non-target entries preserved.
    expect(parseMultiString(out.fmLink)).toEqual(["[[Renamed.md]]", "[[Other.md]]"]);
    expect(parseMultiString(out.fmLinkMulti)).toEqual(["[[Renamed.md]]", "[[Keep.md]]"]);
    expect(parseMultiString(out.notidianLink)).toEqual(["[[Renamed.md]]", "[[Stay.md]]"]);
    expect(parseMultiString(out.sourcelessMulti)).toEqual(["[[Renamed.md]]", "[[Held.md]]"]);
    expect(parseMultiString(out.ctx)).toEqual(["[[Renamed.md]]", "[[Rel.md]]"]);
    expect(out.fmNoMatch).toBe(multi("[[Unrelated.md]]"));
  });

  it("frontmatter saveProperties payload is parsed via parseMDBStringValue(frontmatter=true)", () => {
    // The file write must carry the frontmatter-shaped value, not the raw row
    // string. For a link-type column parseMDBStringValue wraps in [[...]].
    const { manager, calls } = makeSpyManager();
    const row: DBRow = {
      [PathPropertyName]: PATH,
      fmLink: multi("[[Target.md]]", "[[Other.md]]"),
    };
    renameLinksInRow(manager, row, "Target.md", "[[Renamed.md]]", [
      fmLinkCol("fmLink"),
    ]);
    expect(calls).toHaveLength(1);
    // link type, value still a JSON multistring -> frontmatter wrap [[ ... ]]
    expect(calls[0].payload.fmLink).toBe(
      `[[${serializeMultiString(["[[Renamed.md]]", "[[Other.md]]"])}]]`
    );
  });

  it("NO-MATCH row: no saveProperties call, row returned unchanged", () => {
    const { manager, calls } = makeSpyManager();
    const row = buildRow();
    const out = removeLinksInRow(manager, row, "Absent.md", cols);
    expect(calls).toHaveLength(0);
    // identity: no delta keys spread over the row
    expect(out).toEqual(row);

    const { manager: m2, calls: c2 } = makeSpyManager();
    const out2 = renameLinksInRow(m2, row, "Absent.md", "[[X.md]]", cols);
    expect(c2).toHaveLength(0);
    expect(out2).toEqual(row);
  });

  it("empty cols: short-circuits, no save, returns the same row", () => {
    const { manager, calls } = makeSpyManager();
    const row = buildRow();
    expect(removeLinksInRow(manager, row, "Target.md", [])).toBe(row);
    expect(renameLinksInRow(manager, row, "Target.md", "[[Y]]", [])).toBe(row);
    expect(calls).toHaveLength(0);
  });

  it("source-less link-multi is Notidian-owned: matched row delta updates, file never written", () => {
    const { manager, calls } = makeSpyManager();
    const row: DBRow = {
      [PathPropertyName]: PATH,
      onlyMulti: multi("[[Target.md]]", "[[Other.md]]"),
    };
    const out = removeLinksInRow(manager, row, "Target.md", [
      sourcelessLinkMultiCol("onlyMulti"),
    ]);
    // Authority gate: no frontmatter representation => no file write.
    expect(calls).toHaveLength(0);
    // But the row delta is still updated so the caller can persist via context.
    expect(parseMultiString(out.onlyMulti)).toEqual(["[[Other.md]]"]);
  });

  it("matched frontmatter column among many non-matching columns saves exactly once", () => {
    const { manager, calls } = makeSpyManager();
    const row: DBRow = {
      [PathPropertyName]: PATH,
      a: multi("[[Nope.md]]"),
      b: multi("[[Target.md]]"),
      c: multi("[[AlsoNope.md]]"),
    };
    const out = removeLinksInRow(manager, row, "Target.md", [
      fmLinkCol("a"),
      fmLinkCol("b"),
      fmLinkCol("c"),
    ]);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].payload)).toEqual(["b"]);
    expect(parseMultiString(out.b)).toEqual([]);
    // untouched columns unchanged
    expect(out.a).toBe(multi("[[Nope.md]]"));
    expect(out.c).toBe(multi("[[AlsoNope.md]]"));
  });
});
