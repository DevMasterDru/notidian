import {
  quoteIdent,
  sanitizeColumnName,
  sanitizeFileName,
  sanitizeFolderName,
  sanitizeSQLStatement,
  sanitizeTableName,
} from "shared/utils/sanitizers";

// ===========================================================================
// DEPTH (Q1) — adversarial + property INVARIANT net for src/shared/utils/
// sanitizers.ts (Notidian-709). This module had NO dedicated test file (only
// w1-storage-hardening.audit.test.ts touched quoteIdent transitively), yet it
// sits on TWO authority/security surfaces:
//
//   SQL-IDENTITY (flows into adapters/mdb/db/db.ts, mdb.ts, localCache.ts and
//   core/superstate/api.ts via sanitizeTableName, and FramesMDBContext /
//   ContextEditorContext / spaces.ts / propertyNameValue.ts via
//   sanitizeColumnName):
//     - quoteIdent           — the SQL-identifier quoting chokepoint.
//     - sanitizeSQLStatement — single-quote doubling for SQL string literals.
//     - sanitizeColumnName   — persisted-name cleansing (NOT SQL escaping).
//     - sanitizeTableName    — table-id allow-listing.
//
//   PATH-IDENTITY (ADR 0014/0016 — a file's path/basename OWNS row identity, so
//   a faulty sanitize fabricates or relocates identity; reaches the filesystem
//   via adapters/obsidian/utils/file.ts, fileSystemPathFixer, TitleComponent,
//   tableCsvImport, InlineMenu):
//     - sanitizeFolderName / sanitizeFileName.
//
// Everything here is PURE / OFFLINE — plain string functions, no DOM, no vault,
// no I/O. So this is a plain `.test.ts` (default jest `node` env), NOT a
// `.dom.test.ts`. It mirrors the property/adversarial nets the sanitize.ts DOM
// surface already has (sanitizePrimitives.property.dom.test.ts,
// sanitizeHtmlSinks.adversarial.dom.test.ts).
//
// CHARACTERIZATION, NOT CORRECTION. We LOCK the current observable behaviour so
// any future change is a conscious, reviewed decision — including the latent
// defects we surfaced and explicitly pin (and filed follow-ups for):
//
//   (D1) sanitizeFolderName IS idempotent (FIXED in Notidian-hsd; was a latent
//        ordering defect surfaced here by Notidian-709). The five strips are
//        MUTUALLY coupling: removing an illegal/control char can expose a new
//        leading sigil that folderReservedRe `^[+$#^]+` already passed, AND
//        stripping a leading sigil can expose a now-leading Windows device name
//        / pure-dot run that the anchored windowsReservedRe / reservedRe already
//        passed. No single linear pass in any order reaches a fixed point, so
//        sanitizeFolderName now runs the pipeline TO A FIXED POINT. We therefore
//        pin idempotency: sanitize(sanitize(x)) === sanitize(x), incl. the
//        former defect case sanitizeFolderName("/+") -> "" (was "+" -> "").
//        sanitizeFileName, which has no leading-sigil pass, was already
//        idempotent. We pin BOTH facts.
//   (D2) The null/undefined contract is INCONSISTENT across the six functions:
//        quoteIdent is null-safe ('""'); sanitizeSQLStatement / sanitizeColumnName
//        / sanitizeTableName return `undefined` (via `?.`) on nullish input;
//        sanitizeFolderName / sanitizeFileName THROW on null/undefined (no
//        optional chaining). We pin each branch so a future refactor can't
//        silently flip the contract under a caller that depends on it.
//   (D3) sanitizeColumnName IS idempotent (FIXED in Notidian-80m; was a latent
//        ordering defect of the SAME class as D1). The former code peeled the
//        leading `_`/`$` run FIRST, then quote-stripped in a TERMINAL branch (no
//        re-peel). So a leading quote in front of a sigil (`"$x`) survived the
//        peel guard, the quote was removed, and a leading `$` was left behind —
//        a 2nd call then peeled it (sanitizeColumnName("\"$x") -> "$x" -> "x").
//        The fix strips ALL quotes FIRST (exposing any quote-masked sigil), THEN
//        peels the leading sigil run to a fixed point, so `"$x` -> "x" in ONE
//        call. We therefore pin BOTH the no-double-quote guarantee AND the no-
//        leading-`_`/`$` guarantee in a single application, plus idempotency:
//        sanitizeColumnName(sanitizeColumnName(x)) === sanitizeColumnName(x).
//
// See follow-up beads filed by Notidian-709 for the folder-idempotency (D1) and
// column-name (D3) ordering fixes and the nullish-contract (D2) unification.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep — repo convention; matches
//     array.test.ts / sanitizePrimitives.property.dom.test.ts) ---------------
// mulberry32: fast, well-distributed, fully deterministic 32-bit generator so
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
const PROPERTY_RUNS = 500;

