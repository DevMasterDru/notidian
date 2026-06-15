import {
  parseCsv,
  parseCsvToRecords,
  serializeCsv,
  tableToCsv,
} from "core/utils/contexts/tableCsv";

describe("serializeCsv (RFC 4180)", () => {
  it("joins plain cells with commas and rows with newlines", () => {
    expect(
      serializeCsv([
        ["a", "b"],
        ["c", "d"],
      ])
    ).toBe("a,b\nc,d");
  });

  it("quotes cells containing a comma, quote, or newline", () => {
    expect(serializeCsv([["a,b", 'he said "hi"', "line1\nline2"]])).toBe(
      '"a,b","he said ""hi""","line1\nline2"'
    );
  });

  it("leaves empty cells empty (unquoted)", () => {
    expect(serializeCsv([["", "x", ""]])).toBe(",x,");
  });
});

describe("parseCsv (RFC 4180)", () => {
  it("parses plain rows", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses quoted fields with embedded commas and newlines", () => {
    expect(parseCsv('"a,b","line1\nline2"')).toEqual([["a,b", "line1\nline2"]]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsv('"he said ""hi"""')).toEqual([['he said "hi"']]);
  });

  it("accepts CRLF and a trailing newline without an extra empty row", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns an empty grid for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n")).toEqual([["   "]]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("keeps a bare mid-field quote literal instead of corrupting the row", () => {
    expect(parseCsv('a"b,c')).toEqual([['a"b', "c"]]);
  });

  it("recovers an unterminated quoted field at EOF", () => {
    expect(parseCsv('"abc')).toEqual([["abc"]]);
  });
});

describe("round trip", () => {
  it("parse(serialize(x)) === x for tricky values", () => {
    const grid = [
      ["name", "note"],
      ["A, Inc", 'quote " and , comma'],
      ["multi\nline", ""],
    ];
    expect(parseCsv(serializeCsv(grid))).toEqual(grid);
  });
});

describe("tableToCsv", () => {
  it("emits a header from column names and string cells by key", () => {
    const csv = tableToCsv({
      columns: [
        { key: "NameFile", name: "Name" },
        { key: "statusctx", name: "Status" },
      ],
      rows: [
        { NameFile: "Alpha", statusctx: "active" },
        { NameFile: "Beta, Co", statusctx: 2 },
      ],
    });
    expect(csv).toBe('Name,Status\nAlpha,active\n"Beta, Co",2');
  });
});

describe("parseCsvToRecords", () => {
  it("maps header columns to per-row records and skips fully-empty rows", () => {
    const result = parseCsvToRecords("Name,Status\nAlpha,active\n,\nBeta,done");
    expect(result.headers).toEqual(["Name", "Status"]);
    expect(result.rows).toEqual([
      { Name: "Alpha", Status: "active" },
      { Name: "Beta", Status: "done" },
    ]);
  });

  it("returns empties for blank input", () => {
    expect(parseCsvToRecords("")).toEqual({ headers: [], rows: [] });
  });
});

