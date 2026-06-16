/**
 * Adversarial + property net for the grouped board/list drag persistence
 * AUTHORITY GATE (Notidian-7yat): src/core/utils/contexts/groupDrag.ts.
 *
 * This seam is the exact "ordinary edits cannot bypass the authority model"
 * invariant (AGENTS.md authority invariants; ADR 0001/0014/0017). A grouped-board
 * or grouped-list drag moves a note from one group lane to another; on a
 * folder/default context that maps to a FRONTMATTER write of the group column's
 * value. Two corruption modes live here:
 *
 *   (1) KEY corruption — `_groupField` is the full SpaceProperty column OBJECT
 *       (from cols.find(...)). Used directly as a computed key it coerces to the
 *       literal string "[object Object]" and writes a junk YAML key into the
 *       dragged note (the original P0, Notidian-oec). resolveGroupFieldName must
 *       distill the canonical column name (or null) — NEVER "[object Object]".
 *
 *   (2) AUTHORITY corruption — a drag must persist to the visible Markdown
 *       frontmatter ONLY for a frontmatter-authority column. A computed/read-only
 *       column, the file-identity column, an explicitly Notidian-owned column, or
 *       a context-only (source-less, no frontmatter form) column must yield NO
 *       frontmatter write (return null) — otherwise an ordinary drag silently
 *       writes a derived/hidden-store value into the file layer, breaking the
 *       authority partition. frontmatterGroupDragWrite delegates that decision to
 *       shouldWriteAuthorityValueToFrontmatter (propertyAuthority.ts).
 *
 * The existing __audit__/oec-group-drag.audit.test.ts pins the original P0 with a
 * handful of examples. This file HARDENS the seam with (a) exhaustive edge cases
 * for resolveGroupFieldName over hostile group-field shapes, (b) a per-property-
 * kind authority matrix for frontmatterGroupDragWrite, (c) value-passthrough /
 * key-equals-resolved-name invariants (incl. falsy 0/false/'' group values), and
 * (d) mulberry32-seeded property loops proving the corruption-proof invariants
 * over thousands of random column shapes.
 *
 * CHARACTERIZATION, NOT CORRECTION. Every assertion LOCKS the live behaviour of
 * groupDrag.ts + propertyAuthority.ts; no production code is changed. Pure,
 * offline, dependency-light — an infinite-quota-safe sink on a safety-critical
 * surface.
 *
 * CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
 * dependency — matching tableRowOrder.property.test.ts / tableRollup.property.test.ts.
 */
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty } from "shared/types/mdb";
import {
  frontmatterGroupDragWrite,
  resolveGroupFieldName,
} from "./groupDrag";
import { shouldWriteAuthorityValueToFrontmatter } from "../properties/propertyAuthority";

// The forbidden key: what String(SpaceProperty-object) coerces to. EVERY resolver
// path and EVERY write path must be proven to never emit this.
const OBJECT_OBJECT = "[object Object]";

// ---------------------------------------------------------------------------
// Property-kind taxonomy (mirrors propertyAuthority.ts — kept in lock-step so a
// future change to the authority sets fails HERE, not silently in production).
// ---------------------------------------------------------------------------

// Types with a native frontmatter (file-backed) form. A source-LESS column of
// these types defaults to the visible frontmatter layer -> a drag DOES persist.
const FRONTMATTER_STORABLE_TYPES = [
  "text",
  "password",
  "number",
  "boolean",
  "date",
  "option",
  "option-multi",
  "link",
  "image",
  "tags-multi",
] as const;

// Computed/read-only types: derived at render time, NEVER persisted from a drag.
const COMPUTED_TYPES = ["fileprop", "aggregate", "rollup", "backlink"] as const;

// Context-only types: no frontmatter representation; a source-less column of
// these stays Notidian-owned (MDB is its only durable home) -> a drag must NOT
// write it to the file.
const CONTEXT_ONLY_TYPES = [
  "context",
  "object",
  "flex",
  "super",
  "space",
] as const;

