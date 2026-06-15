/**
 * Characterization + adversarial net for the table-view row-visibility engine
 * (src/core/utils/contexts/predicate/filter.ts) — Notidian-3fs.
 *
 * filter.ts had ZERO direct test coverage: no test imported it, and
 * predicate.test.ts only exercises validatePredicate. These tests PIN the
 * CURRENT shipped behavior of every filter predicate function and of
 * filterReturnForCol — including latent defects — so that any future change is
 * a deliberate, reviewed decision rather than an accident. They do NOT change
 * src; real bugs are recorded as follow-up beads (see end-of-file note).
 *
 * Conventions for adversarial cases:
 *  - Where current behavior THROWS on hostile input, we assert `toThrow` and
 *    label it a defect-pin so the throw is visible and intentional to pin.
 *  - Date assertions use noon-local instants and unambiguous calendar dates to
 *    stay deterministic regardless of the host timezone; "today" comparisons
 *    derive the expected value from `new Date()` rather than hardcoding it.
 */
import {
  startsWith,
  endsWith,
  lengthEquals,
  listEquals,
  stringEqual,
  empty,
  stringCompare,
  greaterThan,
  lessThan,
  dateAfter,
  dateBefore,
  listIncludes,
  isSameDay,
  isSameDayAsToday,
  filterReturnForCol,
} from "./filter";
import { filterFnTypes } from "./filterFns/filterFnTypes";

