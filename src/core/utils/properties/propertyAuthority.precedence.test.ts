/**
 * bd Notidian-qr4 — DEPTH(authority): systematic precedence + write-target net.
 *
 * propertyAuthorityForColumn (propertyAuthority.ts) is the single classifier the
 * whole fork leans on to decide whether a row VALUE is owned by the visible file
 * layer (frontmatter), the hidden context MDB (notidian), the file identity, or
 * is a derived/read-only value that must never be persisted (computed). It is the
 * most security-load-bearing pure function in the fork (ADR 0001/0017): its core
 * promise is that file-backed data NEVER silently becomes governed by the hidden
 * store — durable MDB ownership must be EXPLICIT (`source: "notidian"`, the
 * "Notidian-owned field" choice) or implied by a context-only type that has no
 * frontmatter form at all.
 *
 * The existing nets are example-based or partial:
 *   - propertyAuthority.test.ts        7 hand-picked example cases.
 *   - apiValueWriteTarget.test.ts      the write-gate (skip/frontmatter/context).
 *   - allProperties.authority.test.ts  the materialize rewrite site.
 *   - stripRowValues.authority.test.ts the write-back / strip side.
 * None of them drives the FULL precedence ladder as a property net, and none
 * exercises the ADVERSARIAL "unknown source string" axis (a free-form, non-
 * frontmatter/non-notidian marker — a legacy value, a corrupt MDB, a foreign
 * plugin's stamp; `SpaceProperty.source` is `string`, so this is reachable data).
 * Nor does anything assert the two boolean predicates are MUTUALLY EXCLUSIVE.
 *
 * This file is that net. It proves, over the cross-product of
 *   {file PathPropertyName} x {every type class} x
 *   {source: absent | frontmatter | notidian | unknown-string},
 * the four invariants the bead names:
 *
 *   (1) COMPUTED-WINS: a computed/read-only type classifies "computed" before ANY
 *       source marker is consulted (line 67 runs before 68/70). A derived value
 *       can never leak into YAML or the MDB regardless of a stray/forged source.
 *   (2) NO-SILENT-MDB-LEAK: an UNMARKED (or unknown-marked) file-backed-compatible
 *       column never resolves to "notidian" — it stays on the visible frontmatter
 *       layer. (Notidian-2j3: the fallback-to-notidian hole is closed for ALL
 *       shapes, not just the one pinned example.)
 *   (3) WRITE-TARGET TOTALITY: apiValueWriteTarget is a total function into
 *       {frontmatter, context, skip} — no input (including the adversarial axis)
 *       yields an out-of-enum value, and the computed->skip / frontmatter->
 *       frontmatter / notidian->context / file->defaultTarget mapping holds.
 *   (4) PREDICATE EXCLUSIVITY: shouldWriteAuthorityValueToFrontmatter and
 *       shouldPersistAuthorityValueToContext are mutually exclusive for EVERY
 *       shape — never both true. (The bead allows "documented overlaps"; the
 *       implementation has NONE, and this file pins that there are none, because
 *       a both-true state would mean one value is persisted to two homes.)
 *
 * Each failing assertion below corresponds to a concrete authority leak: an
 * unmarked file-backed column silently entering the hidden store, a computed
 * value being persisted, the identity column being rerouted, or a value being
 * double-written. Pure logic — no DOM, no I/O — provable by `npm test` + `tsc`.
 *
 * CONVENTION: a hand-rolled mulberry32 PRNG drives the randomized property runs
 * (matching tableRollup.property.test.ts / sanitizers.test.ts) — NO fast-check
 * dependency, fully reproducible across machines and CI.
 */
import { PathPropertyName } from "shared/types/context";
import {
  ApiValueWriteTarget,
  apiValueWriteTarget,
  notidianPropertySource,
  propertyAuthorityForColumn,
  PropertyAuthority,
  shouldPersistAuthorityValueToContext,
  shouldWriteAuthorityValueToFrontmatter,
} from "./propertyAuthority";

// ---------------------------------------------------------------------------
// Type-class fixtures. These MIRROR the private sets in propertyAuthority.ts;
// keep them aligned when that file changes (the self-consistency guards at the
// bottom catch a drift between this list and the live classifier's verdict).
// ---------------------------------------------------------------------------