// --- tiny deterministic PRNG (no external dep) — same mulberry32 the sibling
// property tests use, so runs are reproducible across machines/CI. ------------
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: () => number, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];
const PROPERTY_RUNS = 2000;

// A spread of group VALUES a drag can carry, including the falsy ones a naive
// `value || fallback` would corrupt: 0, false, "" must pass through UNTOUCHED.
const GROUP_VALUES: readonly unknown[] = [
  "Done",
  "In Progress",
  "",
  0,
  false,
  null,
  undefined,
  42,
  true,
  "0",
  "false",
  ["a", "b"],
  { nested: 1 },
];

describe("groupDrag — resolveGroupFieldName (key-corruption gate)", () => {
  describe("the canonical happy paths", () => {
    it("resolves the column name from a full SpaceProperty object", () => {
      const col: SpaceProperty = { name: "status", type: "option", schemaId: "" };
      expect(resolveGroupFieldName(col)).toBe("status");
    });

    it("resolves a bare string column name as itself", () => {
      expect(resolveGroupFieldName("priority")).toBe("priority");
    });

    it("never returns the coerced object literal for a real object column", () => {
      const col = { name: "status", type: "option" };
      expect(resolveGroupFieldName(col)).not.toBe(OBJECT_OBJECT);
    });
  });

  describe("hostile / degenerate group-field shapes resolve to null (never a junk key)", () => {
    const nulls: ReadonlyArray<[string, unknown]> = [
      ["undefined", undefined],
      ["null", null],
      ["empty object", {}],
      ["empty string", ""],
      ["object with empty-string name", { name: "" }],
      ["object with missing name", { type: "option" }],
      ["object with numeric name", { name: 42 }],
      ["object with boolean name", { name: true }],
      ["object with null name", { name: null }],
      ["object with undefined name", { name: undefined }],
      ["object with object name", { name: { deep: 1 } }],
      ["object with array name", { name: ["a"] }],
      ["number", 7],
      ["boolean", true],
      ["array", ["status"]],
      ["object whose name coerces to [object Object]", { name: {} }],
    ];

    it.each(nulls)("resolves %s to null", (_label, input) => {
      const out = resolveGroupFieldName(input as never);
      expect(out).toBeNull();
      // Belt-and-suspenders: whatever the path, it is never the junk key.
      expect(out).not.toBe(OBJECT_OBJECT);
    });
  });

  describe("whitespace-name policy is pinned (current behaviour: trim-free pass-through)", () => {
    // resolveGroupFieldName uses `name.length > 0`, NOT a trim — so a name that is
    // pure whitespace is treated as a non-empty string and passes THROUGH. This
    // is intentional-by-omission; pin it so a future "helpful trim" is a conscious
    // change with a failing test, not a silent reshape of the key contract.
    it("a non-empty whitespace-containing object name passes through verbatim", () => {
      expect(resolveGroupFieldName({ name: " status " })).toBe(" status ");
    });

    it("a non-empty whitespace-containing bare string passes through verbatim", () => {
      expect(resolveGroupFieldName(" status ")).toBe(" status ");
    });

    it("a string that is purely whitespace is NON-empty -> passes through (not null)", () => {
      // length > 0 is true for "   " on the bare-string branch.
      expect(resolveGroupFieldName("   ")).toBe("   ");
    });

    it("a single space bare string passes through", () => {
      expect(resolveGroupFieldName(" ")).toBe(" ");
    });
  });

  describe("the bare-string branch and object branch agree on the name", () => {
    it("a string column and an object column of the same name resolve identically", () => {
      expect(resolveGroupFieldName("status")).toBe(
        resolveGroupFieldName({ name: "status", type: "option" })
      );
    });
  });

  it("NEVER returns [object Object] across a wide random object spread (property)", () => {
    const rng = makeRng(0xc0ffee);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      // Build a random column-ish object: name is sometimes a string, sometimes
      // a hostile non-string, sometimes absent.
      const nameKind = randInt(rng, 0, 5);
      const col: Record<string, unknown> = {};
      if (nameKind === 0) col.name = `c${randInt(rng, 0, 99)}`;
      else if (nameKind === 1) col.name = "";
      else if (nameKind === 2) col.name = randInt(rng, 0, 999);
      else if (nameKind === 3) col.name = {};
      else if (nameKind === 4) col.name = undefined;
      // nameKind === 5 -> no name key at all
      col.type = pick(rng, [
        ...FRONTMATTER_STORABLE_TYPES,
        ...COMPUTED_TYPES,
        ...CONTEXT_ONLY_TYPES,
      ]);

      const out = resolveGroupFieldName(col as never);
      // INVARIANT: the result is exactly the string name (when name is a
      // non-empty string) or null — never the coerced object literal, never a
      // non-string.
      expect(out).not.toBe(OBJECT_OBJECT);
      if (nameKind === 0) {
        expect(out).toBe(col.name);
        expect(typeof out).toBe("string");
      } else {
        expect(out).toBeNull();
      }
    }
  });
});

