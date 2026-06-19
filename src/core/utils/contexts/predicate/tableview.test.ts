/**
 * Characterization + adversarial net for the table-view PREDICATE DISPATCHER
 * (src/core/utils/contexts/predicate/tableview.ts) — Notidian-lcl.
 *
 * tableview.ts is the untested glue that resolves a column's filter/sort
 * function from a stored Predicate and binds it to the TanStack Table row API.
 * Its engine siblings (filter.ts / sort.ts) are heavily covered, but this
 * dispatcher layer — which decides WHICH predicate fn runs for a column and how
 * a TanStack Row is threaded into it — had ZERO direct coverage. These tests
 * PIN the current shipped behavior so any future change is a deliberate,
 * reviewed decision. No source is changed here; a genuine law violation would be
 * filed as a follow-up bead (none surfaced — see end-of-file note).
 *
 * Four contracts are locked:
 *
 *  (1) FIELD-KEY BINDING. A column matches a stored filter/sort entry by the
 *      raw JS string concatenation `col.name + col.table` (NOT a join with a
 *      separator). Because `col.table` is optional, the adversarial corners are:
 *        - table === ""        => key is just `col.name`
 *        - table === undefined => key is `col.name + "undefined"` (the literal
 *          string "undefined" is appended — a JS string+undefined coercion).
 *      Both are pinned so the storage key contract is explicit.
 *
 *  (2) filterFnForCol FAILS OPEN. It returns `() => true` (row stays VISIBLE)
 *      when there is no matching filterField OR when filterFnTypes[fn] is
 *      unknown. This is the same fail-open family decided at the engine level by
 *      filterReturnForCol (Notidian-37m); locking it here makes the contract
 *      concrete at the dispatcher level too: a corrupt/forward-version predicate
 *      silently DISABLES filtering rather than hiding rows.
 *
 *  (3) sortFnForCol FAILS CLOSED to null. It returns `null` when there is no
 *      matching sortField, when sortField.fn is falsy, or when sortFnTypes[fn]
 *      is unknown. (Note: the declared return type is SortingFn<any>, yet null
 *      is returned — TanStack treats a null sortingFn as "no custom comparator".
 *      That type/runtime gap is pinned, not fixed.)
 *
 *  (4) THREADING. tableViewFilterFn pulls the cell via row.getValue(columnId)
 *      and passes (cellValue, filterValue) to the underlying filter fn.
 *      tableViewSortFn pulls both cells via row.getValue / row2.getValue and
 *      passes (v, v2, col) to the underlying sort fn — i.e. the column is
 *      forwarded as the field-def so option/option-multi ordering works.
 *
 * Everything here is pure / offline — no vault, no DOM, no I/O. The real
 * filterFnTypes / sortFnTypes maps are used; only the TanStack Row is stubbed
 * (to its minimal getValue surface).
 */
import {
  tableViewFilterFn,
  filterFnForCol,
  tableViewSortFn,
  sortFnForCol,
} from "./tableview";
import { filterFnTypes } from "./filterFns/filterFnTypes";
import { sortFnTypes, SortFunction } from "./sort";
import { Predicate } from "shared/types/predicate";
import { SpaceTableColumn } from "shared/types/mdb";

// --- minimal builders ------------------------------------------------------ //

// A column carries name + optional table; only those two fields participate in
// dispatch keying, so the rest of SpaceProperty is filled minimally.
const col = (
  name: string,
  table?: string,
  type = "text"
): SpaceTableColumn => ({ name, table, type });

// A Predicate has many fields the dispatcher never reads; build the smallest
// shape that typechecks and only set filters/sort.
const predicate = (over: Partial<Predicate>): Predicate =>
  ({
    view: "table",
    listView: "",
    listItem: "",
    listGroup: "",
    listViewProps: {},
    listItemProps: {},
    listGroupProps: {},
    filters: [],
    sort: [],
    groupBy: [],
    colsOrder: [],
    colsHidden: [],
    colsSize: {},
    colsCalc: {},
    frozenColumnCount: 0,
    limit: 0,
    ...over,
  } as Predicate);

