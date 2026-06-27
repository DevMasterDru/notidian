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
 *   - All terminal row separators are trimmed so spreadsheet clipboards that append
 *     \n\n do not create phantom empty rows.
 *   - RFC-4180-style quote handling keeps quoted tabs/newlines inside their cell
 *     and doubles embedded quotes on encode/decode.
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

  describe("trailing-newline trimming removes terminal row separators", () => {
    it("trims a trailing LF", () => {
      expect(parseTableClipboardText("A\n")).toEqual([["A"]]);
    });

    it("trims a trailing CRLF (normalized then trimmed)", () => {
      expect(parseTableClipboardText("A\r\n")).toEqual([["A"]]);
    });

    it("trims Google Sheets double trailing LF without creating a phantom empty row", () => {
      expect(parseTableClipboardText("A\n\n")).toEqual([["A"]]);
    });

    it("trims multiple trailing bare-CR row separators too (CR->LF first)", () => {
      expect(parseTableClipboardText("A\r\r")).toEqual([["A"]]);
    });

    it("trims more than two trailing row separators", () => {
      expect(parseTableClipboardText("A\n\n\n")).toEqual([["A"]]);
    });

    it("preserves a genuine empty line in the MIDDLE of the grid", () => {
      expect(parseTableClipboardText("A\n\nB")).toEqual([["A"], [""], ["B"]]);
    });
  });

  describe("quoted TSV fields", () => {
    it("dequotes a surrounding quoted field", () => {
      expect(parseTableClipboardText('"hello"')).toEqual([["hello"]]);
    });

    it("keeps a TAB inside quotes in the same cell", () => {
      expect(parseTableClipboardText('"a\tb"\tc')).toEqual([["a\tb", "c"]]);
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

    it("round-trips cells that contain a TAB", () => {
      const grid = [["a\tb"]];
      const serialized = serializeTableClipboardGrid(grid);
      expect(serialized).toBe('"a\tb"');
      expect(parseTableClipboardText(serialized)).toEqual(grid);
    });

    it("round-trips a cell containing a newline", () => {
      const grid = [["a\nb"]];
      const serialized = serializeTableClipboardGrid(grid);
      expect(serialized).toBe('"a\nb"');
      expect(parseTableClipboardText(serialized)).toEqual(grid);
    });
  });
});