// ===========================================================================
// DEPTH (Q1) — seeded property + adversarial RFC-4180 round-trip net for
// tableCsv.ts (Notidian-9g8). The example tests above prove a handful of
// hand-picked values; this net proves the *invariants* over thousands of
// arbitrary grids, then pins every adversarial edge of the import/export
// surface (the Notion-parity import/export roadmap item) so a future change is
// a conscious, reviewed decision.
//
// Everything here is PURE / OFFLINE — string in, string out, no DOM, no vault,
// no I/O — so it lives in the default jest `node` env alongside the examples.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency, matching src/shared/utils/array.test.ts and sanitizers.test.ts.
//
// CHARACTERIZATION, NOT CORRECTION. We LOCK the current observable behaviour,
// including these surfaced/known latent properties (no code is changed here):
//
//   (C1) THE ONE ROUND-TRIP HOLE — `parseCsv(serializeCsv(grid)) === grid`
//        holds for EVERY grid EXCEPT one shape: a grid whose LAST row is
//        exactly `[""]` (a single-element row whose sole cell is the empty
//        string). serializeCsv joins rows with "\n" and that final row
//        contributes an empty trailing segment that is indistinguishable from
//        "no trailing row" — parseCsv treats a text ending on a row break (or
//        empty text) as having no final empty row. This is the documented
//        degenerate `[['']]` -> "no data" design (see tableCsv.ts header
//        comment), now PINNED exactly: it is *only* the last-row-is-[""] shape,
//        not internal/leading lone-empty rows, not multi-empty-cell rows. The
//        property generator therefore excludes that single shape; an explicit
//        characterization block pins the hole itself.
//
//   (C2) BOM IS NOT STRIPPED by parseCsv — a leading U+FEFF becomes part of the
//        first header cell verbatim. parseCsvToRecords then `.trim()`s headers,
//        and JS String.prototype.trim() DOES treat U+FEFF as whitespace, so the
//        BOM is incidentally removed from the *record* header key but NOT from
//        the raw parseCsv grid. Both facts are pinned.
//
//   (C3) DUPLICATE HEADERS in parseCsvToRecords — `headers.forEach` writes each
//        cell under its header key, so a later duplicate-named column silently
//        CLOBBERS the earlier one's value in the per-row record (last-write-
//        wins), and headers[] still lists the duplicate. Caller-dependent
//        behaviour: characterized, not changed. See follow-up bead Notidian-5zc.
//
//   (C4) RAGGED ROWS — a row SHORTER than the header maps missing cells to ""
//        (the `cells[index] ?? ""`); a row LONGER than the header silently drops
//        the surplus cells (only header indices are read). Both pinned.
//
//   (C5) LONE CR, CRLF, and LF are all single row breaks; a mid-data \r\n is one
//        break, never two. serializeCsv only ever emits "\n" between rows.
// ===========================================================================

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
const PROPERTY_RUNS = 500;

// An alphabet deliberately stocked with every byte class the parser special-
// cases plus benign filler — commas, quotes, all three newline bytes, control
// chars (incl. NUL and TAB), ASCII letters/digits, multi-byte unicode, and a
// surrogate-pair emoji. Picking cells from this pool exercises the quoting and
// state-machine branches far more densely than random codepoints would.
const CELL_ALPHABET = [
  "",
  "a",
  "B",
  "9",
  " ",
  ",",
  '"',
  '""',
  "\n",
  "\r",
  "\r\n",
  "\t",
  "\x00",
  "\x01",
  "\x1f",
  "é",
  "中",
  "\u{1F600}", // surrogate pair (emoji)
  "ab,cd",
  'q"q',
  "x\ny",
  "x\r\ny",
  "leading\rmix\nbreaks",
];

const randomCell = (rng: () => number): string => {
  // Mix: usually pick a single token from the alphabet; sometimes concatenate a
  // few to build adversarial composites (e.g. a quote next to a comma).
  const parts = randInt(rng, 1, 3);
  let cell = "";
  for (let p = 0; p < parts; p++) {
    cell += CELL_ALPHABET[randInt(rng, 0, CELL_ALPHABET.length - 1)];
  }
  return cell;
};

const randomGrid = (rng: () => number): string[][] => {
  const rowCount = randInt(rng, 1, 6);
  const colCount = randInt(rng, 1, 5);
  return Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => randomCell(rng))
  );
};

// The single documented round-trip hole (C1): a grid whose LAST row is exactly
// a one-element row holding the empty string. Excluded from the round-trip
// generator (and pinned separately below).
const lastRowIsLoneEmpty = (grid: string[][]): boolean => {
  const last = grid[grid.length - 1];
  return last.length === 1 && last[0] === "";
};

// Re-derive the spec's minimal-quoting rule independently of the implementation
// so the property is a genuine cross-check, not a tautology.
const cellNeedsQuoting = (cell: string): boolean =>
  cell.includes(",") ||
  cell.includes('"') ||
  cell.includes("\n") ||
  cell.includes("\r");

