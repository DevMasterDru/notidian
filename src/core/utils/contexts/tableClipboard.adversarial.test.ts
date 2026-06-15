/**
 * Adversarial / characterization net for the FIRST stage of the spreadsheet-paste
 * seam: parseTableClipboardText (raw, untrusted clipboard text -> string[][] grid).
 *
 * The clipboard is an attacker / hostile-input surface — text arrives verbatim from
 * Excel, Google Sheets, Numbers, or a hand-typed paste and flows downstream into row
 * writes. These tests PIN the exact current parsing contract (Notidian-5g5a) so a
 * future "helpful" change (TSV de-quoting, whitespace trimming, multi-newline
 * stripping) cannot silently re-shape pasted data without a failing test.
 *
 * Pinned invariants (verified against the implementation, not assumed):
 *   - Line endings are normalized \r\n -> \n and \r -> \n BEFORE splitting.
 *   - Exactly ONE trailing newline is trimmed (anchored /\n$/), never more — so an
 *     intentional trailing empty row survives.
 *   - Cells are split on raw TAB; there is NO RFC-4180 / Excel quote handling, so a
 *     quoted cell keeps its quotes and an embedded TAB inside quotes still splits.
 *   - Leading/trailing whitespace inside a cell is preserved verbatim.
 *   - Empty input and a single newline both collapse to the [[""]] single-empty grid.
 *   - Ragged rows are preserved AS-IS (the plan layer, not the parser, rectangularizes).
 */
import {
  parseTableClipboardText,
  serializeTableClipboardGrid,
} from "./tableClipboard";

describe("parseTableClipboardText — adversarial clipboard input", () => {
  describe("line-ending normalization", () => {
    it("normalizes CRLF to a row break", () => {
      expect(parseTableClipboardText("A\r\nB")).toEqual([["A"], ["B"]]);
    });

    it("normalizes a bare CR (classic Mac / some Excel exports) to a row break", () => {
      expect(parseTableClipboardText("A\rB")).toEqual([["A"], ["B"]]);
    });

    it("treats mixed CRLF + LF + CR consistently after normalization", () => {
      expect(parseTableClipboardText("A\r\nB\nC\rD")).toEqual([
        ["A"],
        ["B"],
        ["C"],
        ["D"],
      ]);
    });
  });

  describe("trailing-newline trimming is single and anchored", () => {
    it("trims exactly one trailing LF", () => {
      expect(parseTableClipboardText("A\n")).toEqual([["A"]]);
    });

    it("trims exactly one trailing CRLF (normalized then trimmed)", () => {
      expect(parseTableClipboardText("A\r\n")).toEqual([["A"]]);
    });

    it("KEEPS an intentional trailing empty row when there are two trailing newlines", () => {
      // "A\n\n" -> trim ONE -> "A\n" -> split -> [["A"], [""]]
      expect(parseTableClipboardText("A\n\n")).toEqual([["A"], [""]]);
    });

    it("KEEPS the trailing empty row for a double bare-CR too (CR->LF first)", () => {
      // "A\r\r" -> "A\n\n" -> trim one -> "A\n" -> [["A"], [""]]
      expect(parseTableClipboardText("A\r\r")).toEqual([["A"], [""]]);
    });

    it("preserves a genuine empty line in the MIDDLE of the grid", () => {
      expect(parseTableClipboardText("A\n\nB")).toEqual([["A"], [""], ["B"]]);
    });
  });

  describe("no TSV / RFC-4180 quote handling (quotes are literal)", () => {
    it("keeps surrounding double-quotes as literal cell characters", () => {
      expect(parseTableClipboardText('"hello"')).toEqual([['"hello"']]);
    });

    it("does NOT treat a TAB inside quotes as escaped — it still splits the cell", () => {
      // Excel would emit "a\tb" as one cell; Notidian splits it into two.
      expect(parseTableClipboardText('"a\tb"\tc')).toEqual([['"a', 'b"', "c"]]);
    });

    it("keeps embedded quotes verbatim (no doubled-quote unescaping)", () => {
      expect(parseTableClipboardText('say ""hi""\tok')).toEqual([
        ['say ""hi""', "ok"],
      ]);
    });

    it("does not collapse a comma-containing cell (commas are not delimiters)", () => {
      expect(parseTableClipboardText("a,b,c\td")).toEqual([["a,b,c", "d"]]);
    });
  });

  describe("whitespace and empty-cell preservation", () => {
    it("preserves leading and trailing in-cell whitespace verbatim", () => {
      expect(parseTableClipboardText("  a  \t b ")).toEqual([["  a  ", " b "]]);
    });

    it("turns a row of only TABs into the corresponding count of empty cells", () => {
      expect(parseTableClipboardText("\t\t")).toEqual([["", "", ""]]);
    });

    it("preserves an empty leading cell distinct from a missing cell", () => {
      // Leading TAB => first cell is "" (present-but-empty), then "b".
      expect(parseTableClipboardText("\tb")).toEqual([["", "b"]]);
    });
  });

  describe("empty / degenerate input collapses to the single-empty grid", () => {
    it("maps empty string to [[\"\"]]", () => {
      expect(parseTableClipboardText("")).toEqual([[""]]);
    });

    it("maps a lone newline to [[\"\"]]", () => {
      expect(parseTableClipboardText("\n")).toEqual([[""]]);
    });

    it("maps a lone CRLF to [[\"\"]]", () => {
      expect(parseTableClipboardText("\r\n")).toEqual([[""]]);
    });

    it("treats null/undefined input as empty (defensive ?? '')", () => {
      expect(parseTableClipboardText(undefined as unknown as string)).toEqual([
        [""],
      ]);
      expect(parseTableClipboardText(null as unknown as string)).toEqual([[""]]);
    });
  });

  describe("ragged rows are preserved by the parser (rectangularization is downstream)", () => {
    it("keeps a short row short and a long row long", () => {
      expect(parseTableClipboardText("a\tb\tc\nd")).toEqual([
        ["a", "b", "c"],
        ["d"],
      ]);
    });

    it("preserves interior empty cells in an otherwise full row", () => {
      expect(parseTableClipboardText("a\t\tc")).toEqual([["a", "", "c"]]);
    });
  });

  describe("parse <-> serialize round-trip on rectangular, delimiter-free grids", () => {
    it("round-trips a rectangular grid through serialize then parse", () => {
      const grid = [
        ["A", "B", "C"],
        ["d", "e", "f"],
      ];
      expect(parseTableClipboardText(serializeTableClipboardGrid(grid))).toEqual(
        grid
      );
    });

    it("round-trips a grid containing interior empty cells", () => {
      const grid = [
        ["A", "", "C"],
        ["", "e", ""],
      ];
      expect(parseTableClipboardText(serializeTableClipboardGrid(grid))).toEqual(
        grid
      );
    });

    it("does NOT round-trip cells that themselves contain a TAB (lossy by design)", () => {
      // A cell holding a TAB serializes to an extra delimiter and re-parses as two
      // cells — pinning that the TSV format cannot transport an in-cell TAB.
      const grid = [["a\tb"]];
      const serialized = serializeTableClipboardGrid(grid);
      expect(serialized).toBe("a\tb");
      expect(parseTableClipboardText(serialized)).toEqual([["a", "b"]]);
    });

    it("does NOT round-trip a cell containing a newline (lossy by design)", () => {
      const grid = [["a\nb"]];
      const serialized = serializeTableClipboardGrid(grid);
      // The in-cell newline becomes a row break on re-parse.
      expect(parseTableClipboardText(serialized)).toEqual([["a"], ["b"]]);
    });
  });
});
