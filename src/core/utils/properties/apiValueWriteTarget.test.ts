/**
 * bd Notidian-DEPTH-apiValueWriteTarget-authority-matrix
 *
 * Direct, adversarial + property-style coverage of the API write-gate authority
 * resolver. `apiValueWriteTarget` (propertyAuthority.ts) is the gate that decides
 * where api.context.update / api.path.setProperty land a single value write:
 * "frontmatter" (visible YAML), "context" (hidden MDB), or "skip" (computed —
 * write nothing). It was previously tested ONLY indirectly (apiValueWrite.test.ts
 * via apiFieldWriteTarget; api.authority.test.ts via the full API). These tests
 * pin its precedence and conflict edges directly, plus the two cross-cutting
 * invariants from ADR 0001/0017:
 *
 *   INVARIANT A: apiValueWriteTarget returns "skip" IFF the column is computed
 *     (rollup / backlink / fileprop / aggregate), regardless of any source marker
 *     or the verb's defaultTarget.
 *   INVARIANT B: a source-less, file-backed-compatible column NEVER yields
 *     "context" — the no-silent-MDB-leak promise (file/frontmatter canonical;
 *     durable MDB ownership requires an explicit source: "notidian").
 *
 * Pure resolver: no DOM, no I/O. These exercise propertyAuthorityForColumn and
 * apiValueWriteTarget directly.
 */
import { PathPropertyName } from "shared/types/context";
import { frontmatterPropertySource } from "./allProperties";
import {
  apiValueWriteTarget,
  notidianPropertySource,
  propertyAuthorityForColumn,
} from "./propertyAuthority";

const BOTH_DEFAULTS = ["frontmatter", "context"] as const;

// Types with a native file-backed (frontmatter) representation. Mirrors the
// frontmatterStorableTypes set in propertyAuthority.ts (kept private there).
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

// Types with no frontmatter form: the MDB is their only durable home, so a
// source-less column of these resolves to context.
const CONTEXT_ONLY_TYPES = ["context", "object", "flex", "super"] as const;

// Derived/read-only types. Their value is computed at render time; a write of a
// derived value must always be skipped.
const COMPUTED_TYPES = ["fileprop", "aggregate", "rollup", "backlink"] as const;

describe("apiValueWriteTarget — precedence edges", () => {
  it("(1) file identity (PathPropertyName) returns the verb default for BOTH defaults, never skip/reroute", () => {
    for (const defaultTarget of BOTH_DEFAULTS) {
      const target = apiValueWriteTarget(
        { name: PathPropertyName, type: "file" },
        defaultTarget
      );
      // file identity is not a value write — the gate preserves the verb's
      // pre-gate behavior rather than rerouting or skipping the identity write.
      expect(target).toBe(defaultTarget);
      expect(target).not.toBe("skip");
    }
    // The page-title column is classified "file", not value-bearing.
    expect(
      propertyAuthorityForColumn({ name: PathPropertyName, type: "file" })
    ).toBe("file");
  });

  it("(2) computed type wins over a stray source:frontmatter marker -> computed/skip (no derived-value leak into YAML)", () => {
    // Precedence fix (this bead): computedTypes is checked BEFORE the source
    // markers in propertyAuthorityForColumn. A computed column mislabeled
    // source:"frontmatter" (corrupt MDB / materialization match / hand-built
    // partial column) must still classify as "computed" and skip the write —
    // otherwise apiValueWriteTarget would persist a DERIVED value into the file's
    // YAML, breaking the read-only promise (ADR 0001/0017). "skip IFF computed".
    for (const type of COMPUTED_TYPES) {
      expect(
        propertyAuthorityForColumn({
          name: "derived",
          type,
          source: frontmatterPropertySource,
        })
      ).toBe("computed");
      for (const defaultTarget of BOTH_DEFAULTS) {
        expect(
          apiValueWriteTarget(
            { name: "derived", type, source: frontmatterPropertySource },
            defaultTarget
          )
        ).toBe("skip");
      }
    }
  });

  it("(3) computed type wins over source:notidian -> computed/skip", () => {
    // A computed column is read-only even if explicitly marked Notidian-owned:
    // the type's derived nature outranks the ownership marker. Persisting a
    // derived value into the MDB is just as wrong as persisting it into YAML.
    for (const type of COMPUTED_TYPES) {
      expect(
        propertyAuthorityForColumn({
          name: "derived",
          type,
          source: notidianPropertySource,
        })
      ).toBe("computed");
      for (const defaultTarget of BOTH_DEFAULTS) {
        expect(
          apiValueWriteTarget(
            { name: "derived", type, source: notidianPropertySource },
            defaultTarget
          )
        ).toBe("skip");
      }
    }
  });

  it("(5) an undefined property returns the verb default for BOTH defaults", () => {
    for (const defaultTarget of BOTH_DEFAULTS) {
      expect(apiValueWriteTarget(undefined, defaultTarget)).toBe(defaultTarget);
    }
  });

  it("a typeless/sourceless non-path column resolves to notidian -> context (characterization)", () => {
    // A column whose definition exists but carries no type AND no source marker
    // cannot be classified frontmatter-storable (no type to check) and is not
    // explicitly frontmatter/notidian, so propertyAuthorityForColumn falls
    // through to "notidian" -> apiValueWriteTarget "context" for BOTH defaults.
    // This is the residual fall-through, distinct from the `undefined`-property
    // case above (no column found -> verb default). Pin the ACTUAL behavior so a
    // future change to the fall-through is a deliberate, reviewed decision.
    expect(propertyAuthorityForColumn({ name: "ghost" })).toBe("notidian");
    expect(apiValueWriteTarget({ name: "ghost" }, "frontmatter")).toBe("context");
    expect(apiValueWriteTarget({ name: "ghost" }, "context")).toBe("context");
  });
});

