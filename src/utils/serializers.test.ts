import {
  serializeMultiDisplayString,
  serializeMultiString,
  serializeSQLFieldNames,
  serializeSQLStatements,
  serializeSQLValues,
} from "./serializers";
import { parseMultiDisplayString, parseMultiString } from "./parsers";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — property + characterization net for src/utils/serializers.ts
// (Notidian-a3s). This one-line module had ZERO co-located coverage yet its
// functions are load-bearing across ~12 data-authority call sites:
//
//   serializeMultiDisplayString — the human-facing comma-joined form. Backs
//     lookup.ts inlinks/outlinks/tags/spaces, label.ts aliases, LinkCell /
//     optionCellModel display writes, and parseProperty's duration branch.
//   serializeMultiString — the durable JSON-array form. Backs LinkCell /
//     TagCell / ImageCell saves, context.ts add/remove, links.ts rename/
//     delete, lookup.ts paths, query.ts outlinks/inlinks/tags, FilterBar.
//   serializeSQLValues / Statements / FieldNames — the MDB SQL assembly join
//     primitives in adapters/mdb/db/db.ts (VALUES "(, )" lists, ";" statement
//     batching, "," field-name lists).
//
// Everything here is pure / offline — no vault, no DOM, no I/O.
//
// HISTORY — this began as a CHARACTERIZATION net that LOCKED the present
// behaviour (including a confirmed first-comma-only data-loss defect) so a fix
// would be a deliberate, reviewable FLIP. ADR 0030 (Option A, Notidian-od7) has
// now landed that fix: serializeMultiDisplayString escapes EVERY comma and
// parseMultiDisplayString un-escapes EVERY '\,' after the split, so the display
// form round-trips losslessly for all values. The assertions that pinned the
// defect have been deliberately flipped below to assert the corrected behaviour;
// the comma-free-identity property net remains the regression guard for the
// common path, and the flipped assertions guard the parser-order subtlety
// (un-escape MUST happen after the split). Each assertion was verified against
// the live functions.
// ---------------------------------------------------------------------------

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: a fast, well-distributed, fully deterministic 32-bit generator so
// property runs are reproducible across machines/CI without a fixture file.
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
const PROPERTY_RUNS = 300;

// A pool of comma-free tokens (incl. whitespace-padded, unicode, JSON-special)
// used to build random comma-free element arrays. Comma-free is the regime in
// which serializeMultiDisplayString <-> parseMultiDisplayString round-trips
// faithfully; the comma regime is characterized separately below.
const COMMA_FREE_POOL = [
  "a",
  "alpha",
  "b2",
  "Tag",
  "with space",
  "  padded  ",
  "ünïcödé",
  "[brackets]",
  '"quote"',
  "\\backslash",
  "emoji😀",
  "123",
  "spaces://x+y",
  "#hash",
];
const randCommaFreeArray = (rng: () => number, maxLen = 8): string[] => {
  const len = randInt(rng, 0, maxLen);
  return Array.from(
    { length: len },
    () => COMMA_FREE_POOL[randInt(rng, 0, COMMA_FREE_POOL.length - 1)]
  );
};

// =========================================================================
// serializeMultiDisplayString  (display/comma form)
// =========================================================================
describe("serializeMultiDisplayString", () => {
  it("joins comma-free values with ', '", () => {
    expect(serializeMultiDisplayString(["a", "b"])).toBe("a, b");
    expect(serializeMultiDisplayString(["x"])).toBe("x");
  });
  it("returns '' for the empty array", () => {
    expect(serializeMultiDisplayString([])).toBe("");
  });
  it("does not trim on serialize (whitespace is preserved into the string)", () => {
    expect(serializeMultiDisplayString(["  x  "])).toBe("  x  ");
  });

  // --- FIXED (ADR 0030 Option A, Notidian-od7) ------------------------------
  // `f.replace(/,/g, '\\,')` now escapes EVERY comma in each element (was a
  // string-pattern replace that touched only the first). These assertions were
  // the locked characterization of the defect; they are the deliberate FLIP that
  // accompanies the fix — they now assert correct, complete escaping.
  it("escapes EVERY comma per element (global replace, ADR 0030 fix)", () => {
    // single element with one comma -> escaped once
    expect(serializeMultiDisplayString(["a,b"])).toBe("a\\,b");
    // single element with TWO commas -> BOTH are escaped (was 'a\\,b,c' pre-fix)
    expect(serializeMultiDisplayString(["a,b,c"])).toBe("a\\,b\\,c");
  });
  it("the canonical example serializes with each comma escaped", () => {
    // ['a,b','c'] -> 'a\,b, c' (the embedded comma escaped, ', ' separator added)
    expect(serializeMultiDisplayString(["a,b", "c"])).toBe("a\\,b, c");
  });
});