// Derived/read-only types: value computed at render time, never persisted.
const COMPUTED_TYPES = ["fileprop", "aggregate", "rollup", "backlink"] as const;

// Types with a native frontmatter representation. A source-less column of one of
// these defaults to the durable FILE layer, not the hidden store.
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

// Context-only types: no frontmatter form, so the MDB is their only durable home;
// a source-less column of one of these is Notidian-owned by necessity.
const CONTEXT_ONLY_TYPES = ["context", "object", "flex", "super"] as const;

const ALL_KNOWN_TYPES = [
  ...COMPUTED_TYPES,
  ...FRONTMATTER_STORABLE_TYPES,
  ...CONTEXT_ONLY_TYPES,
] as const;

// The source axis, INCLUDING the adversarial unknown-string markers. The unknown
// markers must be treated EXACTLY as an absent marker (ignored) — they are NOT
// recognized as ownership grants, so they must never flip a frontmatter-storable
// column into the hidden store nor a context-only column out of it.
const UNKNOWN_SOURCE_STRINGS = [
  "context", // a tempting-but-unrecognized marker (the MDB layer's own name)
  "file",
  "computed",
  "external-plugin",
  "", // empty string: a present-but-blank marker
  "Frontmatter", // case variant — must NOT match the lowercase canonical
  "NOTIDIAN", // case variant — must NOT match
  "legacy",
] as const;

const KNOWN_SOURCES: ReadonlyArray<string | undefined> = [
  undefined,
  "frontmatter",
  notidianPropertySource,
];

const ALL_SOURCES: ReadonlyArray<string | undefined> = [
  ...KNOWN_SOURCES,
  ...UNKNOWN_SOURCE_STRINGS,
];

const BOTH_DEFAULTS = ["frontmatter", "context"] as const;
const LEGAL_AUTHORITIES: ReadonlySet<PropertyAuthority> = new Set<PropertyAuthority>([
  "file",
  "frontmatter",
  "notidian",
  "computed",
]);
const LEGAL_TARGETS: ReadonlySet<ApiValueWriteTarget> = new Set<ApiValueWriteTarget>([
  "frontmatter",
  "context",
  "skip",
]);

const isComputedType = (t: string) =>
  (COMPUTED_TYPES as readonly string[]).includes(t);
const isFrontmatterStorableType = (t: string) =>
  (FRONTMATTER_STORABLE_TYPES as readonly string[]).includes(t);

// A column whose `source` is neither the canonical "frontmatter" nor the
// canonical "notidian" marker (absent counts) is "unmarked for ownership".
const isOwnershipUnmarked = (source: string | undefined) =>
  source !== "frontmatter" && source !== notidianPropertySource;

// ---------------------------------------------------------------------------
// mulberry32 — tiny deterministic PRNG (no external dep, reproducible in CI).
// ---------------------------------------------------------------------------
const makeRng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)];
const PROPERTY_RUNS = 4000;

// ===========================================================================
// (1) COMPUTED-WINS — the type outranks every source marker.
// ===========================================================================
describe("(1) computed type wins over ANY source marker (precedence: line 67 before 68/70)", () => {
  it("classifies every computed type as 'computed' for every source value, incl. adversarial markers", () => {
    for (const type of COMPUTED_TYPES) {
      for (const source of ALL_SOURCES) {
        const col = { name: "derived", type, ...(source !== undefined ? { source } : {}) };
        // The whole point of resolving computedTypes BEFORE the source ladder:
        // even a forged `source: "frontmatter"`/`"notidian"`/unknown marker on a
        // derived column must not pull it out of the "computed" partition. Were
        // the source consulted first, a derived value would be persisted into
        // YAML or the MDB — the exact read-only-promise break (ADR 0001/0017).
        expect(propertyAuthorityForColumn(col)).toBe("computed");
      }
    }
  });

  it("a computed type still wins when the source is a stray known marker (the canonical leak vector)", () => {
    for (const type of COMPUTED_TYPES) {
      expect(propertyAuthorityForColumn({ name: "d", type, source: "frontmatter" })).toBe("computed");
      expect(propertyAuthorityForColumn({ name: "d", type, source: notidianPropertySource })).toBe("computed");
    }
  });

  it("computed always maps to skip at the write gate, for both verb defaults", () => {
    for (const type of COMPUTED_TYPES) {
      for (const source of ALL_SOURCES) {
        for (const defaultTarget of BOTH_DEFAULTS) {
          const col = { name: "d", type, ...(source !== undefined ? { source } : {}) };
          expect(apiValueWriteTarget(col, defaultTarget)).toBe("skip");
        }
      }
    }
  });
});