// A pool of adversarial code units the fuzzer draws from: SQL metacharacters,
// the path-illegal set, leading sigils, C0/C1 control chars, dots, reserved
// device-name fragments, unicode, and benign letters/digits.
const FUZZ_TOKENS: string[] = [
  // SQL / identifier breakout attempts
  `'`, `"`, `;`, `--`, `/*`, `*/`, `)`, `(`, `=`,
  `' OR '1'='1`, `'; DROP TABLE x; --`, `" OR ""="`, `""`, `"""`,
  // path-illegal chars  /?<>\:*|"
  `/`, `?`, `<`, `>`, `\\`, `:`, `*`, `|`,
  // leading sigils stripped by sanitizeFolderName
  `+`, `$`, `#`, `^`,
  // C0 / C1 control range
  `\x00`, `\x07`, `\x1f`, `\x80`, `\x85`, `\x9f`,
  // dots & traversal
  `.`, `..`, `...`, `./`, `../`,
  // windows reserved device-name fragments
  `con`, `CON`, `prn`, `aux`, `nul`, `com0`, `com9`, `lpt1`, `LPT9`,
  `.txt`, `.con`,
  // underscores / dollars for sanitizeColumnName recursion
  `_`, `__`, `___`, `$`, `_$_`, `$_$`,
  // unicode + benign
  `é`, `名`, `🙂`, `a`, `Z`, `7`, ` `, `\t`, `\n`, `-`,
];

const fuzzString = (rng: () => number): string => {
  const parts = randInt(rng, 0, 8);
  let out = "";
  for (let i = 0; i < parts; i++) {
    out += FUZZ_TOKENS[randInt(rng, 0, FUZZ_TOKENS.length - 1)];
  }
  return out;
};

// =========================================================================
// quoteIdent — the SQL-identifier quoting chokepoint
// =========================================================================
describe("quoteIdent", () => {
  it("wraps a plain identifier in double quotes", () => {
    expect(quoteIdent("col")).toBe(`"col"`);
  });
  it("doubles a single embedded double-quote", () => {
    expect(quoteIdent(`a"b`)).toBe(`"a""b"`);
  });
  it("doubles EVERY embedded double-quote (injection attempt)", () => {
    // `";DROP` — the lone interior quote is doubled so it cannot terminate the
    // quoted identifier; the `;DROP` payload stays inert inside the quotes.
    expect(quoteIdent(`";DROP`)).toBe(`""";DROP"`);
  });
  it("treats null/undefined as the empty identifier (null-safe — D2)", () => {
    expect(quoteIdent(null as unknown as string)).toBe(`""`);
    expect(quoteIdent(undefined as unknown as string)).toBe(`""`);
  });
  it("handles the empty string", () => {
    expect(quoteIdent("")).toBe(`""`);
  });
  it("doubles a string that is already all quotes (3 interior -> 6, +2 wrappers = 8)", () => {
    expect(quoteIdent(`"""`)).toBe(`"` + `""""""` + `"`);
    expect(quoteIdent(`"""`)).toHaveLength(8);
  });

  // ---- SECURITY INVARIANTS (property) ----
  // The whole point of quoteIdent: a hostile column/table name can NEVER break
  // out of the quoted identifier. We re-derive the breakout test the way a SQL
  // parser sees it: the output must be a single, well-formed quoted identifier.
  it("INVARIANT: output is always wrapped, interior quotes are all doubled, and the interior quote count is even (no breakout)", () => {
    const rng = makeRng(0xc0ffee);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const out = quoteIdent(input);
      // 1. Always wrapped in double quotes, length >= 2.
      expect(out.length).toBeGreaterThanOrEqual(2);
      expect(out.startsWith(`"`)).toBe(true);
      expect(out.endsWith(`"`)).toBe(true);
      // 2. The interior (between the outer wrappers) contains ONLY doubled
      //    quotes — i.e. removing every `""` pair leaves no stray `"`.
      const interior = out.slice(1, -1);
      expect(interior.replace(/""/g, "")).not.toContain(`"`);
      // 3. A SQL parser un-escaping `""`->`"` inside the wrappers must recover
      //    EXACTLY the original input (round-trip => no breakout, no loss).
      expect(interior.replace(/""/g, `"`)).toBe(input ?? "");
    }
  });

  it("INVARIANT: re-quoting the un-escaped interior is a fixed point (stable escaping)", () => {
    const rng = makeRng(0x5eed);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const once = quoteIdent(input);
      const recovered = once.slice(1, -1).replace(/""/g, `"`);
      expect(quoteIdent(recovered)).toBe(once);
    }
  });
});