// =========================================================================
// serializeMultiDisplayString <-> parseMultiDisplayString  (round-trip net)
// =========================================================================
describe("serializeMultiDisplayString <-> parseMultiDisplayString round-trip", () => {
  const rt = (v: string[]) =>
    parseMultiDisplayString(serializeMultiDisplayString(v));

  it("comma-free, non-empty, trimmed values round-trip to identity", () => {
    expect(rt(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(rt(["alpha"])).toEqual(["alpha"]);
    expect(rt(["with space", "another one"])).toEqual([
      "with space",
      "another one",
    ]);
  });

  it("the empty array round-trips to []", () => {
    expect(rt([])).toEqual([]);
  });

  // CHARACTERIZATION: parse trims and the regex drops empty matches, so a lone
  // empty element ('' -> '' -> []) and surrounding whitespace are NOT preserved.
  it("CHARACTERIZE: a single empty-string element is LOST on round-trip ('' -> '' -> [])", () => {
    expect(serializeMultiDisplayString([""])).toBe("");
    expect(rt([""])).toEqual([]);
  });
  it("CHARACTERIZE: leading/trailing whitespace in an element is stripped on round-trip", () => {
    expect(rt(["  x  "])).toEqual(["x"]);
    expect(rt(["a", "  spaced  ", "b"])).toEqual(["a", "spaced", "b"]);
  });

  // --- THE DATA-LOSS HOLE, NOW CLOSED (ADR 0030 Option A, Notidian-od7) ------
  // These were the pinned characterization of the data-loss defect. They are the
  // deliberate FLIP that lands with the fix: comma-bearing elements now round-trip
  // to identity instead of fracturing.
  it("FIXED: ['a,b','c'] round-trips to identity (was ['a','b','c'] pre-fix)", () => {
    expect(rt(["a,b", "c"])).toEqual(["a,b", "c"]);
  });
  it("FIXED: a single multi-comma element ['a,b,c'] round-trips to identity (was fractured)", () => {
    expect(rt(["a,b,c"])).toEqual(["a,b,c"]);
  });
  it("FIXED: comma-bearing elements survive round-trip (multiple, with separators)", () => {
    expect(rt(["a,b", "c,d"])).toEqual(["a,b", "c,d"]);
    expect(rt(["x,y,z"])).toEqual(["x,y,z"]);
    expect(rt(["alias, with, commas", "plain"])).toEqual([
      "alias, with, commas",
      "plain",
    ]);
  });
  it("FIXED: parse un-escapes EVERY '\\,' (was first-only, mirror of serialize fix)", () => {
    // Direct parse of a manually-multi-escaped element: ALL escapes restored to
    // a single literal element (was ['a','b\\,c'] pre-fix).
    expect(parseMultiDisplayString("a\\,b\\,c")).toEqual(["a,b,c"]);
  });

  it("property: every comma-free element array round-trips to its trimmed, empty-dropped projection", () => {
    const rng = makeRng(0xd15c105e);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const input = randCommaFreeArray(rng);
      const out = rt(input);
      // Expected: trim each element, then drop any that became empty — the
      // exact transform the serialize+parse pair applies in the comma-free
      // regime.
      const expected = input.map((s) => s.trim()).filter((s) => s.length > 0);
      expect(out).toEqual(expected);
    }
  });

  it("property: in the comma-free, already-trimmed, non-empty regime round-trip is the identity", () => {
    const rng = makeRng(0x1de7717);
    const cleanPool = COMMA_FREE_POOL.map((s) => s.trim()).filter(
      (s) => s.length > 0
    );
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 0, 8);
      const input = Array.from(
        { length: len },
        () => cleanPool[randInt(rng, 0, cleanPool.length - 1)]
      );
      expect(rt(input)).toEqual(input);
    }
  });

  // --- ADR 0030 regression net: comma-BEARING values now round-trip too ------
  // The whole point of Option A. Pool includes single- and multi-comma elements;
  // each element is trimmed and non-empty so the only transform is the comma
  // escape/un-escape (no whitespace stripping or empty-drop to confound it).
  it("property: comma-bearing element arrays round-trip to identity (ADR 0030 fix)", () => {
    const rng = makeRng(0xc0117a99);
    const commaPool = [
      "a,b",
      "x,y,z",
      "alias, with, commas",
      "p,q,r,s",
      "plain",
      "with space",
      "one,two",
      "Tag",
    ];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 1, 8);
      const input = Array.from(
        { length: len },
        () => commaPool[randInt(rng, 0, commaPool.length - 1)]
      );
      expect(rt(input)).toEqual(input);
    }
  });
});