describe("apiValueWriteTarget — property matrix over types x defaults", () => {
  it("(4a) every frontmatter-storable type, source-less, resolves to frontmatter for BOTH defaults (never context/skip)", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      expect(propertyAuthorityForColumn({ name: "x", type })).toBe(
        "frontmatter"
      );
      for (const defaultTarget of BOTH_DEFAULTS) {
        const target = apiValueWriteTarget({ name: "x", type }, defaultTarget);
        expect(target).toBe("frontmatter");
        // INVARIANT B: a source-less file-backed column never leaks to the MDB,
        // even when the verb's pre-gate default was "context".
        expect(target).not.toBe("context");
        expect(target).not.toBe("skip");
      }
    }
  });

  it("(4b) every frontmatter-storable type with explicit source:frontmatter resolves to frontmatter for BOTH defaults", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      for (const defaultTarget of BOTH_DEFAULTS) {
        expect(
          apiValueWriteTarget(
            { name: "x", type, source: frontmatterPropertySource },
            defaultTarget
          )
        ).toBe("frontmatter");
      }
    }
  });

  it("(4c) every frontmatter-storable type with explicit source:notidian resolves to context for BOTH defaults", () => {
    // The deliberate "Notidian-owned field" choice: a file-backed-compatible
    // type can be durably MDB-owned ONLY via this explicit marker.
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      for (const defaultTarget of BOTH_DEFAULTS) {
        expect(
          apiValueWriteTarget(
            { name: "x", type, source: notidianPropertySource },
            defaultTarget
          )
        ).toBe("context");
      }
    }
  });

  it("(4d) every context-only type, source-less, resolves to context for BOTH defaults", () => {
    for (const type of CONTEXT_ONLY_TYPES) {
      expect(propertyAuthorityForColumn({ name: "rel", type })).toBe("notidian");
      for (const defaultTarget of BOTH_DEFAULTS) {
        const target = apiValueWriteTarget({ name: "rel", type }, defaultTarget);
        expect(target).toBe("context");
        expect(target).not.toBe("skip");
      }
    }
  });

  it("(4e) every computed type, source-less, resolves to skip for BOTH defaults", () => {
    for (const type of COMPUTED_TYPES) {
      expect(propertyAuthorityForColumn({ name: "c", type })).toBe("computed");
      for (const defaultTarget of BOTH_DEFAULTS) {
        expect(apiValueWriteTarget({ name: "c", type }, defaultTarget)).toBe(
          "skip"
        );
      }
    }
  });
});

describe("apiValueWriteTarget — cross-cutting invariants", () => {
  // The full exercised universe: every type x {no source, frontmatter, notidian}
  // x both defaults, plus undefined and the file-identity column.
  const ALL_TYPES = [
    ...FRONTMATTER_STORABLE_TYPES,
    ...CONTEXT_ONLY_TYPES,
    ...COMPUTED_TYPES,
  ] as const;
  const SOURCES: ReadonlyArray<string | undefined> = [
    undefined,
    frontmatterPropertySource,
    notidianPropertySource,
  ];

  it("INVARIANT A: returns 'skip' IFF the column is computed", () => {
    for (const type of ALL_TYPES) {
      const isComputed = (COMPUTED_TYPES as readonly string[]).includes(type);
      for (const source of SOURCES) {
        for (const defaultTarget of BOTH_DEFAULTS) {
          const target = apiValueWriteTarget(
            { name: "field", type, source },
            defaultTarget
          );
          // skip <-> computed in both directions.
          expect(target === "skip").toBe(isComputed);
        }
      }
    }
    // The non-column shapes never skip.
    for (const defaultTarget of BOTH_DEFAULTS) {
      expect(apiValueWriteTarget(undefined, defaultTarget)).not.toBe("skip");
      expect(
        apiValueWriteTarget(
          { name: PathPropertyName, type: "file" },
          defaultTarget
        )
      ).not.toBe("skip");
    }
  });

  it("INVARIANT B: a source-less file-backed-compatible column NEVER yields 'context'", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      for (const defaultTarget of BOTH_DEFAULTS) {
        // No source marker: the no-silent-MDB-leak promise. Even when the verb's
        // pre-gate default was "context", the gate redirects to the visible file
        // layer rather than the hidden store.
        expect(
          apiValueWriteTarget({ name: "x", type }, defaultTarget)
        ).not.toBe("context");
      }
    }
  });

  it("the result is always one of the three legal targets", () => {
    const legal = new Set(["frontmatter", "context", "skip"]);
    for (const type of ALL_TYPES) {
      for (const source of SOURCES) {
        for (const defaultTarget of BOTH_DEFAULTS) {
          expect(
            legal.has(apiValueWriteTarget({ name: "f", type, source }, defaultTarget))
          ).toBe(true);
        }
      }
    }
    for (const defaultTarget of BOTH_DEFAULTS) {
      expect(legal.has(apiValueWriteTarget(undefined, defaultTarget))).toBe(true);
    }
  });
});
