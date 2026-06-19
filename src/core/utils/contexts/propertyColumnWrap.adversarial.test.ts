// ===========================================================================
// ADVERSARIAL + PROPERTY LOCK for the per-column text-wrap normalizer
// (Notidian-zhcw). propertyColumnWrap.ts's columnWrapModeForValue is the pure
// FAIL-SAFE that guards the per-column wrap toggle shipped in 21a6cdf. It reads
// values out of Predicate.colsWrap (`colsWrap?: Record<string, ColumnWrapMode>`,
// shared/types/predicate.ts) — persisted Notidian view state, which is
// corruption- and attacker-reachable (a hand-edited / migrated / partially
// written context MDB can carry ANY shape there). The normalizer's whole job is
// to coerce any such persisted value back to a valid ColumnWrapMode
// ('clip' | 'wrap'), defaulting to the Notion-style single-line 'clip', so a
// corrupt persisted value can never leak an out-of-domain wrap mode into the
// render path. It shipped with NO test lock; this file is the lock.
//
// CHARACTERIZATION, NOT CORRECTION. Every assertion LOCKS the current observed
// behaviour (probed exhaustively against the live implementation before writing,
// see the empirical sweep in the bead). No production code is changed. This is a
// pure, offline test-depth bead (NO render-path change), so per AGENTS.md it is
// not flag-gated.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency, matching tableRowOrder.property.test.ts / tableRollup.property.test.ts.
//
// THE CONTRACT PINNED:
//   PASSTHROUGH   the two valid modes ('clip', 'wrap') return themselves verbatim.
//   FAIL-SAFE     EVERY junk value (undefined / null / '' / wrong-case 'WRAP' /
//                 numbers / booleans / objects / arrays / prototype-pollution
//                 keys / symbols / boxed primitives) coerces to
//                 defaultColumnWrapMode ('clip').
//   DOMAIN        columnWrapModes has EXACTLY the two members, in order, and the
//                 default is one of them.
//   PROPERTY      for ARBITRARY input, the output is ALWAYS a member of
//                 columnWrapModes — the normalizer is total and closed over its
//                 own domain (this is the invariant no example case can express).
// ===========================================================================
import {
  columnWrapModeForValue,
  columnWrapModes,
  defaultColumnWrapMode,
} from "./propertyColumnWrap";
import type { ColumnWrapMode } from "shared/types/predicate";

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: fast, well-distributed, fully deterministic 32-bit generator so
// the property runs are reproducible across machines/CI without a fixture file.
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

const PROPERTY_RUNS = 5000;

describe("columnWrapModes / defaultColumnWrapMode (domain)", () => {
  it("has exactly the two valid wrap modes, in Notion order", () => {
    expect(columnWrapModes).toEqual(["clip", "wrap"]);
    // Length is pinned separately so an added/removed member fails loudly even
    // if a future edit happened to keep the first two entries.
    expect(columnWrapModes).toHaveLength(2);
    expect(new Set(columnWrapModes).size).toBe(2);
  });

  it("defaults to 'clip' (single-line), which is itself a valid mode", () => {
    expect(defaultColumnWrapMode).toBe("clip");
    expect(columnWrapModes).toContain(defaultColumnWrapMode);
  });
});

describe("columnWrapModeForValue — valid passthrough", () => {
  it.each(columnWrapModes)("returns %s unchanged", (mode) => {
    expect(columnWrapModeForValue(mode)).toBe(mode);
  });
});