describe("groupDrag — frontmatterGroupDragWrite (authority gate)", () => {
  describe("frontmatter-authority columns DO yield a write (the only persist path)", () => {
    it.each(FRONTMATTER_STORABLE_TYPES)(
      "source-less '%s' column (file-backed default) writes under its real key",
      (type) => {
        const col = { name: "lane", type };
        const write = frontmatterGroupDragWrite(col, "Done");
        expect(write).toEqual({ key: "lane", value: "Done" });
      }
    );

    it("an explicit source:'frontmatter' column writes regardless of type", () => {
      // Even a context-only type, once explicitly tagged frontmatter, is a
      // frontmatter-authority column and persists.
      const col = { name: "lane", type: "context", source: "frontmatter" };
      expect(frontmatterGroupDragWrite(col, "Done")).toEqual({
        key: "lane",
        value: "Done",
      });
    });

    it("an explicit source:'frontmatter' column of an OTHERWISE-computed type still writes only via the frontmatter branch order", () => {
      // A frontmatter-storable type with an explicit frontmatter source is the
      // canonical write case; pin it alongside the source-less defaults above.
      const col = { name: "lane", type: "number", source: "frontmatter" };
      expect(frontmatterGroupDragWrite(col, 7)).toEqual({ key: "lane", value: 7 });
    });
  });

  describe("a TYPELESS column (incl. the synthesized bare-string column) does NOT write — pinned", () => {
    // CRITICAL behavioural truth probed against the live code: groupDrag.ts
    // synthesizes a bare-string group field into `{ name: key }` with NO `type`.
    // propertyAuthorityForColumn on a {name}-only column finds no frontmatter-
    // storable type and no source marker, so it resolves to "notidian" -> the
    // gate returns NULL. So a bare-string group field does NOT persist to
    // frontmatter on its own; the column must carry a frontmatter-storable type
    // (or an explicit source:"frontmatter") to be drag-written. This is the
    // conservative, authority-safe default — pin it so a future change that makes
    // typeless columns silently file-writable is a conscious, failing-test change.
    it("a bare-string group field synthesizes a typeless column and returns null", () => {
      expect(frontmatterGroupDragWrite("status", "Active")).toBeNull();
    });

    it("a typeless object column likewise returns null", () => {
      expect(frontmatterGroupDragWrite({ name: "status" }, "Active")).toBeNull();
    });
  });

  describe("non-frontmatter-authority columns yield NO write (no file corruption)", () => {
    it.each(COMPUTED_TYPES)(
      "computed/read-only '%s' column returns null (derived value, never persisted)",
      (type) => {
        expect(frontmatterGroupDragWrite({ name: "g", type }, "x")).toBeNull();
      }
    );

    it("a computed column with a STRAY source:'frontmatter' marker still returns null", () => {
      // "skip IFF computed" is an invariant: the computed check precedes the
      // source marker, so a mislabelled rollup cannot leak a derived value to YAML.
      expect(
        frontmatterGroupDragWrite(
          { name: "g", type: "rollup", source: "frontmatter" },
          "x"
        )
      ).toBeNull();
    });

    it.each(CONTEXT_ONLY_TYPES)(
      "source-less context-only '%s' column returns null (MDB is its only home)",
      (type) => {
        expect(frontmatterGroupDragWrite({ name: "g", type }, "x")).toBeNull();
      }
    );

    it("an explicit source:'notidian' column returns null (Notidian-owned, not file)", () => {
      // Even a frontmatter-storable type, once explicitly Notidian-owned, must
      // not be drag-persisted to the file layer.
      expect(
        frontmatterGroupDragWrite(
          { name: "g", type: "text", source: "notidian" },
          "x"
        )
      ).toBeNull();
    });

    it("the file-identity column (PathPropertyName) returns null (identity, not a value)", () => {
      expect(
        frontmatterGroupDragWrite({ name: PathPropertyName, type: "text" }, "x")
      ).toBeNull();
    });

    it("a typeless source-less column returns null (no frontmatter form resolvable)", () => {
      // No type + no source -> not frontmatter-storable -> Notidian-owned -> skip.
      expect(frontmatterGroupDragWrite({ name: "g" }, "x")).toBeNull();
    });
  });

  describe("unresolvable group-field returns null BEFORE any authority decision", () => {
    const unresolvable: ReadonlyArray<[string, unknown]> = [
      ["undefined", undefined],
      ["null", null],
      ["empty object", {}],
      ["empty string", ""],
      ["object with empty name", { name: "", type: "text" }],
      ["object with numeric name", { name: 1, type: "text" }],
      ["number", 5],
    ];
    it.each(unresolvable)("returns null for %s group field", (_label, gf) => {
      expect(frontmatterGroupDragWrite(gf as never, "x")).toBeNull();
    });
  });

  describe("value PASSES THROUGH untouched (falsy values are real data, not absence)", () => {
    it.each([
      ["empty string", ""],
      ["zero", 0],
      ["false", false],
      ["null", null],
      ["undefined", undefined],
      ["the string '0'", "0"],
      ["an array", ["a", "b"]],
      ["a nested object", { k: "v" }],
    ])("a frontmatter column carries %s verbatim into the write", (_label, value) => {
      const write = frontmatterGroupDragWrite({ name: "lane", type: "text" }, value);
      expect(write).not.toBeNull();
      // Strict identity / value equality — no coercion, no `|| fallback`.
      expect(write!.value).toBe(value as never);
      expect(write!.key).toBe("lane");
    });

    it("a non-frontmatter column returns null even for a falsy value (no accidental write)", () => {
      expect(
        frontmatterGroupDragWrite({ name: "g", type: "rollup" }, 0)
      ).toBeNull();
      expect(
        frontmatterGroupDragWrite({ name: "g", type: "context" }, "")
      ).toBeNull();
    });
  });

  describe("the returned key ALWAYS equals the resolved canonical name", () => {
    it("object column: write key === resolveGroupFieldName(col)", () => {
      const col = { name: "status", type: "option", source: "frontmatter" };
      const write = frontmatterGroupDragWrite(col, "v");
      expect(write!.key).toBe(resolveGroupFieldName(col));
    });

    it("bare-string column with a frontmatter-storable type: write key === resolved string", () => {
      // The bare string alone synthesizes a typeless (null-resolving authority)
      // column; to assert the key-equality on a WRITE we use an object column
      // carrying a frontmatter-storable type, whose name still equals the resolve.
      const col = { name: "priority", type: "option" };
      const write = frontmatterGroupDragWrite(col, "High");
      expect(write!.key).toBe(resolveGroupFieldName(col));
      expect(write!.key).toBe("priority");
    });

    it("a whitespace name flows identically through resolve and write", () => {
      const col = { name: " status ", type: "text" };
      const write = frontmatterGroupDragWrite(col, "v");
      expect(write!.key).toBe(" status ");
      expect(write!.key).toBe(resolveGroupFieldName(col));
    });
  });
});