describe("filter.ts row-visibility engine — characterization + adversarial net", () => {
  // ----------------------------------------------------------------------- //
  // startsWith / endsWith — both guard value via (value ?? "") but NOT the   //
  // filterValue, and pass it straight to String.prototype.startsWith.        //
  // ----------------------------------------------------------------------- //
  describe("startsWith", () => {
    it("matches a present prefix", () => {
      expect(startsWith("hello world", "hello")).toBe(true);
      expect(startsWith("hello world", "world")).toBe(false);
    });

    it("treats null/undefined value as empty string (guarded)", () => {
      expect(startsWith(null as any, "")).toBe(true);
      expect(startsWith(undefined as any, "")).toBe(true);
      expect(startsWith(null as any, "x")).toBe(false);
    });

    it("empty filter prefix always matches a string value", () => {
      expect(startsWith("anything", "")).toBe(true);
    });

    it("DEFECT-PIN: a null filterValue is coerced to the literal 'null' prefix", () => {
      // (value ?? "").startsWith(null) -> startsWith("null")
      expect(startsWith("null prefix", null as any)).toBe(true);
      expect(startsWith("other", null as any)).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(startsWith("Hello", "hello")).toBe(false);
    });
  });

  describe("endsWith", () => {
    it("matches a present suffix", () => {
      expect(endsWith("hello world", "world")).toBe(true);
      expect(endsWith("hello world", "hello")).toBe(false);
    });

    it("treats null/undefined value as empty string (guarded)", () => {
      expect(endsWith(null as any, "")).toBe(true);
      expect(endsWith(undefined as any, "")).toBe(true);
      expect(endsWith(null as any, "x")).toBe(false);
    });

    it("empty filter suffix always matches a string value", () => {
      expect(endsWith("anything", "")).toBe(true);
    });

    it("is case-sensitive", () => {
      expect(endsWith("worlD", "world")).toBe(false);
    });
  });

  // ----------------------------------------------------------------------- //
  // lengthEquals — derefs value.length with NO nullish guard, and compares   //
  // with `==` against parseInt(filterValue).                                 //
  // ----------------------------------------------------------------------- //
  describe("lengthEquals", () => {
    it("matches when string length equals the parsed integer", () => {
      expect(lengthEquals("abc", "3")).toBe(true);
      expect(lengthEquals("abc", "2")).toBe(false);
      expect(lengthEquals("", "0")).toBe(true);
    });

    it("parses the filterValue with parseInt (trailing garbage tolerated)", () => {
      expect(lengthEquals("abcd", "4px")).toBe(true);
      expect(lengthEquals("abcd", "4.9")).toBe(true); // parseInt('4.9') -> 4
    });

    it("DEFECT-PIN: NaN filterValue makes every length fail (length == NaN is false)", () => {
      expect(lengthEquals("abc", "notanumber")).toBe(false);
      expect(lengthEquals("abc", "")).toBe(false);
    });

    it("DEFECT-PIN: null/undefined value throws (no nullish guard on value.length)", () => {
      expect(() => lengthEquals(null as any, "0")).toThrow(TypeError);
      expect(() => lengthEquals(undefined as any, "0")).toThrow(TypeError);
    });
  });

  // ----------------------------------------------------------------------- //
  // listEquals — SET-EQUALITY: both directions of subset via parseMultiString //
  // (empty inputs collapse to [], so two empties are "equal").               //
  // ----------------------------------------------------------------------- //
  describe("listEquals", () => {
    it("is true for the same set regardless of order", () => {
      expect(listEquals("a,b,c", "c,b,a")).toBe(true);
    });

    it("is false when either side has an extra member", () => {
      expect(listEquals("a,b", "a,b,c")).toBe(false);
      expect(listEquals("a,b,c", "a,b")).toBe(false);
    });

    it("trims whitespace around members (parseMultiDisplayString)", () => {
      expect(listEquals("a, b , c", "a,b,c")).toBe(true);
    });

    it("treats both-empty as equal (falsy inputs collapse to [])", () => {
      expect(listEquals("", "")).toBe(true);
      expect(listEquals(null as any, null as any)).toBe(true);
      expect(listEquals(undefined as any, undefined as any)).toBe(true);
    });

    it("DEFECT-PIN: a present non-empty value vs empty filter is NOT equal", () => {
      expect(listEquals("a", "")).toBe(false);
      // empty value vs present filter is likewise unequal
      expect(listEquals("", "a")).toBe(false);
    });

    it("collapses duplicate-only/comma-only strings to empty (set equality holds)", () => {
      // parseMultiDisplayString(",,") -> [] so this equals the empty set
      expect(listEquals(",,", "")).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // stringEqual — raw `==` with no guard. No coercion surprises for strings, //
  // but pins the loose-equality contract.                                    //
  // ----------------------------------------------------------------------- //
  describe("stringEqual", () => {
    it("is true for identical strings, false otherwise", () => {
      expect(stringEqual("foo", "foo")).toBe(true);
      expect(stringEqual("foo", "bar")).toBe(false);
    });

    it("treats null == undefined as equal (loose equality)", () => {
      expect(stringEqual(null as any, undefined as any)).toBe(true);
    });

    it("DEFECT-PIN: loose `==` coerces across number/string", () => {
      expect(stringEqual(5 as any, "5" as any)).toBe(true);
      expect(stringEqual("" as any, 0 as any)).toBe(true); // "" == 0 -> true
    });

    it("does NOT treat null and '' as equal", () => {
      expect(stringEqual(null as any, "")).toBe(false);
    });
  });

  // ----------------------------------------------------------------------- //
  // empty — (value ?? "").length == 0. Whitespace is NON-empty.              //
  // ----------------------------------------------------------------------- //
  describe("empty", () => {
    it("is true for empty string and null/undefined", () => {
      expect(empty("", "")).toBe(true);
      expect(empty(null as any, "")).toBe(true);
      expect(empty(undefined as any, "")).toBe(true);
    });

    it("is false for any non-empty content", () => {
      expect(empty("x", "")).toBe(false);
    });

    it("DEFECT-PIN: a whitespace-only value counts as NON-empty (no trim)", () => {
      expect(empty("   ", "")).toBe(false);
      expect(empty("\t", "")).toBe(false);
    });

    it("ignores filterValue entirely", () => {
      expect(empty("", "ignored")).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // stringCompare — case-insensitive substring; both sides guarded.          //
  // ----------------------------------------------------------------------- //
  describe("stringCompare", () => {
    it("is a case-insensitive substring test", () => {
      expect(stringCompare("Hello World", "hello")).toBe(true);
      expect(stringCompare("Hello World", "WORLD")).toBe(true);
      expect(stringCompare("Hello World", "xyz")).toBe(false);
    });

    it("guards both null value and null filterValue", () => {
      expect(stringCompare(null as any, null as any)).toBe(true); // "" includes ""
      expect(stringCompare(undefined as any, "")).toBe(true);
      expect(stringCompare("text", null as any)).toBe(true); // includes ""
    });

    it("empty filter matches any value", () => {
      expect(stringCompare("anything", "")).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // greaterThan / lessThan — THE ASYMMETRY: parseFloat vs parseInt.          //
  // ----------------------------------------------------------------------- //
  describe("greaterThan (parseFloat)", () => {
    it("compares numerically with float precision", () => {
      expect(greaterThan("5.5", "5.4")).toBe(true);
      expect(greaterThan("5.4", "5.5")).toBe(false);
      expect(greaterThan("10", "9")).toBe(true);
    });

    it("equal values are NOT greater (strict >)", () => {
      expect(greaterThan("5", "5")).toBe(false);
    });

    it("DEFECT-PIN: NaN operands make the comparison always false", () => {
      expect(greaterThan("abc", "5")).toBe(false);
      expect(greaterThan("5", "abc")).toBe(false);
      expect(greaterThan(null as any, "5")).toBe(false);
    });

    it("parseFloat tolerates trailing units", () => {
      expect(greaterThan("10px", "9")).toBe(true);
    });
  });

  describe("lessThan (parseFloat — symmetric with greaterThan, Notidian-a7k)", () => {
    it("compares numerically with float precision", () => {
      expect(lessThan("4", "5")).toBe(true);
      expect(lessThan("5", "4")).toBe(false);
    });

    it("equal values are NOT less (strict <)", () => {
      expect(lessThan("5", "5")).toBe(false);
    });

    it("keeps the fraction and is consistent with greaterThan (no parseInt truncation)", () => {
      // lessThan now parses with parseFloat, so fractions are honored on BOTH
      // sides and the two operators agree on the same operands.
      expect(lessThan("5.1", "5.9")).toBe(true); // 5.1 < 5.9
      expect(lessThan("5.9", "5.1")).toBe(false); // 5.9 < 5.1 -> false
      expect(greaterThan("5.9", "5.1")).toBe(true); // mirror image
      expect(greaterThan("5.1", "5.9")).toBe(false);
    });

    it("decimal value (1.5) is treated as a true float, not truncated to 1", () => {
      expect(lessThan("1.5", "2")).toBe(true); // 1.5 < 2
      expect(lessThan("1.5", "1")).toBe(false); // 1.5 < 1 -> false (parseInt would give 1 < 1 -> false too, but for the wrong reason)
      expect(lessThan("1.5", "1.6")).toBe(true); // 1.5 < 1.6 (parseInt would give 1 < 1 -> false)
    });

    it("NaN operands make the comparison always false (NaN < x / x < NaN is false)", () => {
      expect(lessThan("abc", "5")).toBe(false);
      expect(lessThan("5", "abc")).toBe(false);
      expect(lessThan(null as any, "5")).toBe(false);
    });

    it("parseFloat does NOT honor radix prefixes — '0x10' is parsed as 0, matching greaterThan", () => {
      // parseFloat('0x10') -> 0 (stops at 'x'); parseInt would have given 16.
      // Both operators now interpret '0x10' identically (as 0).
      expect(lessThan("0x10", "17")).toBe(true); // 0 < 17 -> true
      expect(lessThan("0x10", "0")).toBe(false); // 0 < 0 -> false
      expect(lessThan("0x10", "-1")).toBe(false); // 0 < -1 -> false (parseInt's 16 would also be false, but parseFloat is the convention)
      expect(greaterThan("0x10", "5")).toBe(false); // 0 > 5 -> false (already so for greaterThan)
      expect(greaterThan("0x10", "-1")).toBe(true); // 0 > -1 -> true
    });

    it("parseFloat tolerates trailing units, matching greaterThan", () => {
      expect(lessThan("9px", "10")).toBe(true); // 9 < 10
      expect(greaterThan("10px", "9")).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // isLessThanOrEqual / isGreatThanOrEqual derivatives (Notidian-a7k).        //
  // Defined in filterFnTypes as !greaterThan / !lessThan, so they inherit the //
  // numeric-coercion convention. With both base operators on parseFloat they  //
  // are now consistent: <= and >= honor decimals and agree on radix-prefixed  //
  // values. NaN inputs flip through the negation (no value is > / <, so its    //
  // negation — <= / >= — is vacuously TRUE for a non-numeric operand).         //
  // ----------------------------------------------------------------------- //
  describe("isLessThanOrEqual / isGreatThanOrEqual derivatives (parseFloat-consistent)", () => {
    const isLessThanOrEqual = (v: string, f: string) =>
      filterFnTypes.isLessThanOrEqual.fn(v, f);
    const isGreatThanOrEqual = (v: string, f: string) =>
      filterFnTypes.isGreatThanOrEqual.fn(v, f);

    it("isLessThanOrEqual: !greaterThan honors decimals and includes the boundary", () => {
      expect(isLessThanOrEqual("5", "5")).toBe(true); // boundary (not greater)
      expect(isLessThanOrEqual("4.5", "5")).toBe(true); // 4.5 <= 5
      expect(isLessThanOrEqual("5.5", "5")).toBe(false); // 5.5 > 5 -> not <=
      // Decimal precision: parseInt would have collapsed 5.4/5.6 to 5/5.
      expect(isLessThanOrEqual("5.4", "5.6")).toBe(true);
      expect(isLessThanOrEqual("5.6", "5.4")).toBe(false);
    });

    it("isGreatThanOrEqual: !lessThan honors decimals and includes the boundary", () => {
      expect(isGreatThanOrEqual("5", "5")).toBe(true); // boundary (not less)
      expect(isGreatThanOrEqual("5.5", "5")).toBe(true); // 5.5 >= 5
      expect(isGreatThanOrEqual("4.5", "5")).toBe(false); // 4.5 < 5 -> not >=
      // Decimal precision: previously parseInt(5.6)=5 vs parseInt(5.4)=5 gave a
      // wrong >= result; with parseFloat the fraction decides it.
      expect(isGreatThanOrEqual("5.6", "5.4")).toBe(true);
      expect(isGreatThanOrEqual("5.4", "5.6")).toBe(false);
    });

    it("the two derivatives now agree on radix-prefixed values (parseFloat: '0x10' -> 0)", () => {
      // Both base operators read '0x10' as 0, so the OrEqual derivatives are
      // self-consistent (no parseInt hex/parseFloat-0 split).
      expect(isLessThanOrEqual("0x10", "0")).toBe(true); // 0 <= 0
      expect(isGreatThanOrEqual("0x10", "0")).toBe(true); // 0 >= 0
      expect(isLessThanOrEqual("0x10", "-1")).toBe(false); // 0 <= -1 -> false
      expect(isGreatThanOrEqual("0x10", "-1")).toBe(true); // 0 >= -1 -> true
    });

    it("NaN operand: !greaterThan / !lessThan are vacuously TRUE (negation of an always-false >/<)", () => {
      // A non-numeric value is never strictly > or <, so its negation (<=, >=)
      // is true. This is the inherited NaN contract through the derivatives.
      expect(isLessThanOrEqual("abc", "5")).toBe(true);
      expect(isGreatThanOrEqual("abc", "5")).toBe(true);
      expect(isLessThanOrEqual("5", "abc")).toBe(true);
      expect(isGreatThanOrEqual("5", "abc")).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // dateAfter (>= inclusive) vs dateBefore (< exclusive) — boundary + NaN.   //
  // Uses noon-local instants / unambiguous dates for TZ-robustness.          //
  // ----------------------------------------------------------------------- //
  describe("dateAfter (inclusive >=)", () => {
    it("is true strictly after", () => {
      expect(dateAfter("2024-06-02T12:00:00", "2024-06-01T12:00:00")).toBe(true);
    });

    it("DEFECT-PIN: equal instants are AFTER (inclusive boundary)", () => {
      expect(dateAfter("2024-06-01T12:00:00", "2024-06-01T12:00:00")).toBe(true);
    });

    it("is false strictly before", () => {
      expect(dateAfter("2024-06-01T12:00:00", "2024-06-02T12:00:00")).toBe(false);
    });

    it("falls back to new Date(parseInt(value)) when not a parseable date", () => {
      // epoch ms strings are not Date.parse-able, so the numeric fallback runs
      const later = String(Date.UTC(2024, 5, 2));
      const earlier = String(Date.UTC(2024, 5, 1));
      expect(dateAfter(later, earlier)).toBe(true);
    });
  });

  describe("dateBefore (exclusive <)", () => {
    it("is true strictly before", () => {
      expect(dateBefore("2024-06-01T12:00:00", "2024-06-02T12:00:00")).toBe(true);
    });

    it("DEFECT-PIN: equal instants are NOT before (exclusive boundary, asymmetric with dateAfter)", () => {
      expect(dateBefore("2024-06-01T12:00:00", "2024-06-01T12:00:00")).toBe(false);
      // The exclusive-vs-inclusive split means an equal instant satisfies
      // dateAfter but not dateBefore — both filters disagree on the boundary.
      expect(dateAfter("2024-06-01T12:00:00", "2024-06-01T12:00:00")).toBe(true);
    });

    it("is false strictly after", () => {
      expect(dateBefore("2024-06-02T12:00:00", "2024-06-01T12:00:00")).toBe(false);
    });

    it("DEFECT-PIN: an unparseable value yields NaN-valued date; all comparisons false", () => {
      // isNaN(Date.parse('garbage')) -> new Date(parseInt('garbage')) -> Invalid Date
      // NaN < anything is false.
      expect(dateBefore("garbage", "2024-06-01T12:00:00")).toBe(false);
      // dateAfter likewise false (NaN >= x is false), so a garbage value is
      // invisible to BOTH date filters.
      expect(dateAfter("garbage", "2024-06-01T12:00:00")).toBe(false);
    });
  });

  // ----------------------------------------------------------------------- //
  // listIncludes — ANY-OVERLAP, contrasted against listEquals SET-EQUALITY.  //
  // Empty value short-circuits to false.                                     //
  // ----------------------------------------------------------------------- //
  describe("listIncludes (any overlap)", () => {
    it("is true when at least one filter member is present", () => {
      expect(listIncludes("a,b,c", "x,b")).toBe(true);
      expect(listIncludes("a,b,c", "x,y")).toBe(false);
    });

    it("DEFECT-PIN: empty value short-circuits to false even for an empty filter", () => {
      expect(listIncludes("", "")).toBe(false);
      expect(listIncludes(null as any, "")).toBe(false);
      expect(listIncludes("a", "")).toBe(false); // empty filter -> no overlap
    });

    it("contrasts with listEquals: overlap is enough, equality is not required", () => {
      // listIncludes: any overlap -> true
      expect(listIncludes("a,b,c", "a")).toBe(true);
      // listEquals: same single member is NOT the same set -> false
      expect(listEquals("a,b,c", "a")).toBe(false);
    });

    it("trims members before comparing", () => {
      expect(listIncludes("a, b , c", "b")).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // isSameDay(value, filterValue) — compares getMonth()+getDate() of two     //
  // dates, IGNORING year; value has a `.`->`:` substitution applied.         //
  // ----------------------------------------------------------------------- //
  describe("isSameDay", () => {
    it("is true for the same month+day (year ignored)", () => {
      // Different years, same calendar month/day -> true (year is not compared).
      expect(isSameDay("2024-03-15T12:00:00", "1999-03-15T12:00:00")).toBe(true);
    });

    it("is false for a different day", () => {
      expect(isSameDay("2024-03-15T12:00:00", "2024-03-16T12:00:00")).toBe(false);
    });

    it("DEFECT-PIN: falsy value short-circuits to false", () => {
      expect(isSameDay("", "2024-03-15T12:00:00")).toBe(false);
      expect(isSameDay(null as any, "2024-03-15T12:00:00")).toBe(false);
    });

    it("DEFECT-PIN: the first '.' in value is replaced with ':' before parsing", () => {
      // "2024-03-15 12.30" -> "2024-03-15 12:30" parses to a valid local instant.
      expect(isSameDay("2024-03-15 12.30", "2024-03-15T00:00:00")).toBe(true);
    });

    it("DEFECT-PIN: an unparseable filterValue yields Invalid Date; NaN===NaN is false", () => {
      expect(isSameDay("2024-03-15T12:00:00", "not-a-date")).toBe(false);
    });
  });

  describe("isSameDayAsToday", () => {
    // isSameDayAsToday is typed as a two-arg FilterFunction but ignores the
    // second argument at runtime (current shipped contract); we pass "" to
    // satisfy the type while pinning the single-arg behavior.
    it("is true when value's month+day match today's (year ignored)", () => {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      // Use a different year to prove year is ignored.
      expect(isSameDayAsToday(`1999-${mm}-${dd}`, "")).toBe(true);
    });

    it("is false for a clearly different calendar day", () => {
      const now = new Date();
      // Shift a day by reusing today's date plus/minus; pick a date guaranteed
      // different by using tomorrow's month/day derived from a +2 day offset.
      const other = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const mm = String(other.getMonth() + 1).padStart(2, "0");
      const dd = String(other.getDate()).padStart(2, "0");
      expect(isSameDayAsToday(`1999-${mm}-${dd}`, "")).toBe(false);
    });

    it("DEFECT-PIN: falsy value short-circuits to false", () => {
      expect(isSameDayAsToday("", "")).toBe(false);
      expect(isSameDayAsToday(null as any, "")).toBe(false);
    });

    it("ignores the second argument (single-arg runtime contract)", () => {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const yyyy = now.getFullYear();
      // A bare yyyy-mm-dd plus internal 'T00:00' is local midnight, same day,
      // and the passed filterValue (a bogus date) has no effect.
      expect(isSameDayAsToday(`${yyyy}-${mm}-${dd}`, "garbage-ignored")).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // filterReturnForCol — the dispatcher: null col -> true; unknown fn ->     //
  // true (passthrough); property-vs-literal fType branch; flex parseFlexValue //
  // ----------------------------------------------------------------------- //
  describe("filterReturnForCol", () => {
    const textCol = { name: "Title", schemaId: "s", type: "text" } as any;
    const flexCol = { name: "Mixed", schemaId: "s", type: "flex" } as any;

    it("returns true when col is null/undefined (visible by default)", () => {
      expect(
        filterReturnForCol(null as any, { fn: "is", field: "Title", value: "x" } as any, {} as any, {})
      ).toBe(true);
      expect(
        filterReturnForCol(undefined as any, { fn: "is", field: "Title", value: "x" } as any, {} as any, {})
      ).toBe(true);
    });

    it("DEFECT-PIN: an unknown filter fn passes through as visible (returns true)", () => {
      expect(
        filterReturnForCol(textCol, { fn: "noSuchFn", field: "Title", value: "x" } as any, { Title: "abc" } as any, {})
      ).toBe(true);
    });

    it("DEFECT-PIN: a missing/undefined fn passes through as visible (returns true)", () => {
      expect(
        filterReturnForCol(textCol, { field: "Title", value: "x" } as any, { Title: "abc" } as any, {})
      ).toBe(true);
    });

    it("applies a literal-fType filter against the row's field value", () => {
      const row = { Title: "Hello World" } as any;
      // include -> stringCompare(rowValue, filterValue)
      expect(
        filterReturnForCol(textCol, { fn: "include", fType: "literal", field: "Title", value: "hello" } as any, row, {})
      ).toBe(true);
      expect(
        filterReturnForCol(textCol, { fn: "include", fType: "literal", field: "Title", value: "zzz" } as any, row, {})
      ).toBe(false);
    });

    it("resolves the filter value from properties when fType == 'property'", () => {
      const row = { Title: "Hello World" } as any;
      const properties = { searchTerm: "world" };
      // value = properties[filter.value] = properties['searchTerm'] = 'world'
      expect(
        filterReturnForCol(
          textCol,
          { fn: "include", fType: "property", field: "Title", value: "searchTerm" } as any,
          row,
          properties
        )
      ).toBe(true);
      // a property key that is absent yields undefined -> stringCompare guards it
      expect(
        filterReturnForCol(
          textCol,
          { fn: "include", fType: "property", field: "Title", value: "missingKey" } as any,
          row,
          properties
        )
      ).toBe(true); // stringCompare(value, undefined) -> includes("") -> true
    });

    it("unwraps a flex column's JSON via parseFlexValue before filtering", () => {
      // flex columns store a JSON blob; parseFlexValue extracts `.value`.
      const row = { Mixed: JSON.stringify({ value: "Hello World", type: "text" }) } as any;
      expect(
        filterReturnForCol(flexCol, { fn: "include", fType: "literal", field: "Mixed", value: "hello" } as any, row, {})
      ).toBe(true);
      expect(
        filterReturnForCol(flexCol, { fn: "include", fType: "literal", field: "Mixed", value: "zzz" } as any, row, {})
      ).toBe(false);
    });

    it("DEFECT-PIN: a flex column with unparseable JSON yields undefined value (guarded by stringCompare)", () => {
      const row = { Mixed: "not json {" } as any;
      // parseFlexValue(safelyParseJSON(...)) -> value undefined -> stringCompare(undefined, 'x') -> includes -> false
      expect(
        filterReturnForCol(flexCol, { fn: "include", fType: "literal", field: "Mixed", value: "x" } as any, row, {})
      ).toBe(false);
    });

    it("DEFECT-PIN: filter.fn undefined keyed against filterFnTypes is a passthrough, not a throw", () => {
      // filter is null -> filter?.fn is undefined -> filterType undefined -> result stays true
      expect(filterReturnForCol(textCol, null as any, { Title: "abc" } as any, {})).toBe(true);
    });

    it("isEmpty/isNotEmpty route through the empty predicate on the row value", () => {
      expect(
        filterReturnForCol(textCol, { fn: "isEmpty", fType: "literal", field: "Title", value: "" } as any, { Title: "" } as any, {})
      ).toBe(true);
      expect(
        filterReturnForCol(textCol, { fn: "isEmpty", fType: "literal", field: "Title", value: "" } as any, { Title: "x" } as any, {})
      ).toBe(false);
      expect(
        filterReturnForCol(textCol, { fn: "isNotEmpty", fType: "literal", field: "Title", value: "" } as any, { Title: "x" } as any, {})
      ).toBe(true);
    });
  });
});

/*
 * FOLLOW-UP DEFECTS pinned by this net (candidates for separate fix beads;
 * src deliberately unchanged in Notidian-3fs):
 *  1. lengthEquals throws TypeError on null/undefined value (no nullish guard
 *     on value.length) — every other text predicate guards with `?? ""`.
 *  2. [FIXED in Notidian-a7k] greaterThan(parseFloat) vs lessThan(parseInt)
 *     asymmetry: lessThan was standardized on parseFloat so decimals and radix
 *     prefixes are now interpreted identically by both operators and by the
 *     isLessThanOrEqual / isGreatThanOrEqual (!greaterThan / !lessThan)
 *     derivatives. NaN contract: a non-numeric operand never satisfies a
 *     numeric < or > (false), so its <= / >= negation is vacuously true.
 *  3. dateAfter is inclusive (>=) while dateBefore is exclusive (<); an instant
 *     equal to the boundary satisfies dateAfter but not dateBefore.
 *  4. Unparseable date values become Invalid Date and are invisible to BOTH
 *     dateAfter and dateBefore (and to isSameDay when the filter is bad).
 *  5. NaN-producing numeric/length inputs silently evaluate to false rather
 *     than surfacing an error or being treated as no-op filters.
 *  6. filterReturnForCol returns true (row visible) for unknown/undefined fns,
 *     so a corrupt predicate silently disables filtering rather than failing.
 */
