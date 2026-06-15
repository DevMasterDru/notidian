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
//   (D2) The null/undefined contract is now UNIFIED across all six functions
//        (FIXED in Notidian-wtz; was three divergent behaviours surfaced by
//        Notidian-709). Every sanitizer coerces a nullish (null | undefined)
//        input to the empty string `''` at entry, then runs its normal
//        cleansing. The former behaviours were: quoteIdent null-safe ('""', i.e.
//        the `''` case it already had); sanitizeSQLStatement / sanitizeColumnName
//        / sanitizeTableName returned `undefined` (via `?.`); sanitizeFolderName
//        / sanitizeFileName THREW (no optional chaining). `''` is the safest
//        single contract for the SQL-construction (db.ts) and path/row-identity
//        (file.ts, ADR 0014/0016) surfaces — never an exception, never a stray
//        `undefined` that string-coerces to the literal `"undefined"`. We now
//        pin the UNIFIED contract: every function returns the empty-string
//        result on nullish input (quoteIdent -> '""', the rest -> ''), so a
//        future refactor can't silently re-diverge it.
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
  it("coerces nullish input to '' (unified D2 contract — Notidian-wtz)", () => {
    // Nullish input is now coerced to '' at entry, then the (no-op) quote
    // doubling runs, yielding ''. No more divergent `undefined` short-circuit.
    expect(sanitizeSQLStatement(null as unknown as string)).toBe("");
    expect(sanitizeSQLStatement(undefined as unknown as string)).toBe("");
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
  it("coerces nullish input to '' (unified D2 contract — Notidian-wtz)", () => {
    expect(sanitizeColumnName(null as unknown as string)).toBe("");
    expect(sanitizeColumnName(undefined as unknown as string)).toBe("");
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
  it("coerces nullish input to '' (unified D2 contract — Notidian-wtz)", () => {
    expect(sanitizeTableName(null as unknown as string)).toBe("");
    expect(sanitizeTableName(undefined as unknown as string)).toBe("");
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
  it("coerces nullish input to '' (unified D2 contract — Notidian-wtz; no longer throws)", () => {
    expect(sanitizeFileName(null as unknown as string)).toBe("");
    expect(sanitizeFileName(undefined as unknown as string)).toBe("");
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
  it("coerces nullish input to '' (unified D2 contract — Notidian-wtz; no longer throws)", () => {
    expect(sanitizeFolderName(null as unknown as string)).toBe("");
    expect(sanitizeFolderName(undefined as unknown as string)).toBe("");
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

  it("UNIFIED D2 CONTRACT: every sanitizer maps BOTH null and undefined to its empty-string result (none throws, none returns undefined) — Notidian-wtz", () => {
    // quoteIdent's empty case is the wrapped empty identifier `'""'`; the other
    // five return the bare empty string. The invariant under test is that the
    // nullish result EQUALS the empty-string ('') result for each function, and
    // that null and undefined are treated identically — no divergence.
    for (const fn of [
      sanitizeSQLStatement,
      sanitizeColumnName,
      sanitizeTableName,
      sanitizeFolderName,
      sanitizeFileName,
    ]) {
      const empty = fn("");
      expect(fn(null as unknown as string)).toBe(empty);
      expect(fn(undefined as unknown as string)).toBe(empty);
    }
    // quoteIdent: nullish and '' both yield the wrapped empty identifier.
    expect(quoteIdent(null as unknown as string)).toBe(quoteIdent(""));
    expect(quoteIdent(undefined as unknown as string)).toBe(quoteIdent(""));
    expect(quoteIdent("")).toBe(`""`);
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

// ===========================================================================
// UNIVERSAL CROSS-SANITIZER PROPERTY NET (Notidian-yrx)
// ---------------------------------------------------------------------------
// The blocks above pin each export's invariants PER FUNCTION, and the
// cross-function block pins the path-identity pair. This block locks the three
// post-fix invariant FAMILIES the D1/D2/D3 fixes established (Notidian-hsd /
// Notidian-wtz / Notidian-80m) UNIVERSALLY — as one table-driven contract over
// ALL SIX exports at FIXED SEEDS — so a future refactor of ANY single sanitizer
// that silently re-breaks idempotency, the nullish contract, or an output-charset
// guarantee turns THIS file red, not just the function-local suite.
//
//   (1) IDEMPOTENCE     — sanitize(sanitize(x)) === sanitize(x) for every
//                         name-cleansing sanitizer (the two formerly
//                         non-idempotent NAME cleansers, sanitizeFolderName/
//                         sanitizeColumnName, now hold; D1/D3). The two ESCAPERS
//                         (sanitizeSQLStatement, quoteIdent) re-escape their
//                         output and are intentionally excluded from (1) — their
//                         by-design non-idempotence is characterized in (1b).
//   (2) NULLISH CONTRACT — the unified D2 contract holds for BOTH null and
//                         undefined on EVERY export (no throw, no stray
//                         undefined; nullish === the '' result for each).
//   (3) OUTPUT-CHARSET   — folder/file output has no illegal/control char and
//                         (folder) never begins with a reserved sigil; column
//                         output has no double-quote and never begins with _/$;
//                         table output is allow-list-only; quoteIdent always
//                         emits a balanced doubled-quote identifier.
//
// DETERMINISM / NO NEW DEPENDENCY: the bead brief suggested fast-check "already a
// dep", but it is NOT in package.json and NO test in this repo uses it — the
// established deterministic property pattern (sibling DEPTH nets Notidian-7sj
// `sanitizePrimitives.property.dom.test.ts` and Notidian-709 above) is the
// seeded `mulberry32` generator with FIXED seeds. That already delivers the
// brief's stated requirement ("a fixed seed for determinism") with zero install,
// zero lockfile churn, and a pure/offline transform surface — the correct choice
// for a Q1 offline test-hardening bead. Each net below runs at its own fixed seed
// over the same richer adversarial generator (`adversarialString`), which, unlike
// the token-bag `fuzzString`, deliberately COMPOSES the exact hostile shapes the
// bead enumerates: leading sigils _/$/+/#/^, leading AND embedded double-quotes,
// C0/C1 control ranges, path separators, windows-reserved device names, and
// dotted/pure-dot names — so the universal assertions are stressed on inputs that
// specifically target each function's coupling/ordering hazards.
// ===========================================================================
describe("UNIVERSAL cross-sanitizer property net (Notidian-yrx)", () => {
  // Structured adversarial-string generator. It builds each input from a random
  // mix of (a) a leading-shape prefix that targets the order-sensitive peels
  // (sigils / leading quotes / leading dots), and (b) a body drawn from a hostile
  // alphabet, so the generated corpus reliably exercises the leading-context
  // coupling that the D1/D3 fixed-point fixes resolve — not just random noise.
  const LEADING_SHAPES: string[] = [
    "", "_", "$", "+", "#", "^", "__", "$$", "+#^", "_$_$",
    `"`, `""`, `"_`, `"$`, `"$"_`, `_"`, `$"_`,
    ".", "..", "...", "./", "../",
    "con", "CON", "nul", "com0", "lpt9", "+con", "$nul.txt", "$#con",
  ];
  const BODY_TOKENS: string[] = [
    "a", "Z", "7", "name", "title", "-", " ", "_", "$", "+", "#", "^", ".",
    `"`, `'`, `/`, `?`, `<`, `>`, `\\`, `:`, `*`, `|`, ";",
    "\x00", "\x07", "\x1f", "\x80", "\x85", "\x9f",
    "é", "名", "🙂", "con", "lpt1", ".txt", "..",
  ];
  const adversarialString = (rng: () => number): string => {
    let out = LEADING_SHAPES[randInt(rng, 0, LEADING_SHAPES.length - 1)];
    const bodyParts = randInt(rng, 0, 6);
    for (let i = 0; i < bodyParts; i++) {
      out += BODY_TOKENS[randInt(rng, 0, BODY_TOKENS.length - 1)];
    }
    return out;
  };

  // The six exports, with metadata describing each one's contract. `nameClean`
  // marks the four name/identity-cleansing sanitizers for which idempotence is a
  // hard guarantee (removal-only / allow-list cleansers). The other two are
  // ESCAPERS that intentionally RE-ESCAPE their output and so are NOT idempotent
  // by design — sanitizeSQLStatement doubles every `'` (a 2nd pass doubles them
  // again: `''` -> `''''`) and quoteIdent re-wraps + re-doubles `"` — both are
  // asserted via their own round-trip structural nets in family (3), never via
  // the idempotence net (family 1). The idempotence guarantee the bead pins is
  // the name/identity contract (ADR 0014/0016: a re-saved NAME must not drift),
  // which an escaper applied to already-escaped SQL is outside of.
  const ALL_SANITIZERS: {
    name: string;
    fn: (s: string) => string;
    nameClean: boolean;
  }[] = [
    { name: "sanitizeSQLStatement", fn: sanitizeSQLStatement, nameClean: false },
    { name: "sanitizeColumnName", fn: sanitizeColumnName, nameClean: true },
    { name: "sanitizeTableName", fn: sanitizeTableName, nameClean: true },
    { name: "sanitizeFolderName", fn: sanitizeFolderName, nameClean: true },
    { name: "sanitizeFileName", fn: sanitizeFileName, nameClean: true },
    { name: "quoteIdent", fn: quoteIdent, nameClean: false },
  ];

  // Characterize the two escapers' INTENTIONAL non-idempotence so a future
  // "idempotency fix" cannot silently flip them and corrupt SQL escaping.
  it("(1b) the two ESCAPERS are intentionally NON-idempotent (re-escape on a 2nd pass)", () => {
    expect(sanitizeSQLStatement("a'b")).toBe("a''b");
    expect(sanitizeSQLStatement(sanitizeSQLStatement("a'b"))).toBe("a''''b");
    expect(quoteIdent("col")).toBe(`"col"`);
    expect(quoteIdent(quoteIdent("col"))).toBe(`"""col"""`);
  });

  // -----------------------------------------------------------------------
  // (1) UNIVERSAL IDEMPOTENCE — sanitize(sanitize(x)) === sanitize(x) for every
  //     name-cleansing sanitizer, over the adversarial corpus at a fixed seed.
  //     This is the post-D1/D3 invariant: NO name sanitizer may drift its result
  //     on a second application (a re-save must never relocate row identity —
  //     ADR 0014/0016). sanitizeSQLStatement and sanitizeTableName were always
  //     idempotent; sanitizeColumnName (D3) and sanitizeFolderName (D1) now are.
  // -----------------------------------------------------------------------
  describe("(1) IDEMPOTENCE — every name-cleansing sanitizer is a fixed point", () => {
    for (const { name, fn, nameClean } of ALL_SANITIZERS) {
      if (!nameClean) continue;
      it(`${name}: sanitize(sanitize(x)) === sanitize(x) over the adversarial corpus`, () => {
        const rng = makeRng(0x1de_a + name.length); // fixed, function-specific seed
        for (let i = 0; i < PROPERTY_RUNS; i++) {
          const input = adversarialString(rng);
          const once = fn(input);
          expect(fn(once)).toBe(once);
        }
      });
    }

    // The exact former-defect cases, pinned at the universal layer so they can
    // never silently regress regardless of which function-local suite changes.
    it("the formerly non-idempotent cases now settle in ONE application (D1 + D3)", () => {
      // D3 (sanitizeColumnName): a quote-masked leading sigil.
      expect(sanitizeColumnName(`"$x`)).toBe("x");
      expect(sanitizeColumnName(sanitizeColumnName(`"$x`))).toBe("x");
      // D1 (sanitizeFolderName): an illegal-masked leading sigil, and the reverse
      // (a leading sigil masking an anchored device name) — both settle at once.
      expect(sanitizeFolderName("/+")).toBe("");
      expect(sanitizeFolderName(sanitizeFolderName("/+"))).toBe("");
      expect(sanitizeFolderName("+con")).toBe("");
      expect(sanitizeFolderName(sanitizeFolderName("+con"))).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // (2) UNIVERSAL NULLISH CONTRACT — the unified D2 contract holds for BOTH null
  //     AND undefined on EVERY export. Generalises the point check in the
  //     CROSS-FUNCTION block: rather than hand-listing examples we assert, for
  //     every export, that null and undefined are each treated IDENTICALLY to the
  //     empty-string input (no throw, no stray `undefined`). quoteIdent's empty
  //     case is the wrapped empty identifier `'""'`; the other five are `''`.
  // -----------------------------------------------------------------------
  describe("(2) NULLISH CONTRACT — null and undefined === the '' result on every export", () => {
    for (const { name, fn } of ALL_SANITIZERS) {
      it(`${name}: null -> fn(''), undefined -> fn(''), neither throws`, () => {
        const empty = fn("");
        expect(() => fn(null as unknown as string)).not.toThrow();
        expect(() => fn(undefined as unknown as string)).not.toThrow();
        expect(fn(null as unknown as string)).toBe(empty);
        expect(fn(undefined as unknown as string)).toBe(empty);
        // No export may emit the literal stray `undefined` text on nullish input.
        expect(fn(null as unknown as string)).not.toContain("undefined");
        expect(fn(undefined as unknown as string)).not.toContain("undefined");
      });
    }
    it("the concrete empty results are the documented D2 values", () => {
      expect(sanitizeSQLStatement("")).toBe("");
      expect(sanitizeColumnName("")).toBe("");
      expect(sanitizeTableName("")).toBe("");
      expect(sanitizeFolderName("")).toBe("");
      expect(sanitizeFileName("")).toBe("");
      expect(quoteIdent("")).toBe(`""`);
    });
  });

  // -----------------------------------------------------------------------
  // (3) UNIVERSAL OUTPUT-CHARSET INVARIANTS — each export's output-shape
  //     guarantee, asserted over the adversarial corpus at fixed seeds.
  // -----------------------------------------------------------------------
  describe("(3) OUTPUT-CHARSET invariants over the adversarial corpus", () => {
    const ILLEGAL_CHARS = `/?<>\\:*|"`;
    const hasControl = (s: string) => /[\x00-\x1f\x80-\x9f]/.test(s);

    it("sanitizeFolderName: no illegal/control char, and never begins with a reserved sigil +/$/#/^", () => {
      const rng = makeRng(0xf01de7);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const out = sanitizeFolderName(adversarialString(rng));
        for (const ch of ILLEGAL_CHARS) expect(out).not.toContain(ch);
        expect(hasControl(out)).toBe(false);
        if (out.length > 0) {
          expect(/[+$#^]/.test(out.charAt(0))).toBe(false);
        }
      }
    });

    it("sanitizeFileName: no illegal/control char in output", () => {
      const rng = makeRng(0xf11e5);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const out = sanitizeFileName(adversarialString(rng));
        for (const ch of ILLEGAL_CHARS) expect(out).not.toContain(ch);
        expect(hasControl(out)).toBe(false);
      }
    });

    it("sanitizeColumnName: output has NO double-quote and never begins with _/$", () => {
      const rng = makeRng(0xc01);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const out = sanitizeColumnName(adversarialString(rng));
        expect(out).not.toContain(`"`);
        if (out.length > 0) {
          expect(out.charAt(0) === "_" || out.charAt(0) === "$").toBe(false);
        }
      }
    });

    it("sanitizeTableName: output is allow-list-only [A-Za-z0-9+]", () => {
      const rng = makeRng(0x7ab);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const out = sanitizeTableName(adversarialString(rng));
        expect(/^[A-Za-z0-9+]*$/.test(out)).toBe(true);
      }
    });

    it("sanitizeSQLStatement: output has no lone single-quote (every `'` is part of a `''` pair)", () => {
      const rng = makeRng(0x59c);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const input = adversarialString(rng);
        const out = sanitizeSQLStatement(input);
        // Removing every doubled pair leaves no stray single quote, and
        // un-escaping recovers the input exactly (no breakout, no loss).
        expect(out.replace(/''/g, "")).not.toContain("'");
        expect(out.replace(/''/g, "'")).toBe(input);
      }
    });

    it("quoteIdent: output is always a balanced double-quoted identifier with internal quotes doubled (no breakout)", () => {
      const rng = makeRng(0x9d7);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const input = adversarialString(rng);
        const out = quoteIdent(input);
        // Wrapped, length >= 2.
        expect(out.length).toBeGreaterThanOrEqual(2);
        expect(out.startsWith(`"`)).toBe(true);
        expect(out.endsWith(`"`)).toBe(true);
        // Interior contains ONLY doubled quotes (even count): stripping `""`
        // pairs leaves no stray `"`, so the identifier cannot be terminated early.
        const interior = out.slice(1, -1);
        expect(interior.replace(/""/g, "")).not.toContain(`"`);
        // Round-trip: a parser un-escaping `""`->`"` recovers the exact input.
        expect(interior.replace(/""/g, `"`)).toBe(input);
      }
    });
  });
});