describe("groupDrag — property net: the corruption-proof invariants over random drags", () => {
  it("a write is yielded IFF the column is frontmatter-authority; key/value are exact; never [object Object]", () => {
    const rng = makeRng(0x5eed);
    const allTypes = [
      ...FRONTMATTER_STORABLE_TYPES,
      ...COMPUTED_TYPES,
      ...CONTEXT_ONLY_TYPES,
    ];
    const sources: ReadonlyArray<string | undefined> = [
      undefined,
      "frontmatter",
      "notidian",
      "garbage",
    ];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      // 1-in-12 use the file-identity name; else a random ordinary name.
      const useIdentity = randInt(rng, 0, 11) === 0;
      const name = useIdentity ? PathPropertyName : `col_${randInt(rng, 0, 9999)}`;
      const type = pick(rng, allTypes);
      const source = pick(rng, sources);
      const col: Record<string, unknown> = { name, type };
      if (source !== undefined) col.source = source;
      const value = pick(rng, GROUP_VALUES);

      const write = frontmatterGroupDragWrite(col as never, value);

      // ORACLE: the gate's verdict must match the authority module's verdict on
      // the SAME column object. (resolveGroupFieldName always succeeds here — the
      // name is always a non-empty string — so the gate is purely the authority
      // decision.)
      const expectedWrite = shouldWriteAuthorityValueToFrontmatter(
        col as SpaceProperty
      );

      if (expectedWrite) {
        expect(write).not.toBeNull();
        // KEY-TRUTH: the key is exactly the canonical column name, never junk.
        expect(write!.key).toBe(name);
        expect(write!.key).not.toBe(OBJECT_OBJECT);
        // VALUE-TRUTH: the value passes through with strict identity.
        expect(write!.value).toBe(value as never);
        // The file-identity column can never be a frontmatter write target.
        expect(write!.key).not.toBe(PathPropertyName);
      } else {
        expect(write).toBeNull();
      }
    }
  });

  it("an unresolvable/hostile group field ALWAYS short-circuits to null (authority never even consulted)", () => {
    const rng = makeRng(0xbadc0de);
    const hostileNames: readonly unknown[] = [
      "",
      "   ",
      undefined,
      null,
      0,
      42,
      {},
      { deep: 1 },
      ["a"],
      true,
    ];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      // Half the time pass a hostile NAME inside an otherwise-valid column shape;
      // half the time pass a hostile top-level group field directly.
      let gf: unknown;
      if (rng() < 0.5) {
        gf = { name: pick(rng, hostileNames), type: pick(rng, FRONTMATTER_STORABLE_TYPES) };
      } else {
        gf = pick(rng, [undefined, null, 0, 42, true, ["x"], {} as unknown]);
      }
      const value = pick(rng, GROUP_VALUES);
      const resolved = resolveGroupFieldName(gf as never);
      const write = frontmatterGroupDragWrite(gf as never, value);

      // A whitespace string name is the ONE non-empty case the resolver keeps —
      // there a write may legitimately occur. Everywhere the resolver returns
      // null, the write MUST be null.
      if (resolved === null) {
        expect(write).toBeNull();
      } else {
        // Resolver kept it (a whitespace/non-empty string) -> key matches and is
        // never the junk literal.
        expect(typeof resolved).toBe("string");
        expect(resolved).not.toBe(OBJECT_OBJECT);
        if (write !== null) {
          expect(write.key).toBe(resolved);
          expect(write.value).toBe(value as never);
        }
      }
    }
  });
});