// Stub a TanStack Row to just the getValue(columnId) surface the dispatcher
// touches. A map of columnId -> value drives it; an absent key yields undefined.
const row = (values: Record<string, any>) =>
  ({
    getValue: (columnId: string) => values[columnId],
  } as any);

describe("tableview.ts predicate dispatcher — characterization + adversarial net", () => {
  // ----------------------------------------------------------------------- //
  // (1) FIELD-KEY BINDING: col.name + col.table concatenation               //
  // ----------------------------------------------------------------------- //
  describe("field-key binding (col.name + col.table)", () => {
    it("filter matches when stored field equals name + table", () => {
      const p = predicate({
        filters: [{ field: "Statustasks", fn: "isNotEmpty", value: "", fType: "text" }],
      });
      // Resolves to a real filter fn (isNotEmpty), so a non-empty cell stays
      // visible and an empty cell is filtered out.
      const fn = filterFnForCol(p, col("Status", "tasks"));
      expect(fn(row({ Status: "Open" }), "Status", "", undefined as any)).toBe(true);
      expect(fn(row({ Status: "" }), "Status", "", undefined as any)).toBe(false);
    });

    it("filter does NOT match when only the name matches but table differs", () => {
      const p = predicate({
        filters: [{ field: "Statustasks", fn: "isNotEmpty", value: "", fType: "text" }],
      });
      // Same name, different table => key "Statusother" != stored "Statustasks".
      // Falls through to the fail-open default () => true (empty cell visible).
      const fn = filterFnForCol(p, col("Status", "other"));
      expect(fn(row({ Status: "" }), "Status", "", undefined as any)).toBe(true);
    });

    it("empty-string table keys on the bare name (name + '' === name)", () => {
      const p = predicate({
        filters: [{ field: "Status", fn: "isNotEmpty", value: "", fType: "text" }],
      });
      const fn = filterFnForCol(p, col("Status", ""));
      // Matched isNotEmpty: empty cell filtered out.
      expect(fn(row({ Status: "" }), "Status", "", undefined as any)).toBe(false);
      expect(fn(row({ Status: "x" }), "Status", "", undefined as any)).toBe(true);
    });

    it("undefined table appends the literal string 'undefined' to the key", () => {
      // ADVERSARIAL JS-coercion corner: `"Status" + undefined === "Statusundefined"`.
      // A stored field of exactly "Statusundefined" MATCHES a column with no table.
      const pMatch = predicate({
        filters: [
          { field: "Statusundefined", fn: "isNotEmpty", value: "", fType: "text" },
        ],
      });
      const matched = filterFnForCol(pMatch, col("Status", undefined));
      expect(matched(row({ Status: "" }), "Status", "", undefined as any)).toBe(false);

      // And the "intuitive" bare-name field does NOT match a no-table column,
      // because the key is "Statusundefined", not "Status".
      const pBare = predicate({
        filters: [{ field: "Status", fn: "isNotEmpty", value: "", fType: "text" }],
      });
      const bare = filterFnForCol(pBare, col("Status", undefined));
      // Unmatched => fail-open default keeps the empty cell visible.
      expect(bare(row({ Status: "" }), "Status", "", undefined as any)).toBe(true);
    });

    it("sort keys by the same name + table concatenation", () => {
      const p = predicate({ sort: [{ field: "Nametasks", fn: "alphabetical" }] });
      const matched = sortFnForCol(p, col("Name", "tasks"));
      expect(matched).not.toBeNull();
      // Wrong table => no match => null.
      expect(sortFnForCol(p, col("Name", "other"))).toBeNull();
      // undefined table on a "Nametasks" stored key never matches.
      expect(sortFnForCol(p, col("Name", undefined))).toBeNull();
    });
  });

  // ----------------------------------------------------------------------- //
  // (2) filterFnForCol — FAILS OPEN to () => true                           //
  // ----------------------------------------------------------------------- //
  describe("filterFnForCol fail-open behavior", () => {
    it("returns a () => true passthrough when no filter matches the column", () => {
      const p = predicate({ filters: [] });
      const fn = filterFnForCol(p, col("Anything", "tbl"));
      // Always visible regardless of cell / filter value.
      expect(fn(row({ Anything: "" }), "Anything", "x", undefined as any)).toBe(true);
      expect(fn(row({ Anything: null }), "Anything", null, undefined as any)).toBe(true);
      expect(fn(row({}), "Missing", undefined, undefined as any)).toBe(true);
    });

    it("returns a () => true passthrough when the matched fn key is UNKNOWN", () => {
      // The field matches the column but the fn is not a key in filterFnTypes.
      const p = predicate({
        filters: [
          { field: "Statustasks", fn: "totallyMadeUpFn", value: "", fType: "text" },
        ],
      });
      const fn = filterFnForCol(p, col("Status", "tasks"));
      expect(fn(row({ Status: "" }), "Status", "anything", undefined as any)).toBe(true);
      expect(fn(row({ Status: "x" }), "Status", "y", undefined as any)).toBe(true);
    });

    it("threads a real matched fn instead of the passthrough", () => {
      // `is` (text equality) — only the exact match stays visible.
      const p = predicate({
        filters: [{ field: "Statustasks", fn: "is", value: "Open", fType: "text" }],
      });
      const fn = filterFnForCol(p, col("Status", "tasks"));
      expect(fn(row({ Status: "Open" }), "Status", "Open", undefined as any)).toBe(true);
      expect(fn(row({ Status: "Closed" }), "Status", "Open", undefined as any)).toBe(
        false
      );
    });

    it("always returns a callable FilterFn (never null/undefined)", () => {
      const p = predicate({ filters: [] });
      const fn = filterFnForCol(p, col("X", "t"));
      expect(typeof fn).toBe("function");
    });
  });

  // ----------------------------------------------------------------------- //
  // (3) sortFnForCol — FAILS CLOSED to null                                  //
  // ----------------------------------------------------------------------- //
  describe("sortFnForCol null behavior", () => {
    it("returns null when no sort entry matches the column", () => {
      const p = predicate({ sort: [] });
      expect(sortFnForCol(p, col("Name", "tasks"))).toBeNull();
    });

    it("returns null when the matched sort entry has a falsy fn", () => {
      // Matching field, but fn is "" (falsy) — the `!sortField.fn` guard trips.
      const p = predicate({ sort: [{ field: "Nametasks", fn: "" }] });
      expect(sortFnForCol(p, col("Name", "tasks"))).toBeNull();
    });

    it("returns null when the matched sort fn key is UNKNOWN", () => {
      const p = predicate({ sort: [{ field: "Nametasks", fn: "notARealSort" }] });
      expect(sortFnForCol(p, col("Name", "tasks"))).toBeNull();
    });

    it("returns a callable SortingFn when the fn key is known", () => {
      const p = predicate({ sort: [{ field: "Nametasks", fn: "alphabetical" }] });
      const fn = sortFnForCol(p, col("Name", "tasks"));
      expect(typeof fn).toBe("function");
    });
  });

  // ----------------------------------------------------------------------- //
  // (4) THREADING — tableViewFilterFn / tableViewSortFn bind the Row API     //
  // ----------------------------------------------------------------------- //
  describe("tableViewFilterFn threading", () => {
    it("passes row.getValue(columnId) and filterValue to the underlying fn", () => {
      const seen: any[] = [];
      const underlying = (cellValue: any, filterValue: any) => {
        seen.push([cellValue, filterValue]);
        return cellValue === filterValue;
      };
      const fn = tableViewFilterFn(underlying);
      const r = row({ colA: "cell-from-A", colB: "cell-from-B" });
      // columnId selects WHICH cell is read out of the row.
      const out = fn(r, "colA", "cell-from-A", undefined as any);
      expect(out).toBe(true);
      expect(seen).toEqual([["cell-from-A", "cell-from-A"]]);
    });

    it("reads the cell keyed by columnId, not a fixed slot", () => {
      const underlying = (cellValue: any, filterValue: any) => cellValue === filterValue;
      const fn = tableViewFilterFn(underlying);
      const r = row({ colA: "a", colB: "b" });
      expect(fn(r, "colB", "b", undefined as any)).toBe(true);
      expect(fn(r, "colB", "a", undefined as any)).toBe(false);
    });
  });

  describe("tableViewSortFn threading", () => {
    it("passes row.getValue / row2.getValue / col to the underlying sort fn", () => {
      const seen: any[] = [];
      const underlying: SortFunction = (v, v2, fieldDef) => {
        seen.push([v, v2, fieldDef]);
        return 0;
      };
      const c = col("Name", "tasks", "text");
      const fn = tableViewSortFn(underlying, c);
      const r1 = row({ Col: "alpha" });
      const r2 = row({ Col: "beta" });
      const out = fn(r1, r2, "Col");
      expect(out).toBe(0);
      // Both cells threaded by columnId, and the column forwarded as field-def.
      expect(seen).toEqual([["alpha", "beta", c]]);
    });

    it("forwards undefined col when none is supplied (optional arg)", () => {
      const seen: any[] = [];
      const underlying: SortFunction = (v, v2, fieldDef) => {
        seen.push([v, v2, fieldDef]);
        return v < v2 ? -1 : v > v2 ? 1 : 0;
      };
      const fn = tableViewSortFn(underlying);
      const out = fn(row({ Col: "a" }), row({ Col: "b" }), "Col");
      expect(out).toBe(-1);
      expect(seen).toEqual([["a", "b", undefined]]);
    });
  });

  // ----------------------------------------------------------------------- //
  // INTEGRATION — dispatcher + real engine end to end                        //
  // The wired comparator/predicate behaves like the engine it dispatches to. //
  // ----------------------------------------------------------------------- //
  describe("end-to-end through the real fn maps", () => {
    it("filterFnForCol(is) wired through filterFnTypes filters by text equality", () => {
      // Sanity that the dispatcher actually selects the real filterFnTypes entry.
      expect(filterFnTypes["is"]).toBeDefined();
      const p = predicate({
        filters: [{ field: "Titledb", fn: "is", value: "Foo", fType: "text" }],
      });
      const fn = filterFnForCol(p, col("Title", "db"));
      expect(fn(row({ Title: "Foo" }), "Title", "Foo", undefined as any)).toBe(true);
      expect(fn(row({ Title: "Bar" }), "Title", "Foo", undefined as any)).toBe(false);
    });

    it("sortFnForCol(alphabetical) wired through sortFnTypes orders strings", () => {
      expect(sortFnTypes["alphabetical"]).toBeDefined();
      const p = predicate({ sort: [{ field: "Titledb", fn: "alphabetical" }] });
      const fn = sortFnForCol(p, col("Title", "db"));
      // "apple" < "banana" => negative comparator result.
      expect(fn(row({ Title: "apple" }), row({ Title: "banana" }), "Title")).toBe(-1);
      expect(fn(row({ Title: "banana" }), row({ Title: "apple" }), "Title")).toBe(1);
      expect(fn(row({ Title: "apple" }), row({ Title: "apple" }), "Title")).toBe(0);
    });
  });

  // ----------------------------------------------------------------------- //
  // (5) FLEX-CELL EXTRACTION PARITY (Notidian-xy0s)                          //
  //                                                                          //
  // The TanStack adapters are the PARALLEL integration to the live render    //
  // path (filterReturnForCol / sortReturnForCol). The live path UNWRAPS a    //
  // flex cell — sort.ts:368 derives flexSortKey for scalar families / keeps  //
  // the raw multi-string for count families; filter.ts:242 extracts          //
  // parseFlexValue(cell)?.value. The adapter USED to feed the RAW stored     //
  // flex string (a JSON wrapper like '{"value":5,"type":"number"}', or a     //
  // non-string) straight to the comparator/predicate — the same flex-throw / //
  // wrong-sort class av6s (sort) and 9i9i (filter) killed on the live path:  //
  // at best a sort by the JSON wrapper TEXT, at worst a comparator TypeError //
  // that — Array.prototype.sort has no try/catch around its comparator —     //
  // aborts the WHOLE table-view sort pass.                                   //
  //                                                                          //
  // These cases mirror av6s's DEFECT-PIN FLIP: a flex column under an        //
  // alphabetical/number sort now yields CORRECT ordering and never throws; a //
  // flex column under a text filter never throws. A regression here would    //
  // re-feed the raw wrapper and flip these back to throwing / wrong order.   //
  // ----------------------------------------------------------------------- //
  describe("flex-cell extraction parity through the dispatcher", () => {
    // Build the on-disk JSON wrapper a flex cell actually stores.
    const flex = (value: any, type = "text") =>
      JSON.stringify({ value, type });

    it("flex column under `alphabetical` sort orders by the unwrapped value, not the JSON wrapper text", () => {
      const p = predicate({ sort: [{ field: "Mixeddb", fn: "alphabetical" }] });
      const fn = sortFnForCol(p, col("Mixed", "db", "flex"));
      expect(fn).not.toBeNull();
      const ra = row({ Mixed: flex("a") });
      const rb = row({ Mixed: flex("b") });
      // Unwrapped 'a' < 'b' => -1. If the raw wrappers leaked through, both
      // strings start with '{"value":"…' so they would compare by the wrapper
      // body ('a' vs 'b' is still the discriminator HERE, but a numeric wrapper
      // below proves the unwrap) — and a non-string value would THROW.
      expect(() => fn(ra, rb, "Mixed")).not.toThrow();
      expect(fn(ra, rb, "Mixed")).toBe(-1);
      expect(fn(rb, ra, "Mixed")).toBe(1);
      expect(fn(ra, row({ Mixed: flex("a") }), "Mixed")).toBe(0);
    });

    it("flex column under `number` sort compares NUMERICALLY on the unwrapped value (wrapper-text order would be wrong) and never throws", () => {
      const p = predicate({ sort: [{ field: "Mixeddb", fn: "number" }] });
      const fn = sortFnForCol(p, col("Mixed", "db", "flex"));
      expect(fn).not.toBeNull();
      // A real number value (NOT a string) — feeding the raw wrapper to numSort's
      // parseFloat('{"value":9,…}') => NaN for BOTH, collapsing the order; feeding
      // a bare number to stringSort (the OLD av6s throw class) would blow up. With
      // the unwrap, 9 > 80 is FALSE numerically (9 < 80 => -1), but TRUE as text
      // ("9" > "80"). Pin the numeric verdict.
      const r9 = row({ Mixed: flex(9, "number") });
      const r80 = row({ Mixed: flex(80, "number") });
      expect(() => fn(r9, r80, "Mixed")).not.toThrow();
      expect(fn(r9, r80, "Mixed")).toBe(-1); // 9 < 80 numerically
      expect(fn(r80, r9, "Mixed")).toBe(1);
    });

    it("count-family flex sort keeps the RAW multi-string (measures cardinality), not flexSortKey", () => {
      // optionMultiCount / count are multi:true — they must still receive the raw
      // cell so countSort can measure parseMultiString(...).length. A 2-item cell
      // sorts vs a 1-item cell by length; reverseCount is ascending-by-count.
      const p = predicate({
        sort: [{ field: "Tagsdb", fn: "reverseCount" }],
      });
      const fn = sortFnForCol(p, col("Tags", "db", "flex"));
      expect(fn).not.toBeNull();
      const one = row({ Tags: "a" });
      const two = row({ Tags: "a,b" });
      // The load-bearing assertion: the comparator MEASURES CARDINALITY (1 vs 2
      // items) and never throws — only possible because the raw multi-string (NOT
      // flexSortKey, which would yield the scalar "a" for both and collapse the
      // order to 0) reaches countSort. reverseCount = countSort(...) * -1, so the
      // 1-item cell sorts AFTER the 2-item cell (=> +1); antisymmetric on swap.
      expect(() => fn(one, two, "Tags")).not.toThrow();
      expect(fn(one, two, "Tags")).toBe(1);
      expect(fn(two, one, "Tags")).toBe(-1);
      // If flexSortKey had (wrongly) been applied, both cells would unwrap to the
      // same scalar key and the comparator would return 0 — assert it does NOT.
      expect(fn(one, two, "Tags")).not.toBe(0);
    });

    it("flex column under a TEXT filter (`include`) extracts the value and never throws on a numeric/boolean cell", () => {
      const p = predicate({
        filters: [{ field: "Mixeddb", fn: "include", value: "ell", fType: "text" }],
      });
      const fn = filterFnForCol(p, col("Mixed", "db", "flex"));
      // Wrapped string value: substring match runs on "hello", not the wrapper.
      expect(
        fn(row({ Mixed: flex("hello") }), "Mixed", "ell", undefined as any)
      ).toBe(true);
      expect(
        fn(row({ Mixed: flex("world") }), "Mixed", "ell", undefined as any)
      ).toBe(false);
      // A numeric/boolean wrapped value previously hit a String.prototype method
      // on a number/boolean => TypeError that crashed the whole filter pass. With
      // the asText guard on the unwrapped value, it must NOT throw (treated as an
      // empty text cell => no substring match).
      expect(() =>
        fn(row({ Mixed: flex(0, "number") }), "Mixed", "ell", undefined as any)
      ).not.toThrow();
      expect(
        fn(row({ Mixed: flex(0, "number") }), "Mixed", "ell", undefined as any)
      ).toBe(false);
      expect(() =>
        fn(row({ Mixed: flex(false, "boolean") }), "Mixed", "ell", undefined as any)
      ).not.toThrow();
    });

    it("flex column under a NUMBER filter (`isGreatThan`) compares the unwrapped numeric value", () => {
      const p = predicate({
        filters: [{ field: "Numdb", fn: "isGreatThan", value: "10", fType: "number" }],
      });
      const fn = filterFnForCol(p, col("Num", "db", "flex"));
      // Unwrapped 42 > 10 => visible; unwrapped 5 > 10 => filtered out. Feeding the
      // raw wrapper would parseFloat('{"value":42,…}') => NaN > 10 => false for all.
      expect(
        fn(row({ Num: flex(42, "number") }), "Num", "10", undefined as any)
      ).toBe(true);
      expect(
        fn(row({ Num: flex(5, "number") }), "Num", "10", undefined as any)
      ).toBe(false);
    });

    it("a NON-flex column is unaffected: the cell threads through verbatim (no unwrap)", () => {
      // Regression guard that the flex branch is gated strictly on col.type.
      const seen: any[] = [];
      const pSort = predicate({ sort: [{ field: "Plaindb", fn: "alphabetical" }] });
      const sFn = sortFnForCol(pSort, col("Plain", "db", "text"));
      // A JSON-looking string in a TEXT column must NOT be unwrapped — it sorts
      // as the literal string it is.
      const wrapperish = flex("zzz");
      expect(sFn(row({ Plain: wrapperish }), row({ Plain: "zzz" }), "Plain")).not.toBe(
        0
      ); // literal wrapper text != "zzz" => some ordering, not equal
      // And the manual adapter with no col threads the raw cell unchanged.
      const underlying = (v: any, v2: any) => {
        seen.push([v, v2]);
        return 0;
      };
      tableViewFilterFn(underlying as any)(
        row({ c: wrapperish }),
        "c",
        "x",
        undefined as any
      );
      expect(seen[0][0]).toBe(wrapperish);
    });
  });
});

// ---------------------------------------------------------------------------
// SOURCE-BUG NOTE (Notidian-lcl): no genuine SORT/FILTER LAW violation lives in
// tableview.ts itself — it is a thin resolver over filter.ts / sort.ts, whose
// own defects are pinned by Notidian-3fs / Notidian-3wa. The only design call
// surfaced here is the fail-open filter contract, already tracked as the
// dispatcher-level instance of Notidian-37m. No follow-up bug bead is required
// from this characterization pass.
// ---------------------------------------------------------------------------