// =========================================================================
// sanitizeSQLStatement — single-quote doubling for SQL string literals
// =========================================================================
describe("sanitizeSQLStatement", () => {
  it("doubles a single quote", () => {
    expect(sanitizeSQLStatement("a'b")).toBe("a''b");
  });
  it("doubles EVERY single quote in an injection payload", () => {
    expect(sanitizeSQLStatement("'; DROP TABLE x; --")).toBe(
      "''; DROP TABLE x; --",
    );
  });
  it("leaves a quote-free string untouched", () => {
    expect(sanitizeSQLStatement("plain value")).toBe("plain value");
  });
  it("does NOT touch double quotes (only single quotes are its job)", () => {
    expect(sanitizeSQLStatement(`a"b`)).toBe(`a"b`);
  });
  it("returns undefined on nullish input (via `?.` — D2, NOT the '' fail-safe)", () => {
    // The empty-string fail-safe only triggers on a thrown exception; nullish
    // input short-circuits through optional chaining to `undefined`.
    expect(sanitizeSQLStatement(null as unknown as string)).toBeUndefined();
    expect(sanitizeSQLStatement(undefined as unknown as string)).toBeUndefined();
  });
  it("handles the empty string", () => {
    expect(sanitizeSQLStatement("")).toBe("");
  });

  // ---- SECURITY INVARIANT (property) ----
  it("INVARIANT: output never contains a lone single quote; every `'` is part of a `''` pair (count is even)", () => {
    const rng = makeRng(0xabc123);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const out = sanitizeSQLStatement(input) ?? "";
      // Removing every doubled pair must leave no stray single quote.
      expect(out.replace(/''/g, "")).not.toContain("'");
      // Un-escaping `''`->`'` must recover the original (round-trip).
      expect(out.replace(/''/g, "'")).toBe(input);
    }
  });

  it("INVARIANT: every input single-quote count doubles exactly", () => {
    const rng = makeRng(0x246810);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const inCount = (input.match(/'/g) || []).length;
      const out = sanitizeSQLStatement(input) ?? "";
      const outCount = (out.match(/'/g) || []).length;
      expect(outCount).toBe(inCount * 2);
    }
  });
});

// =========================================================================
// sanitizeColumnName — persisted column-name cleansing (IDEMPOTENT, Notidian-80m)
//   - removes ALL double-quotes FIRST (NOT SQL-escaping — that is quoteIdent's
//     job at construction; escaping here would persist `""` into the name)
//   - THEN peels a LEADING run of `_` / `$` to a fixed point (quote-strip-first
//     so a quote-masked leading sigil is exposed and peeled in ONE application)
// =========================================================================
describe("sanitizeColumnName", () => {
  it("leaves a clean name untouched", () => {
    expect(sanitizeColumnName("title")).toBe("title");
  });
  it("strips a single leading underscore", () => {
    expect(sanitizeColumnName("_x")).toBe("x");
  });
  it("strips a single leading dollar sign", () => {
    expect(sanitizeColumnName("$x")).toBe("x");
  });
  it("RECURSIVELY strips a deep leading _/$ run", () => {
    expect(sanitizeColumnName("__$_x")).toBe("x");
    expect(sanitizeColumnName("$_$_$abc")).toBe("abc");
  });
  it("a name that is ALL leading _/$ collapses to empty", () => {
    expect(sanitizeColumnName("___")).toBe("");
    expect(sanitizeColumnName("$$$")).toBe("");
    expect(sanitizeColumnName("_$_$")).toBe("");
  });
  it("removes ALL double-quotes (persisted-name rule, NOT SQL escaping)", () => {
    expect(sanitizeColumnName(`"""`)).toBe("");
    expect(sanitizeColumnName(`a"b"c`)).toBe("abc");
  });
  it("combines leading-sigil strip with quote removal", () => {
    expect(sanitizeColumnName(`_$_a"b`)).toBe("ab");
  });
  it("does NOT strip interior or trailing underscores/dollars", () => {
    expect(sanitizeColumnName("a_b")).toBe("a_b");
    expect(sanitizeColumnName("a$")).toBe("a$");
    expect(sanitizeColumnName("a__b__")).toBe("a__b__");
  });
  it("does NOT strip a sigil that follows a non-sigil leading char", () => {
    // The peel only runs while the FIRST char is _/$; once quotes are stripped
    // `a"_` -> `a_`, whose leading char is `a`, so the trailing `_` stays.
    expect(sanitizeColumnName(`a"_`)).toBe("a_");
  });
  it("returns undefined on nullish input (via `?.` — D2)", () => {
    expect(sanitizeColumnName(null as unknown as string)).toBeUndefined();
    expect(sanitizeColumnName(undefined as unknown as string)).toBeUndefined();
  });

  // ---- D3 (FIXED in Notidian-80m): a LEADING quote in front of a sigil no
  //      longer leaves the sigil exposed. The former code peeled the leading
  //      sigil FIRST and quote-stripped LAST (terminal branch), so a quote-
  //      masked sigil (`"$x`) survived ONE application (`"$x` -> `$x`). Now we
  //      strip ALL quotes FIRST — which EXPOSES the previously-masked sigil —
  //      THEN peel the leading sigil run to a fixed point, so it is reached in
  //      ONE application and the function is idempotent. ----
  it("D3 (FIXED): a leading double-quote no longer masks a following sigil — quotes are stripped FIRST, then the now-leading sigil is peeled in ONE call", () => {
    // Quote-strip first: `"$x` -> `$x`, then the now-leading `$` is peeled -> `x`.
    expect(sanitizeColumnName(`"$x`)).toBe("x");
    expect(sanitizeColumnName(`"_x`)).toBe("x");
    // A run of quote-masked sigils all collapse in one call.
    expect(sanitizeColumnName(`"$"_"$x`)).toBe("x");
    // IDEMPOTENT: a second application is a no-op (the D3 fix).
    expect(sanitizeColumnName(sanitizeColumnName(`"$x`))).toBe(
      sanitizeColumnName(`"$x`),
    );
    expect(sanitizeColumnName(sanitizeColumnName(`"$x`))).toBe("x");
  });
  it("D3 (FIXED): a leading sigil in front of a quote also collapses fully in one call", () => {
    // `_"x` -> (strip quotes) `_x` -> (peel) `x`.
    expect(sanitizeColumnName(`_"x`)).toBe("x");
    // `$"_x` -> (strip quotes) `$_x` -> (peel `$` then `_`) `x` — the former
    // terminal-branch code stopped at `_x`; the fixed-point peel reaches `x`.
    expect(sanitizeColumnName(`$"_x`)).toBe("x");
  });

  // ---- INVARIANTS (property) ----
  it("INVARIANT: output contains NO double-quotes (the absolute guarantee)", () => {
    const rng = makeRng(0xfeed);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const out = sanitizeColumnName(input) ?? "";
      expect(out).not.toContain(`"`);
    }
  });
  it("INVARIANT (D3 FIX): sanitizeColumnName IS idempotent — sanitize(sanitize(x)) === sanitize(x), so a re-saved column name can never drift identity", () => {
    const rng = makeRng(0xbead);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const once = sanitizeColumnName(input);
      expect(sanitizeColumnName(once as string)).toBe(once);
    }
    // The exact former-defect case, pinned: `"$x` settles to `x` in ONE call.
    expect(sanitizeColumnName(`"$x`)).toBe("x");
    expect(sanitizeColumnName(sanitizeColumnName(`"$x`))).toBe(
      sanitizeColumnName(`"$x`),
    );
  });
  it("INVARIANT (D3 FIX): a SINGLE application has NO double-quotes AND no leading _/$ (the intended cleansing, now reached in one pass)", () => {
    const rng = makeRng(0xb0a);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const out = sanitizeColumnName(input) ?? "";
      expect(out).not.toContain(`"`);
      if (out.length > 0) {
        expect(out.charAt(0) === "_" || out.charAt(0) === "$").toBe(false);
      }
    }
  });
});