// =========================================================================
// parseMultiDisplayString  (direct, defensive-input characterization)
// =========================================================================
describe("parseMultiDisplayString (direct)", () => {
  it("returns [] for the empty string", () => {
    expect(parseMultiDisplayString("")).toEqual([]);
  });
  it("returns [] for null/undefined (ensureString guard)", () => {
    expect(parseMultiDisplayString(null as unknown as string)).toEqual([]);
    expect(parseMultiDisplayString(undefined as unknown as string)).toEqual([]);
  });
  it("splits a plain comma list and trims each token", () => {
    expect(parseMultiDisplayString("a, b ,c")).toEqual(["a", "b", "c"]);
  });
  it("drops empty tokens produced by consecutive commas", () => {
    expect(parseMultiDisplayString("a,,b")).toEqual(["a", "b"]);
  });
});

// =========================================================================
// serializeMultiString  (durable JSON form)
// =========================================================================
describe("serializeMultiString", () => {
  it("serializes to a JSON array string", () => {
    expect(serializeMultiString(["a", "b"])).toBe('["a","b"]');
    expect(serializeMultiString([])).toBe("[]");
    expect(serializeMultiString([""])).toBe('[""]');
  });
  it("is comma-SAFE — embedded commas survive JSON encoding", () => {
    expect(serializeMultiString(["a,b", "c"])).toBe('["a,b","c"]');
  });
  it("escapes JSON-special characters (quotes, backslashes)", () => {
    expect(serializeMultiString(['he said "hi"'])).toBe('["he said \\"hi\\""]');
    expect(serializeMultiString(["a\\b"])).toBe('["a\\\\b"]');
  });
});

// =========================================================================
// serializeMultiString <-> parseMultiString  (round-trip net)
// =========================================================================
describe("serializeMultiString <-> parseMultiString round-trip", () => {
  const rt = (v: string[]) => parseMultiString(serializeMultiString(v));

  it("string arrays round-trip to identity — INCLUDING embedded commas", () => {
    expect(rt(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    // The key advantage over the display form: commas are preserved losslessly.
    expect(rt(["a,b", "c"])).toEqual(["a,b", "c"]);
    expect(rt(["a,b,c"])).toEqual(["a,b,c"]);
  });
  it("the empty array round-trips to []", () => {
    expect(rt([])).toEqual([]);
  });
  it("preserves the empty-string element (unlike the display form)", () => {
    expect(rt([""])).toEqual([""]);
  });
  it("preserves leading/trailing whitespace (no trim on the JSON path)", () => {
    expect(rt(["  x  "])).toEqual(["  x  "]);
  });
  it("preserves quotes, backslashes and unicode", () => {
    expect(rt(['he said "hi"', "a\\b", "ünïcödé"])).toEqual([
      'he said "hi"',
      "a\\b",
      "ünïcödé",
    ]);
  });

  // CHARACTERIZATION: parseMultiString runs each parsed element through
  // ensureString, so a serialized non-string JSON value comes back STRINGIFIED.
  // (Inputs are typed string[], but real call sites occasionally feed mixed
  // arrays; we pin the coercion so it cannot regress silently.)
  it("CHARACTERIZE: non-string JSON elements come back stringified via ensureString", () => {
    const serialized = serializeMultiString([
      "1",
      2 as unknown as string,
      true as unknown as string,
    ]);
    expect(parseMultiString(serialized)).toEqual(["1", "2", "true"]);
  });

  it("property: any comma-free OR comma-bearing string array round-trips to identity", () => {
    const rng = makeRng(0x7e57ed);
    const pool = [...COMMA_FREE_POOL, "a,b", "x,y,z", ",", "a, b, c"];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 0, 8);
      const input = Array.from(
        { length: len },
        () => pool[randInt(rng, 0, pool.length - 1)]
      );
      expect(rt(input)).toEqual(input);
    }
  });
});

