/**
 * bd Notidian-n6xz — property tests for authority-precedence totality and
 * consistency.
 *
 * Unlike the fixed-fixture precedence net (propertyAuthority.precedence.test.ts,
 * Notidian-qr4), this file generates TRULY RANDOM SpaceProperty-shaped objects
 * — arbitrary string names, arbitrary string types (including values never seen
 * in production), and arbitrary source markers — then asserts the six stated
 * invariants over 2000+ generated columns. The goal is to prove that the
 * classifier is a total, consistent function for EVERY possible input shape, not
 * just the known-type universe.
 *
 * Invariants verified:
 *   (1) TOTALITY — result is always one of file/frontmatter/notidian/computed;
 *       the function never throws and never returns undefined.
 *   (2) COMPUTED DOMINANCE — computedTypes (fileprop/aggregate/rollup/backlink)
 *       always resolve to "computed" regardless of source marker value.
 *   (3) apiValueWriteTarget CONSISTENCY — the write target is always consistent
 *       with the resolved authority (computed->skip, frontmatter->frontmatter,
 *       notidian->context, file->defaultTarget).
 *   (4) shouldWriteAuthorityValueToFrontmatter CONSISTENCY — true IFF authority
 *       is exactly "frontmatter".
 *   (5) shouldPersistAuthorityValueToContext CONSISTENCY — true IFF authority is
 *       "file" or "notidian".
 *   (6) PathPropertyName ALWAYS FILE — the identity column resolves to "file"
 *       regardless of type or source.
 *
 * CONVENTION: hand-rolled mulberry32 PRNG (matching other property tests in this
 * codebase) — no fast-check dependency, fully reproducible across machines.
 */
import { PathPropertyName } from "shared/types/context";
import {
  ApiValueWriteTarget,
  apiValueWriteTarget,
  notidianPropertySource,
  PropertyAuthority,
  propertyAuthorityForColumn,
  shouldPersistAuthorityValueToContext,
  shouldWriteAuthorityValueToFrontmatter,
} from "./propertyAuthority";

// ---------------------------------------------------------------------------
// Deterministic PRNG: mulberry32
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

// Generate a random string of 1-12 chars from a-z, A-Z, 0-9, hyphen, underscore.
const randomString = (rng: () => number): string => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const len = 1 + Math.floor(rng() * 12);
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
};

// ---------------------------------------------------------------------------
// Input generators
// ---------------------------------------------------------------------------

// Known type strings (all types referenced in propertyAuthority.ts).
const KNOWN_TYPES = [
  "fileprop", "aggregate", "rollup", "backlink",       // computed
  "text", "password", "number", "boolean", "date",     // frontmatter-storable
  "option", "option-multi", "link", "image", "tags-multi",
  "context", "object", "flex", "super",                // context-only
  "unknown",                                           // a known-unknown
] as const;

const COMPUTED_TYPES = new Set(["fileprop", "aggregate", "rollup", "backlink"]);

// Sources: undefined, the two canonical markers, plus random strings.
const CANONICAL_SOURCES: ReadonlyArray<string | undefined> = [
  undefined,
  "frontmatter",
  notidianPropertySource,
];

// Generate a random name: either PathPropertyName or a random string.
const randomName = (rng: () => number): string =>
  rng() < 0.15 ? PathPropertyName : randomString(rng);

// Generate a random type: one of the known types OR a random string.
const randomType = (rng: () => number): string =>
  rng() < 0.7 ? pick(rng, KNOWN_TYPES) : randomString(rng);

// Generate a random source: undefined, canonical, or random string.
const randomSource = (rng: () => number): string | undefined => {
  const r = rng();
  if (r < 0.2) return undefined;
  if (r < 0.5) return pick(rng, CANONICAL_SOURCES);
  return randomString(rng);
};

// Generate a random SpaceProperty-shaped column.
const randomColumn = (rng: () => number): Record<string, string> => {
  const col: Record<string, string> = { name: randomName(rng) };
  // Sometimes omit type entirely (~10% of cases).
  if (rng() < 0.9) col.type = randomType(rng);
  // Source: sometimes omit (~30%), sometimes set.
  const src = randomSource(rng);
  if (src !== undefined) col.source = src;
  return col;
};

