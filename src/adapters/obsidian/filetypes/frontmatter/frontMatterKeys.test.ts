import { frontMatterKeys } from "./frontMatterKeys";

// ---------------------------------------------------------------------------
// AUTHORITY (Q1) — characterization net for frontMatterKeys (frontMatterKeys.ts:2)
// (Notidian-bey). This is the pure projection that turns a file's frontmatter
// object into the set of EDITABLE frontmatter property keys, dropping the
// Make.md/Notidian-internal `position` bookkeeping key. Frontmatter is the
// canonical owner of ordinary editable properties (ADR 0014/0017), so the
// exact key set this returns is authority-relevant: every key it yields is
// treated downstream as a frontmatter-backed column.
//
// Everything here is pure / offline — no vault, no DOM, no I/O, no mocks. The
// module has no heavy import-time deps, so it is imported and exercised directly.
//
// IMPORTANT — characterization, not correction. These tests lock the CURRENT
// observable contract. Two quirks are intentionally pinned (NOT asserted as
// "right"): the filter is a LITERAL `f != "position"` (loose, exact string),
// so it (a) is case- and plural-sensitive — `Position`/`positions` are KEPT —
// and (b) drops only the one literal key. Any future change to which keys are
// excluded must update these tests deliberately.
// ---------------------------------------------------------------------------

describe("frontMatterKeys (authority characterization, Notidian-bey)", () => {
  describe("nullish input → empty array (the `fm ?? {}` guard)", () => {
    it("returns [] for null", () => {
      expect(frontMatterKeys(null as unknown as Record<string, any>)).toEqual(
        []
      );
    });

    it("returns [] for undefined", () => {
      expect(
        frontMatterKeys(undefined as unknown as Record<string, any>)
      ).toEqual([]);
    });

    it("returns [] for an empty object", () => {
      expect(frontMatterKeys({})).toEqual([]);
    });

    it("always returns a fresh array (not a shared/frozen reference)", () => {
      const a = frontMatterKeys(null as unknown as Record<string, any>);
      const b = frontMatterKeys(null as unknown as Record<string, any>);
      expect(a).not.toBe(b);
      // It is the live `.filter()` result, so it is mutable.
      a.push("mutated");
      expect(b).toEqual([]);
    });
  });

  describe("the literal `position` key is excluded", () => {
    it("drops `position` while keeping siblings", () => {
      expect(frontMatterKeys({ a: 1, position: {}, b: 2 })).toEqual(["a", "b"]);
    });

    it("drops `position` when it is the only key", () => {
      expect(frontMatterKeys({ position: { start: 0, end: 10 } })).toEqual([]);
    });

    it("drops `position` regardless of its value type (key-based filter)", () => {
      // The filter is on the KEY only — value is irrelevant.
      expect(frontMatterKeys({ position: null })).toEqual([]);
      expect(frontMatterKeys({ position: "anything" })).toEqual([]);
      expect(frontMatterKeys({ position: undefined })).toEqual([]);
    });
  });

  describe("only the EXACT literal `position` is dropped (loose `!=`, case/plural-sensitive)", () => {
    it("KEEPS `Position` (capitalized) — characterized quirk", () => {
      expect(frontMatterKeys({ Position: 1 })).toEqual(["Position"]);
    });

    it("KEEPS `positions` (plural) — characterized quirk", () => {
      expect(frontMatterKeys({ positions: 1 })).toEqual(["positions"]);
    });

    it("KEEPS look-alikes but drops only the exact literal among them", () => {
      expect(
        frontMatterKeys({
          Position: 1,
          positions: 2,
          position: 3,
          POSITION: 4,
          " position": 5,
          "position ": 6,
        })
      ).toEqual(["Position", "positions", "POSITION", " position", "position "]);
    });
  });

  describe("key order is preserved (Object.keys insertion order)", () => {
    it("returns keys in declaration order for plain string keys", () => {
      expect(frontMatterKeys({ z: 1, a: 2, m: 3 })).toEqual(["z", "a", "m"]);
    });

    it("preserves order while removing `position` from the middle", () => {
      expect(
        frontMatterKeys({ title: 1, position: {}, tags: 2, status: 3 })
      ).toEqual(["title", "tags", "status"]);
    });
  });

  describe("undefined-valued keys are still keys", () => {
    it("keeps a key whose value is undefined (Object.keys, not value presence)", () => {
      expect(frontMatterKeys({ a: undefined, b: 2 })).toEqual(["a", "b"]);
    });
  });

  describe("only OWN enumerable string keys are considered", () => {
    it("ignores inherited prototype keys", () => {
      const proto = { inherited: 1 };
      const fm = Object.create(proto) as Record<string, any>;
      fm.own = 2;
      // Object.keys only sees own enumerable keys.
      expect(frontMatterKeys(fm)).toEqual(["own"]);
    });
  });
});