// =========================================================================
// parseMultiString  (branch characterization)
// =========================================================================
describe("parseMultiString (branch selection)", () => {
  it("uses the JSON branch only for strings starting with '['", () => {
    expect(parseMultiString('["a","b"]')).toEqual(["a", "b"]);
  });
  it("falls back to the display parser for non-bracket strings", () => {
    expect(parseMultiString("a, b")).toEqual(["a", "b"]);
  });
  it("CHARACTERIZE: malformed JSON starting with '[' yields [] (safelyParseJSON -> undefined -> ensureArray([]))", () => {
    expect(parseMultiString("[bad json")).toEqual([]);
  });
  it("returns [] for the empty string (display branch)", () => {
    expect(parseMultiString("")).toEqual([]);
  });
});

// =========================================================================
// serializeSQLValues / Statements / FieldNames  (MDB SQL assembly joins)
// =========================================================================
describe("SQL join serializers", () => {
  describe("serializeSQLValues (', ' — VALUES list)", () => {
    it("joins with ', '", () => {
      expect(serializeSQLValues(["'a'", "'b'", "'c'"])).toBe("'a', 'b', 'c'");
    });
    it("returns '' for empty and the element itself for a single value", () => {
      expect(serializeSQLValues([])).toBe("");
      expect(serializeSQLValues(["'x'"])).toBe("'x'");
    });
  });

  describe("serializeSQLStatements ('; ' — statement batching)", () => {
    it("joins with '; '", () => {
      expect(serializeSQLStatements(["A", "B", "C"])).toBe("A; B; C");
    });
    it("returns '' for empty and the element itself for a single statement", () => {
      expect(serializeSQLStatements([])).toBe("");
      expect(serializeSQLStatements(["SELECT 1"])).toBe("SELECT 1");
    });
  });

  describe("serializeSQLFieldNames (',' — field-name list, NO space)", () => {
    it("joins with a bare comma (distinct from the ', ' value join)", () => {
      expect(serializeSQLFieldNames(["a", "b", "c"])).toBe("a,b,c");
    });
    it("returns '' for empty and the element itself for a single field", () => {
      expect(serializeSQLFieldNames([])).toBe("");
      expect(serializeSQLFieldNames(["id"])).toBe("id");
    });
  });

  it("the three join serializers use DISTINCT separators (', ' vs '; ' vs ',')", () => {
    const v = ["x", "y"];
    expect(serializeSQLValues(v)).toBe("x, y");
    expect(serializeSQLStatements(v)).toBe("x; y");
    expect(serializeSQLFieldNames(v)).toBe("x,y");
    // Pairwise distinct on the same input.
    expect(serializeSQLValues(v)).not.toBe(serializeSQLFieldNames(v));
    expect(serializeSQLValues(v)).not.toBe(serializeSQLStatements(v));
    expect(serializeSQLStatements(v)).not.toBe(serializeSQLFieldNames(v));
  });

  it("property: each join is invertible by splitting on its own separator (length & content preserved)", () => {
    const rng = makeRng(0x59713ec7);
    // SQL-safe-ish tokens that contain none of the separator substrings.
    const tokenPool = ["a", "b1", "field_x", "'lit'", "42", "NULL", "id"];
    const cases: Array<[(v: string[]) => string, string]> = [
      [serializeSQLValues, ", "],
      [serializeSQLStatements, "; "],
      [serializeSQLFieldNames, ","],
    ];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 1, 8); // >=1: empty array joins to '' which split('')!==[]
      const input = Array.from(
        { length: len },
        () => tokenPool[randInt(rng, 0, tokenPool.length - 1)]
      );
      for (const [fn, sep] of cases) {
        const joined = fn(input);
        expect(joined.split(sep)).toEqual(input);
      }
    }
  });
});