// ---------------------------------------------------------------------------
// Legal value sets
// ---------------------------------------------------------------------------
const LEGAL_AUTHORITIES = new Set<PropertyAuthority>([
  "file",
  "frontmatter",
  "notidian",
  "computed",
]);

const LEGAL_TARGETS = new Set<ApiValueWriteTarget>([
  "frontmatter",
  "context",
  "skip",
]);

const BOTH_DEFAULTS = ["frontmatter", "context"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the expected write target from a resolved authority. */
const expectedTarget = (
  authority: PropertyAuthority,
  defaultTarget: "frontmatter" | "context"
): ApiValueWriteTarget => {
  if (authority === "computed") return "skip";
  if (authority === "frontmatter") return "frontmatter";
  if (authority === "notidian") return "context";
  return defaultTarget; // "file"
};

// ===========================================================================
// (1) TOTALITY — never throws, always returns a legal authority.
// ===========================================================================
describe("(1) totality: propertyAuthorityForColumn never throws and always returns a legal authority", () => {
  const RUNS = 3000;

  it(`returns one of file/frontmatter/notidian/computed for ${RUNS} random columns`, () => {
    const violations: string[] = [];
    for (const seed of [1, 42, 999, 65536]) {
      const rng = makeRng(seed);
      for (let i = 0; i < RUNS; i++) {
        const col = randomColumn(rng);
        let authority: PropertyAuthority;
        try {
          authority = propertyAuthorityForColumn(col);
        } catch (e) {
          violations.push(`THREW for col=${JSON.stringify(col)}: ${e}`);
          continue;
        }
        if (!LEGAL_AUTHORITIES.has(authority)) {
          violations.push(
            `illegal authority "${authority}" for col=${JSON.stringify(col)}`
          );
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations.length).toBe(0);
  });

  it("handles degenerate inputs: undefined, empty object, name-only", () => {
    // These are all reachable via Partial<Pick<SpaceProperty, ...>>
    expect(LEGAL_AUTHORITIES.has(propertyAuthorityForColumn(undefined))).toBe(true);
    expect(LEGAL_AUTHORITIES.has(propertyAuthorityForColumn({}))).toBe(true);
    expect(LEGAL_AUTHORITIES.has(propertyAuthorityForColumn({ name: "x" }))).toBe(true);
    expect(LEGAL_AUTHORITIES.has(propertyAuthorityForColumn({ name: "" }))).toBe(true);
    expect(LEGAL_AUTHORITIES.has(propertyAuthorityForColumn({ type: "text" }))).toBe(true);
  });
});

// ===========================================================================
// (2) COMPUTED DOMINANCE — computedTypes always resolve to "computed".
// ===========================================================================
describe("(2) computed dominance: computed types resolve to computed regardless of source", () => {
  const RUNS = 2000;

  it(`computed types classify as "computed" with ${RUNS} random source/name combinations`, () => {
    const violations: string[] = [];
    for (const seed of [7, 314, 2718]) {
      const rng = makeRng(seed);
      for (let i = 0; i < RUNS; i++) {
        const type = pick(rng, [...COMPUTED_TYPES]);
        const name = randomName(rng);
        const source = randomSource(rng);
        const col: Record<string, string> = { name, type };
        if (source !== undefined) col.source = source;

        // PathPropertyName takes precedence over computed — that is invariant (6).
        // For non-identity names, computed must always win.
        if (name !== PathPropertyName) {
          const authority = propertyAuthorityForColumn(col);
          if (authority !== "computed") {
            violations.push(
              `computed type "${type}" got authority "${authority}" | col=${JSON.stringify(col)}`
            );
          }
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations.length).toBe(0);
  });

  it("computed dominance holds even with adversarial source strings", () => {
    const adversarial = [
      "frontmatter", notidianPropertySource, "Frontmatter", "NOTIDIAN",
      "", "context", "file", "computed", "legacy", "external",
    ];
    for (const type of COMPUTED_TYPES) {
      for (const source of adversarial) {
        expect(
          propertyAuthorityForColumn({ name: "x", type, source })
        ).toBe("computed");
      }
    }
  });
});

// ===========================================================================
// (3) apiValueWriteTarget CONSISTENCY with authority.
// ===========================================================================
describe("(3) apiValueWriteTarget is consistent with the resolved authority", () => {
  const RUNS = 2500;

  it(`write target matches authority for ${RUNS} random columns and both verb defaults`, () => {
    const violations: string[] = [];
    for (const seed of [100, 200, 300]) {
      const rng = makeRng(seed);
      for (let i = 0; i < RUNS; i++) {
        const col = randomColumn(rng);
        const authority = propertyAuthorityForColumn(col);
        for (const defaultTarget of BOTH_DEFAULTS) {
          const target = apiValueWriteTarget(col, defaultTarget);
          if (!LEGAL_TARGETS.has(target)) {
            violations.push(
              `illegal target "${target}" | col=${JSON.stringify(col)}, default=${defaultTarget}`
            );
            continue;
          }
          const expected = expectedTarget(authority, defaultTarget);
          if (target !== expected) {
            violations.push(
              `target "${target}" != expected "${expected}" (authority="${authority}") | col=${JSON.stringify(col)}, default=${defaultTarget}`
            );
          }
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations.length).toBe(0);
  });

  it("undefined property always returns the verb default", () => {
    for (const defaultTarget of BOTH_DEFAULTS) {
      expect(apiValueWriteTarget(undefined, defaultTarget)).toBe(defaultTarget);
    }
  });
});

// ===========================================================================
// (4) shouldWriteAuthorityValueToFrontmatter CONSISTENCY.
// ===========================================================================
describe("(4) shouldWriteAuthorityValueToFrontmatter is consistent with authority", () => {
  const RUNS = 2500;

  it(`returns true IFF authority is "frontmatter" for ${RUNS} random columns`, () => {
    const violations: string[] = [];
    for (const seed of [11, 22, 33]) {
      const rng = makeRng(seed);
      for (let i = 0; i < RUNS; i++) {
        const col = randomColumn(rng);
        const authority = propertyAuthorityForColumn(col);
        const result = shouldWriteAuthorityValueToFrontmatter(col);
        const expected = authority === "frontmatter";
        if (result !== expected) {
          violations.push(
            `shouldWrite...Frontmatter=${result} but authority="${authority}" (expected ${expected}) | col=${JSON.stringify(col)}`
          );
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});

// ===========================================================================
// (5) shouldPersistAuthorityValueToContext CONSISTENCY.
// ===========================================================================
describe("(5) shouldPersistAuthorityValueToContext is consistent with authority", () => {
  const RUNS = 2500;

  it(`returns true IFF authority is "file" or "notidian" for ${RUNS} random columns`, () => {
    const violations: string[] = [];
    for (const seed of [44, 55, 66]) {
      const rng = makeRng(seed);
      for (let i = 0; i < RUNS; i++) {
        const col = randomColumn(rng);
        const authority = propertyAuthorityForColumn(col);
        const result = shouldPersistAuthorityValueToContext(col);
        const expected = authority === "file" || authority === "notidian";
        if (result !== expected) {
          violations.push(
            `shouldPersist...Context=${result} but authority="${authority}" (expected ${expected}) | col=${JSON.stringify(col)}`
          );
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations.length).toBe(0);
  });

  it("the two predicates are mutually exclusive for all random columns", () => {
    const violations: string[] = [];
    const rng = makeRng(77);
    for (let i = 0; i < 2000; i++) {
      const col = randomColumn(rng);
      const fm = shouldWriteAuthorityValueToFrontmatter(col);
      const ctx = shouldPersistAuthorityValueToContext(col);
      if (fm && ctx) {
        violations.push(
          `BOTH true (double-write) | col=${JSON.stringify(col)}`
        );
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});

// ===========================================================================
// (6) PathPropertyName ALWAYS resolves to "file".
// ===========================================================================
describe("(6) PathPropertyName always resolves to file authority", () => {
  const RUNS = 2000;

  it(`PathPropertyName is "file" for ${RUNS} random type/source combinations`, () => {
    const violations: string[] = [];
    for (const seed of [111, 222, 333]) {
      const rng = makeRng(seed);
      for (let i = 0; i < RUNS; i++) {
        const col: Record<string, string> = { name: PathPropertyName };
        // Random type, sometimes omitted.
        if (rng() < 0.9) col.type = randomType(rng);
        // Random source, sometimes omitted.
        const src = randomSource(rng);
        if (src !== undefined) col.source = src;

        const authority = propertyAuthorityForColumn(col);
        if (authority !== "file") {
          violations.push(
            `PathPropertyName got authority "${authority}" | col=${JSON.stringify(col)}`
          );
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations.length).toBe(0);
  });

  it("PathPropertyName is file even with computed types and explicit source markers", () => {
    for (const type of COMPUTED_TYPES) {
      expect(
        propertyAuthorityForColumn({
          name: PathPropertyName,
          type,
          source: "frontmatter",
        })
      ).toBe("file");
      expect(
        propertyAuthorityForColumn({
          name: PathPropertyName,
          type,
          source: notidianPropertySource,
        })
      ).toBe("file");
    }
  });

  it("PathPropertyName write target preserves verb default (never skip)", () => {
    for (const defaultTarget of BOTH_DEFAULTS) {
      const target = apiValueWriteTarget(
        { name: PathPropertyName, type: "file" },
        defaultTarget
      );
      expect(target).toBe(defaultTarget);
    }
  });
});

// ===========================================================================
// COMBINED PROPERTY RUN — all 6 invariants verified jointly on each shape.
// ===========================================================================
describe("combined property run: all 6 invariants jointly on random shapes", () => {
  const TOTAL_RUNS = 5000;

  it(`verifies all 6 invariants across ${TOTAL_RUNS} random shapes`, () => {
    const violations: string[] = [];
    const fail = (col: unknown, msg: string) =>
      violations.push(`${msg} | col=${JSON.stringify(col)}`);

    for (const seed of [1, 7, 42, 1337, 90210]) {
      const rng = makeRng(seed);
      for (let i = 0; i < TOTAL_RUNS / 5; i++) {
        const col = randomColumn(rng);
        const name = col.name;
        const type = col.type;

        let authority: PropertyAuthority;
        try {
          authority = propertyAuthorityForColumn(col);
        } catch (e) {
          fail(col, `THREW: ${e}`);
          continue;
        }

        // (1) TOTALITY
        if (!LEGAL_AUTHORITIES.has(authority))
          fail(col, `(1) illegal authority "${authority}"`);

        // (6) PathPropertyName always file
        if (name === PathPropertyName && authority !== "file")
          fail(col, `(6) PathPropertyName not "file" (got "${authority}")`);

        // (2) COMPUTED DOMINANCE (non-identity names only)
        if (
          name !== PathPropertyName &&
          type !== undefined &&
          COMPUTED_TYPES.has(type) &&
          authority !== "computed"
        )
          fail(col, `(2) computed type "${type}" not "computed" (got "${authority}")`);

        // (3) apiValueWriteTarget consistency
        for (const defaultTarget of BOTH_DEFAULTS) {
          const target = apiValueWriteTarget(col, defaultTarget);
          if (!LEGAL_TARGETS.has(target))
            fail(col, `(3) illegal target "${target}"`);
          const expected = expectedTarget(authority, defaultTarget);
          if (target !== expected)
            fail(
              col,
              `(3) target "${target}" != "${expected}" (authority="${authority}", default=${defaultTarget})`
            );
        }

        // (4) shouldWriteAuthorityValueToFrontmatter consistency
        const fm = shouldWriteAuthorityValueToFrontmatter(col);
        if (fm !== (authority === "frontmatter"))
          fail(col, `(4) frontmatter predicate ${fm} vs authority "${authority}"`);

        // (5) shouldPersistAuthorityValueToContext consistency
        const ctx = shouldPersistAuthorityValueToContext(col);
        if (ctx !== (authority === "file" || authority === "notidian"))
          fail(col, `(5) context predicate ${ctx} vs authority "${authority}"`);

        // (4+5) mutual exclusivity
        if (fm && ctx)
          fail(col, `(4+5) both predicates true (double-write)`);
      }
    }

    expect(violations.slice(0, 10)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});