describe("DEPTH property net — round-trip invariant", () => {
  it("parseCsv(serializeCsv(grid)) === grid for arbitrary string grids", () => {
    const rng = makeRng(0xc5fb01);
    let exercised = 0;
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const grid = randomGrid(rng);
      // Skip ONLY the documented degenerate shape (C1); everything else must
      // round-trip exactly, including embedded commas/quotes/CR/LF/CRLF, NUL,
      // control chars, unicode, surrogate pairs, and empty cells.
      if (lastRowIsLoneEmpty(grid)) continue;
      exercised++;
      const csv = serializeCsv(grid);
      const back = parseCsv(csv);
      expect(back).toEqual(grid);
    }
    // Guard against an over-eager skip silently neutering the suite.
    expect(exercised).toBeGreaterThan(PROPERTY_RUNS * 0.8);
  });

  it("serializeCsv quoting is MINIMAL and CORRECT (only quotes when needed)", () => {
    const rng = makeRng(0x9ec0de);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const grid = randomGrid(rng);
      const csv = serializeCsv(grid);
      const lines = csv.split("\n");
      // We can only line-split safely when no cell embeds a newline; otherwise
      // a single field spans multiple textual lines. Re-parse instead and check
      // the produced token for each cell directly.
      void lines;
      grid.forEach((row) => {
        row.forEach((cell) => {
          // Serialize the single cell the same way the module does and assert
          // the minimal-quoting contract: quoted IFF it must be, and a quoted
          // field doubles interior quotes and is wrapped in exactly one pair.
          const single = serializeCsv([[cell]]);
          if (cellNeedsQuoting(cell)) {
            expect(single.startsWith('"')).toBe(true);
            expect(single.endsWith('"')).toBe(true);
            // interior content is the cell with quotes doubled
            const interior = single.slice(1, -1);
            expect(interior).toBe(cell.replace(/"/g, '""'));
          } else {
            // Not needing quotes => emitted verbatim, no wrapping quotes.
            expect(single).toBe(cell);
          }
        });
      });
    }
  });

  it("re-serializing a round-tripped grid is idempotent (serialize∘parse∘serialize)", () => {
    const rng = makeRng(0x1de3a1);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const grid = randomGrid(rng);
      if (lastRowIsLoneEmpty(grid)) continue;
      const once = serializeCsv(grid);
      const twice = serializeCsv(parseCsv(once));
      expect(twice).toBe(once);
    }
  });

  it("parseCsv is idempotent under re-serialization for arbitrary CSV text", () => {
    // Generate arbitrary CSV TEXT (not via serialize) and assert the parse is a
    // fixed point once normalized through serialize: parse(text) and
    // parse(serialize(parse(text))) agree. This catches asymmetries the
    // grid-first generator can't reach (e.g. lone CR vs CRLF normalization).
    const rng = makeRng(0x7ab1e);
    const noise = [",", '"', "\r", "\n", "\r\n", "a", "1", " ", '""', "\x00"];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const len = randInt(rng, 0, 24);
      let text = "";
      for (let i = 0; i < len; i++)
        text += noise[randInt(rng, 0, noise.length - 1)];
      const first = parseCsv(text);
      // Skip the one documented hole (C1): if the parsed grid's LAST row is the
      // lone-empty `[""]`, re-serialization legitimately drops it. Every other
      // parse is a fixed point under serialize.
      if (first.length > 0 && lastRowIsLoneEmpty(first)) continue;
      const normalized = parseCsv(serializeCsv(first));
      expect(normalized).toEqual(first);
    }
  });
});

describe("DEPTH adversarial — round-trip hole (C1)", () => {
  it("the ONLY non-round-tripping shape is a grid whose last row is exactly ['']", () => {
    // The hole itself (degenerate "no data" by design):
    expect(parseCsv(serializeCsv([[""]]))).toEqual([]);
    expect(parseCsv(serializeCsv([["a"], [""]]))).toEqual([["a"]]);
    expect(parseCsv(serializeCsv([[""], [""]]))).toEqual([[""]]);
    expect(parseCsv(serializeCsv([["x"], ["", ""], [""]]))).toEqual([
      ["x"],
      ["", ""],
    ]);
  });

  it("a lone-empty row that is NOT last DOES round-trip", () => {
    expect(parseCsv(serializeCsv([[""], ["a"]]))).toEqual([[""], ["a"]]);
    expect(parseCsv(serializeCsv([["x"], [""], ["y"]]))).toEqual([
      ["x"],
      [""],
      ["y"],
    ]);
    expect(parseCsv(serializeCsv([[""], [""], ["a"]]))).toEqual([
      [""],
      [""],
      ["a"],
    ]);
  });

  it("a last row of TWO empty cells round-trips (distinguishable from no-row)", () => {
    expect(parseCsv(serializeCsv([["", ""]]))).toEqual([["", ""]]);
    expect(parseCsv(serializeCsv([["x"], ["", ""]]))).toEqual([["x"], ["", ""]]);
  });
});