// ===========================================================================
// (2) NO-SILENT-MDB-LEAK — an unmarked (or unknown-marked) file-backed column
//     never silently flips into the hidden store. Generalizes Notidian-2j3.
// ===========================================================================
describe("(2) never silently flips an unmarked file-backed column into the hidden store (Notidian-2j3, all shapes)", () => {
  it("every frontmatter-storable type, source ABSENT, resolves to frontmatter (never notidian)", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      const auth = propertyAuthorityForColumn({ name: "x", type });
      expect(auth).toBe("frontmatter");
      expect(auth).not.toBe("notidian");
    }
  });

  it("every frontmatter-storable type with an UNKNOWN source string still resolves to frontmatter (unknown marker is ignored, never grants MDB ownership)", () => {
    // The adversarial axis the prior nets omit: a foreign/corrupt/legacy source
    // marker must be treated as absent — it is NOT the explicit "notidian"
    // ownership grant, so it cannot move a file-backed column into the hidden
    // store. A regression here (treating unknown markers as notidian) is a
    // silent MDB leak; the inverse (treating them as frontmatter for context-
    // only types) is covered by the context-only block below.
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      for (const source of UNKNOWN_SOURCE_STRINGS) {
        const auth = propertyAuthorityForColumn({ name: "x", type, source });
        expect(auth).toBe("frontmatter");
        expect(auth).not.toBe("notidian");
      }
    }
  });

  it("an unknown source string is treated IDENTICALLY to an absent source (it is not an ownership grant) for every known type", () => {
    // Equivalence proof: for any type, classifying with an unknown marker yields
    // the SAME authority as classifying with no marker at all. This is the crisp
    // statement of "unknown markers are ignored" and pins both directions at once.
    for (const type of ALL_KNOWN_TYPES) {
      const baseline = propertyAuthorityForColumn({ name: "x", type });
      for (const source of UNKNOWN_SOURCE_STRINGS) {
        expect(propertyAuthorityForColumn({ name: "x", type, source })).toBe(baseline);
      }
    }
  });

  it("context-only types stay notidian whether source is absent OR an unknown string (their MDB is the only durable home; an unknown marker must not strip it to frontmatter)", () => {
    for (const type of CONTEXT_ONLY_TYPES) {
      expect(propertyAuthorityForColumn({ name: "rel", type })).toBe("notidian");
      for (const source of UNKNOWN_SOURCE_STRINGS) {
        expect(propertyAuthorityForColumn({ name: "rel", type, source })).toBe("notidian");
      }
    }
  });

  it("at the write gate, an unmarked/unknown-marked file-backed column NEVER lands in context, even when the verb default was context", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      for (const source of [undefined, ...UNKNOWN_SOURCE_STRINGS]) {
        const col = { name: "x", type, ...(source !== undefined ? { source } : {}) };
        for (const defaultTarget of BOTH_DEFAULTS) {
          const target = apiValueWriteTarget(col, defaultTarget);
          expect(target).toBe("frontmatter");
          expect(target).not.toBe("context");
        }
      }
    }
  });

  it("durable MDB ownership of a file-backed-compatible type requires the EXACT canonical 'notidian' marker (case-sensitive)", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      // the exact marker grants it...
      expect(propertyAuthorityForColumn({ name: "x", type, source: notidianPropertySource })).toBe("notidian");
      // ...a case variant does NOT (it falls through to frontmatter).
      expect(propertyAuthorityForColumn({ name: "x", type, source: "NOTIDIAN" })).toBe("frontmatter");
      expect(propertyAuthorityForColumn({ name: "x", type, source: "Notidian" })).toBe("frontmatter");
    }
  });
});