// =========================================================================
// sanitizeTableName — table-id allow-listing: keeps ONLY [a-z0-9+]
//   (case-insensitive), strips EVERYTHING else (path separators, dots, spaces,
//   unicode, SQL metacharacters).
// =========================================================================
describe("sanitizeTableName", () => {
  it("leaves an alphanumeric+`+` name untouched", () => {
    expect(sanitizeTableName("Files123+")).toBe("Files123+");
  });
  it("strips an injection payload down to its allow-listed letters", () => {
    expect(sanitizeTableName("'; DROP TABLE")).toBe("DROPTABLE");
  });
  it("strips path separators, dots, and spaces", () => {
    expect(sanitizeTableName("a.b/c d")).toBe("abcd");
  });
  it("strips unicode and control chars", () => {
    expect(sanitizeTableName("café名\x00")).toBe("caf"); // 'é','名',NUL all removed
  });
  it("collapses an all-illegal name to empty", () => {
    expect(sanitizeTableName(`'";/\\*`)).toBe("");
  });
  it("handles the empty string", () => {
    expect(sanitizeTableName("")).toBe("");
  });
  it("returns undefined on nullish input (via `?.` — D2)", () => {
    expect(sanitizeTableName(null as unknown as string)).toBeUndefined();
    expect(sanitizeTableName(undefined as unknown as string)).toBeUndefined();
  });

  // ---- INVARIANTS (property) ----
  it("INVARIANT: output contains ONLY characters in the [A-Za-z0-9+] allow-list", () => {
    const rng = makeRng(0x7ab1e);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const out = sanitizeTableName(input) ?? "";
      expect(/^[A-Za-z0-9+]*$/.test(out)).toBe(true);
    }
  });
  it("INVARIANT: idempotent — already-clean output is unchanged on a second pass", () => {
    const rng = makeRng(0x90210);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const once = sanitizeTableName(input);
      expect(sanitizeTableName(once as string)).toBe(once);
    }
  });
  it("INVARIANT: never lengthens the input (allow-listing only ever removes)", () => {
    const rng = makeRng(0x13579);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const out = sanitizeTableName(input) ?? "";
      expect(out.length).toBeLessThanOrEqual(input.length);
    }
  });
});