describe("columnWrapModeForValue — fail-safe coercion of corrupt persisted state", () => {
  // Every entry models a way the persisted `colsWrap[col]` could be malformed:
  // missing/null, empty, wrong-case, wrong primitive type, wrong container, or a
  // prototype-pollution-shaped key. ALL must collapse to defaultColumnWrapMode.
  const junk: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace string", "   "],
    ["wrong-case WRAP", "WRAP"],
    ["wrong-case Clip", "Clip"],
    ["leading-space ' wrap'", " wrap"],
    ["trailing-space 'wrap '", "wrap "],
    ["substring 'wra'", "wra"],
    ["unrelated string", "nowrap"],
    ["legacy boolean-ish 'true'", "true"],
    ["number 0", 0],
    ["number 1", 1],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["boolean true", true],
    ["boolean false", false],
    ["empty object", {}],
    ["object with mode field", { mode: "wrap" }],
    ["empty array", []],
    ["array of valid mode", ["wrap"]],
    ["nested array", [["clip"]]],
    ["bigint", BigInt(1)],
    ["symbol", Symbol("wrap")],
    ["function", () => "wrap"],
    ["Date", new Date()],
    ["boxed String('wrap')", new String("wrap")],
    ["boxed Number(1)", new Number(1)],
    // Prototype-pollution-shaped payloads: the persisted record could carry a
    // value parsed from JSON like {"__proto__":"wrap"} or a crafted object whose
    // own/inherited keys try to smuggle a mode through. The normalizer must read
    // the VALUE, never honour these keys.
    ["__proto__-keyed object", JSON.parse('{"__proto__":"wrap"}')],
    ["object literal __proto__ value", { ["__proto__"]: "wrap" }],
    ["constructor string", "constructor"],
    ["prototype string", "prototype"],
    ["__proto__ string", "__proto__"],
    [
      "object null-proto with mode",
      Object.assign(Object.create(null), { mode: "wrap" }),
    ],
  ];

  it.each(junk)("coerces %s to defaultColumnWrapMode", (_label, value) => {
    expect(columnWrapModeForValue(value)).toBe(defaultColumnWrapMode);
  });

  it("coerces a missing argument to defaultColumnWrapMode", () => {
    expect(columnWrapModeForValue()).toBe(defaultColumnWrapMode);
  });

  it("never lets a prototype-pollution payload mutate or leak through the domain", () => {
    const before = [...columnWrapModes];
    columnWrapModeForValue(JSON.parse('{"__proto__":{"wrap":"wrap"}}'));
    // No global Object.prototype pollution, and the domain is unchanged.
    expect(({} as Record<string, unknown>).wrap).toBeUndefined();
    expect(columnWrapModes).toEqual(before);
  });
});

describe("columnWrapModeForValue — PROPERTY: output is always a valid wrap mode", () => {
  const modeSet = new Set<ColumnWrapMode>(columnWrapModes);

  // A generator of adversarial inputs spanning every JS shape a corrupt
  // persisted value could take, including ~1/8 of the time one of the two VALID
  // modes (so the passthrough branch is exercised inside the same loop).
  const randomValue = (rng: () => number): unknown => {
    const pick = Math.floor(rng() * 14);
    switch (pick) {
      case 0:
        return undefined;
      case 1:
        return null;
      case 2:
        // Sometimes a valid mode, sometimes a near-miss (case/space mutation).
        return columnWrapModes[Math.floor(rng() * columnWrapModes.length)];
      case 3: {
        const base =
          columnWrapModes[Math.floor(rng() * columnWrapModes.length)];
        return rng() < 0.5 ? base.toUpperCase() : ` ${base} `;
      }
      case 4:
        return Math.floor(rng() * 200) - 100;
      case 5:
        return rng() * 1e6 - 5e5;
      case 6:
        return rng() < 0.5;
      case 7:
        return rng() < 0.5 ? "" : Math.random().toString(36).slice(2);
      case 8:
        return {};
      case 9:
        return { mode: rng() < 0.5 ? "wrap" : "clip" };
      case 10:
        return rng() < 0.5 ? [] : [columnWrapModes[0]];
      case 11:
        return JSON.parse('{"__proto__":"wrap"}');
      case 12:
        return Symbol("x");
      default:
        return NaN;
    }
  };

  it("returns a member of columnWrapModes for every random input", () => {
    const rng = makeRng(0x5eed_c0de);
    for (let i = 0; i < PROPERTY_RUNS; i += 1) {
      const input = randomValue(rng);
      const out = columnWrapModeForValue(input);
      expect(modeSet.has(out)).toBe(true);
    }
  });

  it("is idempotent: feeding its own output back yields the same mode", () => {
    const rng = makeRng(0xabad_1dea);
    for (let i = 0; i < PROPERTY_RUNS; i += 1) {
      const once = columnWrapModeForValue(randomValue(rng));
      expect(columnWrapModeForValue(once)).toBe(once);
    }
  });
});