// ===========================================================================
// File identity precedence — PathPropertyName outranks EVERYTHING (incl.
// computed type and any source). Untested edge before this file.
// ===========================================================================
describe("file identity (PathPropertyName) outranks every type and source", () => {
  it("resolves to 'file' regardless of type (even a computed type) and any source marker", () => {
    for (const type of [...ALL_KNOWN_TYPES, "file", "unknown-type"]) {
      for (const source of ALL_SOURCES) {
        const col = { name: PathPropertyName, type, ...(source !== undefined ? { source } : {}) };
        // Identity is the row's primary key; classifying it as anything else
        // would let the row's path be rewritten as a value into a storage layer.
        expect(propertyAuthorityForColumn(col)).toBe("file");
      }
    }
  });

  it("resolves to 'file' even with NO type and an explicit notidian/frontmatter marker", () => {
    expect(propertyAuthorityForColumn({ name: PathPropertyName })).toBe("file");
    expect(propertyAuthorityForColumn({ name: PathPropertyName, source: notidianPropertySource })).toBe("file");
    expect(propertyAuthorityForColumn({ name: PathPropertyName, source: "frontmatter" })).toBe("file");
  });

  it("at the write gate, the identity column preserves the verb default (never skip/reroute)", () => {
    for (const defaultTarget of BOTH_DEFAULTS) {
      const target = apiValueWriteTarget({ name: PathPropertyName, type: "file" }, defaultTarget);
      expect(target).toBe(defaultTarget);
      expect(target).not.toBe("skip");
    }
  });
});

// ===========================================================================
// (3) WRITE-TARGET TOTALITY — apiValueWriteTarget is total into the 3-value enum.
// ===========================================================================
describe("(3) apiValueWriteTarget is a total function into {frontmatter, context, skip}", () => {
  it("the mapping holds for every type x source x default: computed->skip, frontmatter->frontmatter, notidian->context, file->defaultTarget", () => {
    for (const type of ALL_KNOWN_TYPES) {
      for (const source of ALL_SOURCES) {
        for (const defaultTarget of BOTH_DEFAULTS) {
          const col = { name: "field", type, ...(source !== undefined ? { source } : {}) };
          const authority = propertyAuthorityForColumn(col);
          const target = apiValueWriteTarget(col, defaultTarget);

          expect(LEGAL_TARGETS.has(target)).toBe(true);
          // target is exactly determined by the resolved authority.
          if (authority === "computed") expect(target).toBe("skip");
          else if (authority === "frontmatter") expect(target).toBe("frontmatter");
          else if (authority === "notidian") expect(target).toBe("context");
          else expect(target).toBe(defaultTarget); // "file"
        }
      }
    }
  });

  it("an undefined property returns the verb default (and is always a legal target)", () => {
    for (const defaultTarget of BOTH_DEFAULTS) {
      const target = apiValueWriteTarget(undefined, defaultTarget);
      expect(target).toBe(defaultTarget);
      expect(LEGAL_TARGETS.has(target)).toBe(true);
    }
  });

  it("the file identity column returns the verb default for both defaults", () => {
    for (const defaultTarget of BOTH_DEFAULTS) {
      expect(apiValueWriteTarget({ name: PathPropertyName, type: "file" }, defaultTarget)).toBe(defaultTarget);
    }
  });

  it("returns 'skip' IFF the resolved authority is 'computed' (both directions)", () => {
    for (const type of ALL_KNOWN_TYPES) {
      for (const source of ALL_SOURCES) {
        for (const defaultTarget of BOTH_DEFAULTS) {
          const col = { name: "f", type, ...(source !== undefined ? { source } : {}) };
          const skipped = apiValueWriteTarget(col, defaultTarget) === "skip";
          expect(skipped).toBe(propertyAuthorityForColumn(col) === "computed");
        }
      }
    }
  });
});