// =========================================================================
// sanitizeFolderName / sanitizeFileName — path/row-identity cleansing
//   Shared strips (both): illegal path chars /?<>\:*|" , C0/C1 control range,
//   pure-dot reserved names (^\.+$), Windows device names
//   (con/prn/aux/nul/com[0-9]/lpt[0-9], case-insensitive, with-or-without ext).
//   sanitizeFolderName ADDITIONALLY strips a LEADING run of +/$/#/^. Because
//   that sigil strip and the anchored device-name/pure-dot strips mutually
//   expose each other (D1), it runs the whole pipeline TO A FIXED POINT so the
//   result is idempotent (Notidian-hsd).
// =========================================================================
describe("sanitizeFileName", () => {
  it("leaves a clean name untouched", () => {
    expect(sanitizeFileName("Report 2026.md")).toBe("Report 2026.md");
  });
  it("strips every illegal path char /?<>\\:*|\"", () => {
    expect(sanitizeFileName(`a/b?c<d>e\\f:g*h|i"j`)).toBe("abcdefghij");
  });
  it("loses the slash in a traversal attempt (but keeps the dots — not all-dots)", () => {
    // After removing '/', "..etc" is NOT entirely dots, so the ^\.+$ rule does
    // not fire — the dots survive but the separator is gone.
    expect(sanitizeFileName("../etc")).toBe("..etc");
  });
  it("collapses a pure-dot name to empty", () => {
    expect(sanitizeFileName(".")).toBe("");
    expect(sanitizeFileName("..")).toBe("");
    expect(sanitizeFileName("...")).toBe("");
  });
  it("strips C0 and C1 control chars", () => {
    expect(sanitizeFileName("a\x00b\x1fc\x80d\x9fe")).toBe("abcde");
  });
  it("strips a bare Windows device name (case-insensitive)", () => {
    expect(sanitizeFileName("con")).toBe("");
    expect(sanitizeFileName("NUL")).toBe("");
    expect(sanitizeFileName("com0")).toBe("");
    expect(sanitizeFileName("LPT9")).toBe("");
    expect(sanitizeFileName("aux")).toBe("");
  });
  it("strips a Windows device name WITH an extension (greedy `(\\..*)?`)", () => {
    expect(sanitizeFileName("CON.txt")).toBe("");
    expect(sanitizeFileName("com5.dat")).toBe("");
    expect(sanitizeFileName("nul.config.bak")).toBe("");
  });
  it("does NOT strip a name that merely STARTS with a device name", () => {
    expect(sanitizeFileName("CONfig")).toBe("CONfig");
    expect(sanitizeFileName("console")).toBe("console");
    expect(sanitizeFileName("nullable")).toBe("nullable");
  });
  it("does NOT strip a leading sigil (that is folder-only)", () => {
    expect(sanitizeFileName("#+name")).toBe("#+name");
    expect(sanitizeFileName("+con")).toBe("+con");
  });
  it("THROWS on null/undefined (no optional chaining — D2)", () => {
    expect(() => sanitizeFileName(null as unknown as string)).toThrow();
    expect(() => sanitizeFileName(undefined as unknown as string)).toThrow();
  });
});