describe("DEPTH adversarial — newline mixing (C5)", () => {
  it("lone CR, LF, and CRLF are each a SINGLE row break", () => {
    expect(parseCsv("a\rb")).toEqual([["a"], ["b"]]);
    expect(parseCsv("a\nb")).toEqual([["a"], ["b"]]);
    expect(parseCsv("a\r\nb")).toEqual([["a"], ["b"]]);
  });

  it("mixed CR / LF / CRLF in one document split row-by-row", () => {
    expect(parseCsv("a\r\nb\nc\rd")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("CRLF is never split into two rows (the \\r consumes the following \\n)", () => {
    expect(parseCsv("x,y\r\n")).toEqual([["x", "y"]]);
    expect(parseCsv("x,y\r\n\r\n")).toEqual([["x", "y"], [""]]);
  });

  it("embedded CR / LF / CRLF survive verbatim inside a quoted field", () => {
    expect(parseCsv('"a\rb"')).toEqual([["a\rb"]]);
    expect(parseCsv('"a\nb"')).toEqual([["a\nb"]]);
    expect(parseCsv('"a\r\nb"')).toEqual([["a\r\nb"]]);
  });

  it("serializeCsv only ever emits \\n between rows", () => {
    expect(serializeCsv([["a"], ["b"]])).toBe("a\nb");
    // a cell containing CR is quoted but the row SEPARATOR is still \n
    expect(serializeCsv([["a\r"], ["b"]])).toBe('"a\r"\nb');
  });
});

describe("DEPTH adversarial — quoting edges", () => {
  it("a fully-quoted empty field is the empty string, distinct from no field", () => {
    expect(parseCsv('""')).toEqual([]); // sole empty cell => degenerate (C1)
    expect(parseCsv('"",x')).toEqual([["", "x"]]);
    expect(parseCsv('x,""')).toEqual([["x", ""]]);
  });

  it("a bare empty field equals a quoted empty field after parsing", () => {
    expect(parseCsv(",x")).toEqual([["", "x"]]);
    expect(parseCsv('"",x')).toEqual([["", "x"]]);
  });

  it("a bare mid-field quote is kept literal (malformed-input recovery)", () => {
    expect(parseCsv('a"b,c')).toEqual([['a"b', "c"]]);
  });

  it("characterize: a closing quote followed by more chars folds into one cell", () => {
    // '"a"b"' -> opens, 'a', closes at the 2nd ", then bare 'b', then a bare
    // mid-field '"' kept literal => 'ab"'. Pinned as current recovery behaviour.
    expect(parseCsv('"a"b"')).toEqual([['ab"']]);
  });

  it("an unterminated quoted field is recovered at EOF", () => {
    expect(parseCsv('"abc')).toEqual([["abc"]]);
    expect(parseCsv('"a,b')).toEqual([["a,b"]]);
  });
});

describe("DEPTH adversarial — control chars, NUL, unicode, surrogate pairs", () => {
  it("embedded NUL is preserved verbatim (never a terminator) and not quoted", () => {
    expect(parseCsv("a\x00b,c")).toEqual([["a\x00b", "c"]]);
    expect(serializeCsv([["a\x00b", "c"]])).toBe("a\x00b,c");
    expect(parseCsv(serializeCsv([["a\x00b"]]))).toEqual([["a\x00b"]]);
  });

  it("TAB and other C0 control chars are ordinary data (TAB is NOT a delimiter)", () => {
    expect(parseCsv("a\tb")).toEqual([["a\tb"]]);
    expect(serializeCsv([["a\tb"]])).toBe("a\tb");
    expect(parseCsv("a\x01\x1fb")).toEqual([["a\x01\x1fb"]]);
  });

  it("multi-byte unicode round-trips", () => {
    expect(parseCsv(serializeCsv([["é", "中", "Ωμ"]]))).toEqual([
      ["é", "中", "Ωμ"],
    ]);
  });

  it("surrogate-pair emoji round-trip exactly (no splitting)", () => {
    const grid = [["a\u{1F600}b", "\u{1F4A9}\u{1F680}"]];
    expect(parseCsv(serializeCsv(grid))).toEqual(grid);
  });
});

describe("DEPTH adversarial — BOM (C2)", () => {
  it("parseCsv does NOT strip a leading BOM: it stays in the first header cell", () => {
    expect(parseCsv("﻿Name,Age\nA,1")).toEqual([
      ["﻿Name", "Age"],
      ["A", "1"],
    ]);
  });

  it("parseCsvToRecords incidentally trims the BOM off the header KEY (.trim covers U+FEFF)", () => {
    const result = parseCsvToRecords("﻿Name,Age\nA,1");
    expect(result.headers).toEqual(["Name", "Age"]);
    expect(result.rows).toEqual([{ Name: "A", Age: "1" }]);
    // ...but a BOM inside a DATA cell is preserved (only headers are trimmed).
    const withDataBom = parseCsvToRecords("Name\n﻿value");
    expect(withDataBom.rows).toEqual([{ Name: "﻿value" }]);
  });
});

describe("DEPTH adversarial — parseCsvToRecords mapping (C3, C4)", () => {
  it("CHARACTERIZE: duplicate headers — later column clobbers earlier (last-write-wins)", () => {
    // 'a' appears twice; the record keeps the SECOND 'a' (value 2), losing 1.
    // headers[] still lists the duplicate. Caller-dependent; NOT changed here.
    // Follow-up: Notidian-5zc.
    const result = parseCsvToRecords("a,a,b\n1,2,3");
    expect(result.headers).toEqual(["a", "a", "b"]);
    expect(result.rows).toEqual([{ a: "2", b: "3" }]);
  });

  it("ragged SHORT row: missing trailing cells become '' (cells[index] ?? '')", () => {
    const result = parseCsvToRecords("a,b,c\n1,2");
    expect(result.rows).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("ragged LONG row: surplus cells beyond the header are silently dropped", () => {
    const result = parseCsvToRecords("a,b\n1,2,3,4");
    expect(result.headers).toEqual(["a", "b"]);
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("fully-empty data rows are skipped, blank-but-present cells in a non-empty row are kept", () => {
    const result = parseCsvToRecords("a,b\n,\nx,\n,y");
    // first data row ',' is fully empty -> skipped; the other two survive.
    expect(result.rows).toEqual([
      { a: "x", b: "" },
      { a: "", b: "y" },
    ]);
  });

  it("headers are trimmed but data cells are not", () => {
    const result = parseCsvToRecords("  Name  , Age \n  Al  , 9 ");
    expect(result.headers).toEqual(["Name", "Age"]);
    expect(result.rows).toEqual([{ Name: "  Al  ", Age: " 9 " }]);
  });
});

describe("DEPTH adversarial — empty / degenerate inputs", () => {
  it("empty string parses to an empty grid; empty grid serializes to empty string", () => {
    expect(parseCsv("")).toEqual([]);
    expect(serializeCsv([])).toBe("");
  });

  it("serializeCsv coerces null/undefined cells to '' (cell ?? '')", () => {
    expect(serializeCsv([["a", undefined as unknown as string]])).toBe("a,");
    expect(serializeCsv([[null as unknown as string, "b"]])).toBe(",b");
  });

  it("a row of two empty cells is NOT skipped by parseCsv (only fully-blank rows are dropped by parseCsvToRecords)", () => {
    expect(parseCsv(",")).toEqual([["", ""]]);
  });

  it("whitespace-only input parses to one whitespace cell (parseCsv does not trim)", () => {
    expect(parseCsv("   ")).toEqual([["   "]]);
    expect(parseCsv("   \n")).toEqual([["   "]]);
  });
});

describe("DEPTH adversarial — tableToCsv projection", () => {
  it("null/undefined cell values project to '' and non-strings are stringified", () => {
    const csv = tableToCsv({
      columns: [
        { key: "a", name: "A" },
        { key: "b", name: "B" },
      ],
      rows: [
        { a: null, b: 2 },
        { a: undefined, b: true },
        { a: "x,y", b: 'q"q' },
      ],
    });
    expect(csv).toBe('A,B\n,2\n,true\n"x,y","q""q"');
  });

  it("a column name needing quotes is quoted in the header row", () => {
    const csv = tableToCsv({
      columns: [{ key: "k", name: "A,B" }],
      rows: [{ k: "v" }],
    });
    expect(csv).toBe('"A,B"\nv');
  });
});