// ===========================================================================
// (4) PREDICATE EXCLUSIVITY — the two booleans never both fire.
// ===========================================================================
describe("(4) shouldWriteAuthorityValueToFrontmatter and shouldPersistAuthorityValueToContext are mutually exclusive", () => {
  it("never both true for ANY type x source shape (a both-true state would double-write one value to two homes)", () => {
    for (const type of ALL_KNOWN_TYPES) {
      for (const source of ALL_SOURCES) {
        const col = { name: "f", type, ...(source !== undefined ? { source } : {}) };
        const fm = shouldWriteAuthorityValueToFrontmatter(col);
        const ctx = shouldPersistAuthorityValueToContext(col);
        // Mutual exclusivity: at most one durable home per value. There are NO
        // documented overlaps in this implementation — both-true is impossible.
        expect(fm && ctx).toBe(false);
      }
    }
  });

  it("holds for the file identity column and for an unmarked/typeless column too", () => {
    const file = { name: PathPropertyName, type: "file" };
    expect(shouldWriteAuthorityValueToFrontmatter(file) && shouldPersistAuthorityValueToContext(file)).toBe(false);
    // file -> persists to context (it is a durable, non-frontmatter authority).
    expect(shouldWriteAuthorityValueToFrontmatter(file)).toBe(false);
    expect(shouldPersistAuthorityValueToContext(file)).toBe(true);

    const typeless = { name: "ghost" };
    expect(shouldWriteAuthorityValueToFrontmatter(typeless) && shouldPersistAuthorityValueToContext(typeless)).toBe(false);
  });

  it("each predicate agrees EXACTLY with the resolved authority partition (no drift between predicate and classifier)", () => {
    for (const type of ALL_KNOWN_TYPES) {
      for (const source of ALL_SOURCES) {
        const col = { name: "f", type, ...(source !== undefined ? { source } : {}) };
        const authority = propertyAuthorityForColumn(col);
        // shouldWrite...Frontmatter <-> authority is exactly "frontmatter".
        expect(shouldWriteAuthorityValueToFrontmatter(col)).toBe(authority === "frontmatter");
        // shouldPersist...Context <-> authority is "file" OR "notidian".
        expect(shouldPersistAuthorityValueToContext(col)).toBe(
          authority === "file" || authority === "notidian"
        );
      }
    }
  });

  it("computed columns trigger NEITHER predicate (a derived value is persisted to no durable home)", () => {
    for (const type of COMPUTED_TYPES) {
      for (const source of ALL_SOURCES) {
        const col = { name: "d", type, ...(source !== undefined ? { source } : {}) };
        expect(shouldWriteAuthorityValueToFrontmatter(col)).toBe(false);
        expect(shouldPersistAuthorityValueToContext(col)).toBe(false);
      }
    }
  });
});