describe("sanitizeFolderName", () => {
  it("leaves a clean name untouched", () => {
    expect(sanitizeFolderName("My Database")).toBe("My Database");
  });
  it("strips a LEADING run of +/$/#/^ (folder-only sigils)", () => {
    expect(sanitizeFolderName("+$#^name")).toBe("name");
    expect(sanitizeFolderName("#+name")).toBe("name");
  });
  it("does NOT strip interior or trailing sigils", () => {
    expect(sanitizeFolderName("a+b#c")).toBe("a+b#c");
    expect(sanitizeFolderName("name+")).toBe("name+");
  });
  it("applies all the shared strips too (illegal, control, dots, device names)", () => {
    expect(sanitizeFolderName(`a/b<c>d:e`)).toBe("abcde");
    expect(sanitizeFolderName("...")).toBe("");
    expect(sanitizeFolderName("CON.txt")).toBe("");
    expect(sanitizeFolderName("a\x00b\x85c")).toBe("abc");
  });
  it("a leading sigil in front of a device name collapses to empty (sigil + exposed device name both stripped at the fixed point)", () => {
    expect(sanitizeFolderName("+con")).toBe("");
    expect(sanitizeFolderName("$nul.txt")).toBe("");
  });
  it("loses the slash in a traversal attempt", () => {
    expect(sanitizeFolderName("../etc")).toBe("..etc");
  });
  it("THROWS on null/undefined (no optional chaining — D2)", () => {
    expect(() => sanitizeFolderName(null as unknown as string)).toThrow();
    expect(() => sanitizeFolderName(undefined as unknown as string)).toThrow();
  });

  // ---- D1: IDEMPOTENCY (was a latent ordering defect; FIXED in Notidian-hsd) --
  it("D1 (FIXED): is IDEMPOTENT — sanitize(sanitize(x)) === sanitize(x), so re-saving a name can never drift identity (ADR 0014/0016)", () => {
    // Former defect: "/+" used to yield "+" (a leading illegal char masked the
    // sigil), so a 2nd call stripped more. The fixed-point pipeline now strips
    // '/' (illegal) then the now-leading '+' (sigil) in one settled result.
    expect(sanitizeFolderName("/+")).toBe("");
    expect(sanitizeFolderName(sanitizeFolderName("/+"))).toBe(
      sanitizeFolderName("/+"),
    );
    // ":$#" — same illegal-masks-sigil shape.
    expect(sanitizeFolderName(":$#")).toBe("");
    // The REVERSE coupling (a leading sigil masking an anchored device name /
    // pure-dot run) is also resolved by the fixed point, which a mere reorder
    // could NOT do. Each of these reaches its final value in one settled call.
    for (const x of [
      "/+",
      ":$#",
      "+con",
      "$nul.txt",
      "$#con",
      "+lpt3.x",
      "$..",
      "++con.txt",
      "+$#^name",
      "a+b#c",
      "../etc",
    ]) {
      const once = sanitizeFolderName(x);
      expect(sanitizeFolderName(once)).toBe(once);
    }
  });
});

