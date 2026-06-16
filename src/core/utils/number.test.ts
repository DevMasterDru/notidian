/**
 * DEPTH (render-path fail-soft) net for src/core/utils/number.ts — Notidian-aqjz.
 *
 * safeFormatNumber is the render-path number formatter used by NumberCell.tsx:
 *
 *   value != null
 *     ? safeFormatNumber(format, parseFloat(value))
 *     : ...
 *
 * The `format` string is USER-CONTROLLED property config (a numfmt pattern). A
 * malformed pattern makes numfmt's `format()` THROW (e.g. "Illegal character").
 * Inside a render path an uncaught throw blanks/crashes the cell. So the
 * contract is FAIL-SOFT:
 *
 *   export const safeFormatNumber = (format, value) => {
 *     try { return formatNumber(format, value); }
 *     catch { return value.toString(); }
 *   };
 *
 * This net pins:
 *   (1) a bad/throwing format falls back to value.toString() — across the nasty
 *       numeric edges NaN / Infinity / -Infinity / -0 / very-large — and never
 *       throws out of the render path;
 *   (2) a VALID format actually formats (so the fallback is not masking a
 *       no-op).
 *
 * Pure offline net (testEnvironment:node), exercises the real numfmt library.
 */
import { safeFormatNumber } from "./number";

// A pattern numfmt rejects ("Illegal character: N") — drives the catch branch.
const BAD_FORMAT = "NOT_A_FORMAT";
// A valid numfmt pattern.
const GOOD_FORMAT = "0.00";

describe("safeFormatNumber — fail-soft on a throwing format", () => {
  it("does NOT throw on a malformed format string", () => {
    expect(() => safeFormatNumber(BAD_FORMAT, 42)).not.toThrow();
  });

  it("falls back to value.toString() for a finite number when the format throws", () => {
    expect(safeFormatNumber(BAD_FORMAT, 42)).toBe((42).toString());
    expect(safeFormatNumber(BAD_FORMAT, 42)).toBe("42");
    expect(safeFormatNumber(BAD_FORMAT, 3.14)).toBe("3.14");
    expect(safeFormatNumber(BAD_FORMAT, -7)).toBe("-7");
  });

  it("falls back to value.toString() for NaN", () => {
    expect(safeFormatNumber(BAD_FORMAT, NaN)).toBe(NaN.toString());
    expect(safeFormatNumber(BAD_FORMAT, NaN)).toBe("NaN");
  });

  it("falls back to value.toString() for Infinity and -Infinity", () => {
    expect(safeFormatNumber(BAD_FORMAT, Infinity)).toBe(Infinity.toString());
    expect(safeFormatNumber(BAD_FORMAT, Infinity)).toBe("Infinity");
    expect(safeFormatNumber(BAD_FORMAT, -Infinity)).toBe("-Infinity");
  });

  it("falls back to value.toString() for -0 (which stringifies to '0')", () => {
    // (-0).toString() === "0" — pin that the fallback does NOT preserve the sign.
    expect(safeFormatNumber(BAD_FORMAT, -0)).toBe((-0).toString());
    expect(safeFormatNumber(BAD_FORMAT, -0)).toBe("0");
  });

  it("falls back to value.toString() for very large magnitudes (incl. overflow to Infinity)", () => {
    expect(safeFormatNumber(BAD_FORMAT, 1e308)).toBe((1e308).toString());
    expect(safeFormatNumber(BAD_FORMAT, Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER.toString()
    );
    // 1e309 overflows to Infinity → "Infinity".
    expect(safeFormatNumber(BAD_FORMAT, 1e309)).toBe("Infinity");
  });
});

describe("safeFormatNumber — valid format actually formats", () => {
  it("formats a finite number with a valid pattern (not a no-op fallback)", () => {
    const out = safeFormatNumber(GOOD_FORMAT, 42);
    expect(out).toBe("42.00");
    // Guard: this is the FORMATTED output, distinct from the bare toString().
    expect(out).not.toBe((42).toString());
  });

  it("applies a thousands-separator pattern", () => {
    expect(safeFormatNumber("#,##0", 1234567)).toBe("1,234,567");
  });
});