// ===========================================================================
// PROPERTY RUNS — seeded, reproducible. Hammer the whole resolver/gate/predicate
// stack with randomized shapes (incl. the adversarial source axis) to assert the
// joint invariants that bind all four surfaces together.
// ===========================================================================
describe("property: randomized shapes preserve every authority invariant (seeded mulberry32)", () => {
  const SHAPE_TYPES = [...ALL_KNOWN_TYPES, "file", "unknown-type"] as const;
  const SHAPE_NAMES = [PathPropertyName, "field", "x", "rel", "derived", "owned"] as const;

  it(`holds across ${PROPERTY_RUNS} random shapes for several seeds`, () => {
    // Accumulate any violation with its full shape context. `.withContext` is a
    // Jasmine-only API not available in this Jest runner, so we surface the
    // offending shape by failing on a non-empty violation list instead.
    const violations: string[] = [];
    const fail = (col: unknown, msg: string) =>
      violations.push(`${msg} | col=${JSON.stringify(col)}`);

    for (const seed of [1, 7, 42, 1337, 90210]) {
      const rng = makeRng(seed);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const name = pick(rng, SHAPE_NAMES);
        const type = pick(rng, SHAPE_TYPES);
        const source = pick(rng, ALL_SOURCES);
        const includeType = rng() < 0.85; // sometimes omit type entirely
        const col: Record<string, string> = { name };
        if (includeType) col.type = type;
        if (source !== undefined) col.source = source;

        const authority = propertyAuthorityForColumn(col);
        const fm = shouldWriteAuthorityValueToFrontmatter(col);
        const ctx = shouldPersistAuthorityValueToContext(col);

        // --- authority is always one of the four legal partitions.
        if (!LEGAL_AUTHORITIES.has(authority))
          fail(col, `illegal authority "${authority}"`);

        // --- file identity outranks everything.
        if (name === PathPropertyName && authority !== "file")
          fail(col, `identity column not classified file (got "${authority}")`);

        // --- computed-wins (only reachable for a non-identity column).
        if (
          name !== PathPropertyName &&
          includeType &&
          isComputedType(type) &&
          authority !== "computed"
        )
          fail(col, `computed type not classified computed (got "${authority}")`);

        // --- NO-SILENT-MDB-LEAK: a non-identity, non-computed,
        // frontmatter-storable type that is NOT explicitly marked notidian must
        // resolve to frontmatter, never notidian.
        if (
          name !== PathPropertyName &&
          includeType &&
          isFrontmatterStorableType(type) &&
          source !== notidianPropertySource &&
          authority !== "frontmatter"
        )
          fail(col, `SILENT-MDB-LEAK: unmarked file-backed type -> "${authority}"`);

        // --- unknown markers are ignored: same authority as no marker.
        if (isOwnershipUnmarked(source)) {
          const bare: Record<string, string> = { name };
          if (includeType) bare.type = type;
          const bareAuthority = propertyAuthorityForColumn(bare);
          if (authority !== bareAuthority)
            fail(col, `unknown marker changed authority: "${bareAuthority}" -> "${authority}"`);
        }

        // --- predicates mutually exclusive and consistent with authority.
        if (fm && ctx) fail(col, `both predicates true (double-write) authority="${authority}"`);
        if (fm !== (authority === "frontmatter"))
          fail(col, `frontmatter predicate disagrees with authority "${authority}"`);
        if (ctx !== (authority === "file" || authority === "notidian"))
          fail(col, `context predicate disagrees with authority "${authority}"`);

        // --- write gate is total and matches the authority for both defaults.
        for (const defaultTarget of BOTH_DEFAULTS) {
          const target = apiValueWriteTarget(col, defaultTarget);
          if (!LEGAL_TARGETS.has(target))
            fail(col, `illegal write target "${target}" (default=${defaultTarget})`);
          const expected =
            authority === "computed"
              ? "skip"
              : authority === "frontmatter"
              ? "frontmatter"
              : authority === "notidian"
              ? "context"
              : defaultTarget; // file
          if (target !== expected)
            fail(
              col,
              `write target "${target}" != expected "${expected}" (authority="${authority}", default=${defaultTarget})`
            );
        }
      }
    }

    // A single empty-list assertion: jest prints the first offending shapes.
    expect(violations.slice(0, 10)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});

// ===========================================================================
// SELF-CONSISTENCY GUARDS — these catch a DRIFT between the fixtures above and
// the live classifier (e.g. a NEW computed type added to propertyAuthority.ts
// but forgotten here), so the property nets above can never be vacuously green.
// ===========================================================================
describe("self-consistency: fixtures still match the live classifier", () => {
  it("every COMPUTED_TYPES fixture actually classifies 'computed'", () => {
    for (const type of COMPUTED_TYPES) {
      expect(propertyAuthorityForColumn({ name: "x", type })).toBe("computed");
    }
  });

  it("every FRONTMATTER_STORABLE_TYPES fixture (source-less) actually classifies 'frontmatter'", () => {
    for (const type of FRONTMATTER_STORABLE_TYPES) {
      expect(propertyAuthorityForColumn({ name: "x", type })).toBe("frontmatter");
    }
  });

  it("every CONTEXT_ONLY_TYPES fixture (source-less) actually classifies 'notidian'", () => {
    for (const type of CONTEXT_ONLY_TYPES) {
      expect(propertyAuthorityForColumn({ name: "x", type })).toBe("notidian");
    }
  });

  it("the UNKNOWN_SOURCE_STRINGS are genuinely unrecognized (none equals a canonical marker)", () => {
    for (const source of UNKNOWN_SOURCE_STRINGS) {
      expect(source).not.toBe("frontmatter");
      expect(source).not.toBe(notidianPropertySource);
    }
  });
});