// =========================================================================
// CROSS-FUNCTION property net for the path-identity pair
// =========================================================================
describe("path sanitizers — shared invariants (property)", () => {
  // The set of chars that BOTH functions guarantee never survive in output.
  const ILLEGAL = `/?<>\\:*|"`;
  const hasControl = (s: string) => /[\x00-\x1f\x80-\x9f]/.test(s);

  it("INVARIANT: neither function ever leaves an illegal path char or a control char in the output", () => {
    const rng = makeRng(0x404040);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      for (const fn of [sanitizeFolderName, sanitizeFileName]) {
        const out = fn(input);
        for (const ch of ILLEGAL) expect(out).not.toContain(ch);
        expect(hasControl(out)).toBe(false);
      }
    }
  });

  it("INVARIANT: neither function ever lengthens the input (cleansing only removes)", () => {
    const rng = makeRng(0x505050);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      expect(sanitizeFolderName(input).length).toBeLessThanOrEqual(input.length);
      expect(sanitizeFileName(input).length).toBeLessThanOrEqual(input.length);
    }
  });

  it("INVARIANT: sanitizeFileName IS idempotent", () => {
    const rng = makeRng(0x606060);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const once = sanitizeFileName(input);
      expect(sanitizeFileName(once)).toBe(once);
    }
  });

  it("INVARIANT: sanitizeFolderName IS idempotent too (fixed-point pipeline — Notidian-hsd, D1 fix)", () => {
    const rng = makeRng(0x616161);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const once = sanitizeFolderName(input);
      expect(sanitizeFolderName(once)).toBe(once);
    }
  });

  it("INVARIANT: folder cleansing DOMINATES file cleansing — folder(file(x)) === folder(x) AND folder output is already file-clean (file(folder(x)) === folder(x))", () => {
    const rng = makeRng(0x707070);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const input = fuzzString(rng);
      const folder = sanitizeFolderName(input);
      // folder is a strict superset of the file pipeline run to a fixed point,
      // so pre-cleaning with file changes nothing...
      expect(sanitizeFolderName(sanitizeFileName(input))).toBe(folder);
      // ...and the folder output already satisfies the file pipeline (no
      // residual illegal/control/dot/device-name fragment is left behind).
      expect(sanitizeFileName(folder)).toBe(folder);
    }
  });

  it("a name of pure illegal+control chars collapses to empty for both", () => {
    const cruft = `/?<>\\:*|"\x00\x1f\x85`;
    expect(sanitizeFolderName(cruft)).toBe("");
    expect(sanitizeFileName(cruft)).toBe("");
  });
  it("D1 (FIXED): leading illegal chars BEFORE the sigils no longer leave the sigils behind — the fixed-point pipeline strips the now-leading sigils in the same call", () => {
    // The sigils `+$#^` follow illegal chars, so they are NOT leading when
    // folderReservedRe runs in the first sub-pass; once the illegal prefix is
    // stripped they ARE leading, and the fixed-point loop re-runs the sigil
    // strip on the settled string — so they are peeled in ONE call (was "+$#^"
    // before Notidian-hsd, requiring a 2nd call). Idempotent.
    const cruft = `/?<>\\:*|"+$#^\x00\x1f\x85`;
    expect(sanitizeFolderName(cruft)).toBe("");
    expect(sanitizeFolderName(sanitizeFolderName(cruft))).toBe(
      sanitizeFolderName(cruft),
    );
    // sanitizeFileName has no sigil pass, so the sigils survive (by design).
    expect(sanitizeFileName(cruft)).toBe("+$#^");
  });
});
