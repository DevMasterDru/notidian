/**
 * Characterization + adversarial/property net for the field-type -> matcher
 * DISPATCH MAP (src/core/utils/contexts/predicate/filterFns/filterFnTypes.ts) —
 * Notidian-u8yx.
 *
 * filterFnTypes is the dispatch table the whole table-view row-filter engine
 * resolves a stored `filter.fn` through (see filterReturnForCol in filter.ts).
 * The RAW matchers it delegates to (stringEqual, greaterThan, listIncludes, …)
 * are already saturated by filter.test.ts; this file deliberately does NOT
 * re-test those. It pins the UNcovered dispatch layer itself:
 *
 *  (1) The boolean-coercion entries isTrue/isFalse, whose fns are NOT pure
 *      predicates: `isTrue = isString(v) ? v=="true" : v` RETURNS THE RAW,
 *      non-boolean value v for a non-string operand (number/null/boolean pass
 *      straight through), and `isFalse = isString(v) ? v!="true" : !v`. This
 *      truthiness-vs-boolean leak only exists at the dispatch entry, not in
 *      filter.ts, so it lives here.
 *  (2) The negation-derivative entries (notInclude=!stringCompare,
 *      isNot/isNotLink=!stringEqual, isNoneInList=!listIncludes) are the EXACT
 *      boolean complement of their base AND inherit the base's empty/null/NaN
 *      edge semantics THROUGH the dispatch entry. (isLessThanOrEqual /
 *      isGreatThanOrEqual derivatives are already pinned through this map in
 *      filter.test.ts; not duplicated here.)
 *  (3) Structural invariants as a property/table net over EVERY entry: each has
 *      fn+type+valueType; valueType==='none' iff the matcher ignores its filter
 *      operand f; and every fn is null-safe (no throw) on the hostile-but-typical
 *      cell values null/undefined/''/whitespace/0/false.
 *  (4) equal/isLink/isNotLink reuse stringEqual's loose `==` cross-type coercion
 *      — pinned through these specific entries.
 *
 * This is CHARACTERIZATION, not behavior change: src is untouched. The fns are
 * accessed exclusively through `filterFnTypes[key].fn` so the assertions exercise
 * the dispatch wiring, not a re-import of the raw matcher. If a case exposes a
 * genuine throw, it is recorded as a decision-adjacent follow-up rather than
 * blind-fixed.
 */
import { filterFnTypes } from "./filterFnTypes";

// Resolve an entry's fn THROUGH the dispatch map (the surface under test).
const fn = (key: string) => filterFnTypes[key].fn;

describe("filterFnTypes dispatch map — characterization + adversarial/property net", () => {
  // --------------------------------------------------------------------- //
  // (1) isTrue / isFalse — the non-pure boolean-coercion entries.         //
  //   isTrue:  isString(v) ? v == "true" : v   <- returns RAW v if !string //
  //   isFalse: isString(v) ? v != "true" : !v  <- returns a real boolean   //
  // These two are the only dispatch fns that can return a NON-boolean, and //
  // that leak exists only at the entry, so it is pinned here (not filter.ts).//
  // --------------------------------------------------------------------- //
  describe("isTrue (string path: v == 'true')", () => {
    const isTrue = fn("isTrue");

    it("string 'true' is true; any other string (incl. 'false','TRUE','1','') is false", () => {
      expect(isTrue("true", undefined)).toBe(true);
      expect(isTrue("false", undefined)).toBe(false);
      expect(isTrue("TRUE", undefined)).toBe(false); // case-sensitive ==
      expect(isTrue("1", undefined)).toBe(false);
      expect(isTrue("", undefined)).toBe(false);
      expect(isTrue("  true  ", undefined)).toBe(false); // no trim
    });

    it("string path always returns a real boolean", () => {
      expect(typeof isTrue("true", undefined)).toBe("boolean");
      expect(typeof isTrue("anything", undefined)).toBe("boolean");
    });
  });

  describe("isTrue (non-string path: RETURNS THE RAW VALUE v, not a boolean)", () => {
    const isTrue = fn("isTrue");

    it("DEFECT-PIN: a non-string operand is returned verbatim (no boolean coercion)", () => {
      // The else-branch is just `v`, so the raw operand leaks out of the dispatch.
      expect(isTrue(true, undefined)).toBe(true);
      expect(isTrue(false, undefined)).toBe(false);
      // Numbers come back as numbers, NOT as booleans.
      expect(isTrue(1, undefined)).toBe(1);
      expect(isTrue(0, undefined)).toBe(0);
      expect(isTrue(42, undefined)).toBe(42);
      // null/undefined come straight back.
      expect(isTrue(null, undefined)).toBeNull();
      expect(isTrue(undefined, undefined)).toBeUndefined();
    });

    it("DEFECT-PIN: the returned type is the operand's type, not boolean", () => {
      expect(typeof isTrue(1, undefined)).toBe("number");
      expect(typeof isTrue(0, undefined)).toBe("number");
      expect(typeof isTrue(true, undefined)).toBe("boolean");
    });

    it("the non-boolean return is still TRUTHY/FALSY-correct as a filter verdict", () => {
      // filterReturnForCol uses the result truthily, so a numeric 1/0 still
      // filters as keep/drop even though it is not a literal boolean.
      expect(Boolean(isTrue(1, undefined))).toBe(true);
      expect(Boolean(isTrue(0, undefined))).toBe(false);
      expect(Boolean(isTrue(null, undefined))).toBe(false);
    });

    it("ignores its filter operand f (valueType 'none')", () => {
      expect(isTrue("true", "ignored")).toBe(true);
      expect(isTrue("true", { complex: "object" })).toBe(true);
      expect(isTrue(0, "ignored")).toBe(0);
    });
  });

  describe("isFalse (string path: v != 'true', else !v)", () => {
    const isFalse = fn("isFalse");

    it("string 'true' is false; every other string is true (the complement of isTrue's string path)", () => {
      expect(isFalse("true", undefined)).toBe(false);
      expect(isFalse("false", undefined)).toBe(true);
      expect(isFalse("anything", undefined)).toBe(true);
      expect(isFalse("", undefined)).toBe(true);
      expect(typeof isFalse("x", undefined)).toBe("boolean");
    });

    it("non-string path is `!v` — ALWAYS a real boolean (unlike isTrue's raw passthrough)", () => {
      // isFalse's else-branch applies `!`, so it normalizes to boolean even for
      // numbers/null — an intentional asymmetry vs isTrue (which returns raw v).
      expect(isFalse(true, undefined)).toBe(false);
      expect(isFalse(false, undefined)).toBe(true);
      expect(isFalse(1, undefined)).toBe(false); // !1
      expect(isFalse(0, undefined)).toBe(true); // !0
      expect(isFalse(null, undefined)).toBe(true); // !null
      expect(isFalse(undefined, undefined)).toBe(true); // !undefined
      expect(typeof isFalse(0, undefined)).toBe("boolean");
      expect(typeof isFalse(1, undefined)).toBe("boolean");
    });

    it("on a STRING operand isFalse is the exact boolean complement of isTrue", () => {
      for (const s of ["true", "false", "", "TRUE", "1", "yes", "  true  "]) {
        expect(isFalse(s, undefined)).toBe(!fn("isTrue")(s, undefined));
      }
    });

    it("on a NON-STRING operand isFalse equals !Boolean(isTrue's raw return) — the asymmetry made explicit", () => {
      // isTrue returns raw v; isFalse returns !v. They agree only once isTrue's
      // raw return is coerced to boolean. This pins WHY isFalse !== !isTrue here.
      for (const v of [true, false, 1, 0, 42, null, undefined]) {
        expect(isFalse(v, undefined)).toBe(!v);
        expect(isFalse(v, undefined)).toBe(!Boolean(fn("isTrue")(v, undefined)));
      }
    });
  });

  // --------------------------------------------------------------------- //
  // (2) Negation-derivative entries — exact boolean complement of base    //
  //     AND inherited edge semantics, asserted THROUGH the dispatch entry. //
  //     Covered here: notInclude=!stringCompare, isNot/isNotLink=!stringEqual,//
  //     isNoneInList=!listIncludes. (OrEqual derivatives already pinned in  //
  //     filter.test.ts through this same map.)                              //
  // --------------------------------------------------------------------- //
  describe("notInclude = !stringCompare (case-insensitive substring, both sides guarded)", () => {
    const notInclude = fn("notInclude");
    const include = fn("include");

    it("is the exact boolean complement of include over representative + adversarial pairs", () => {
      const pairs: Array<[any, any]> = [
        ["Hello World", "hello"],
        ["Hello World", "WORLD"],
        ["Hello World", "xyz"],
        ["anything", ""], // empty filter -> include is true -> notInclude false
        [null, null], // "" includes "" -> include true -> notInclude false
        [undefined, ""],
        ["text", null], // includes "" -> include true
        ["", "x"],
      ];
      for (const [v, f] of pairs) {
        expect(notInclude(v, f)).toBe(!include(v, f));
        expect(typeof notInclude(v, f)).toBe("boolean");
      }
    });

    it("inherits stringCompare's both-sides null guard (no throw, complement holds)", () => {
      expect(notInclude(null, null)).toBe(false); // !("" includes "")
      expect(notInclude("Hello World", "zzz")).toBe(true);
    });

    it("DEFECT-PIN: a non-string non-nullish cell value (0 / false) THROWS through include/notInclude", () => {
      // stringCompare guards with `(value ?? "")`, which catches null/undefined
      // but NOT a number 0 or boolean false — those reach `.toLowerCase()` on a
      // non-string and throw a TypeError. A flex/number cell whose raw value is 0
      // (or a boolean cell mis-routed to a text-style filter) crashes the filter
      // pass via this dispatch entry. CHARACTERIZED, not fixed (decision-adjacent
      // follow-up): see end-of-file note.
      expect(() => include(0 as any, "abc")).toThrow(TypeError);
      expect(() => include(false as any, "")).toThrow(TypeError);
      expect(() => notInclude(0 as any, "abc")).toThrow(TypeError);
      expect(() => notInclude(false as any, "")).toThrow(TypeError);
      // …but a numeric STRING "0" is fine (it is a string, so the guard path holds).
      expect(() => include("0" as any, "0")).not.toThrow();
      expect(notInclude("0" as any, "0")).toBe(false); // "0" includes "0" -> include true
    });
  });

  describe("isNot / isNotLink = !stringEqual (loose == complement)", () => {
    const isNot = fn("isNot");
    const isNotLink = fn("isNotLink");
    const is = fn("is");
    const isLink = fn("isLink");

    it("isNot is the exact complement of is, isNotLink of isLink", () => {
      const pairs: Array<[any, any]> = [
        ["foo", "foo"],
        ["foo", "bar"],
        [null, undefined], // null == undefined -> equal -> isNot false
        [null, ""], // null != "" -> not equal -> isNot true
        [5, "5"], // loose == coercion -> equal
        ["", 0], // "" == 0 -> equal
      ];
      for (const [v, f] of pairs) {
        expect(isNot(v, f)).toBe(!is(v, f));
        expect(isNotLink(v, f)).toBe(!isLink(v, f));
        expect(typeof isNot(v, f)).toBe("boolean");
        expect(typeof isNotLink(v, f)).toBe("boolean");
      }
    });
  });

  describe("isNoneInList = !listIncludes (any-overlap complement)", () => {
    const isNoneInList = fn("isNoneInList");
    const isAnyInList = fn("isAnyInList");

    it("is the exact complement of isAnyInList over overlap/no-overlap/empty cases", () => {
      const pairs: Array<[any, any]> = [
        ["a,b,c", "x,b"], // overlap -> any true -> none false
        ["a,b,c", "x,y"], // no overlap -> any false -> none true
        ["a, b , c", "b"], // trimmed overlap
        ["a,b,c", "a"], // single-member overlap
      ];
      for (const [v, f] of pairs) {
        expect(isNoneInList(v, f)).toBe(!isAnyInList(v, f));
        expect(typeof isNoneInList(v, f)).toBe("boolean");
      }
    });

    it("DEFECT-PIN: inherits listIncludes' empty-value short-circuit — empty value is 'none in list' (vacuously TRUE)", () => {
      // listIncludes returns false for an empty value (even vs an empty filter),
      // so its negation isNoneInList is vacuously TRUE for an empty cell. This is
      // the inherited edge semantic flowing through the dispatch entry.
      expect(isNoneInList("", "")).toBe(true);
      expect(isNoneInList(null, "")).toBe(true);
      expect(isNoneInList("a", "")).toBe(true); // empty filter -> no overlap -> none true
      expect(fn("isAnyInList")("", "")).toBe(false); // confirms the base it negates
    });
  });

  // --------------------------------------------------------------------- //
  // (4) equal / isLink / isNotLink — loose `==` cross-type coercion        //
  //     reused from stringEqual, pinned THROUGH these specific entries.    //
  // --------------------------------------------------------------------- //
  describe("equal / isLink reuse stringEqual's loose == cross-type coercion (through the dispatch)", () => {
    const equal = fn("equal");
    const isLink = fn("isLink");
    const isNotLink = fn("isNotLink");

    it("DEFECT-PIN: number-vs-string and ''-vs-0 coerce equal via ==", () => {
      expect(equal(5, "5")).toBe(true);
      expect(isLink(5, "5")).toBe(true);
      expect(equal("", 0)).toBe(true); // "" == 0
      expect(isLink("", 0)).toBe(true);
    });

    it("null == undefined is equal but null vs '' is NOT (matches stringEqual)", () => {
      expect(equal(null, undefined)).toBe(true);
      expect(isLink(null, undefined)).toBe(true);
      expect(equal(null, "")).toBe(false);
      expect(isLink(null, "")).toBe(false);
    });

    it("isNotLink negates the same coercion consistently", () => {
      expect(isNotLink(5, "5")).toBe(false); // 5 == "5" -> equal -> notLink false
      expect(isNotLink(null, "")).toBe(true); // not equal -> notLink true
    });
  });

  // --------------------------------------------------------------------- //
  // (3) STRUCTURAL property/table net over EVERY entry in the map.        //
  // --------------------------------------------------------------------- //
  describe("structural invariants — property net over every dispatch entry", () => {
    const entries = Object.entries(filterFnTypes);

    it("the map is non-empty (sanity)", () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it.each(entries)(
      "%s has the full {fn, type[], valueType} shape",
      (_key, entry) => {
        expect(typeof entry.fn).toBe("function");
        expect(Array.isArray(entry.type)).toBe(true);
        expect(entry.type.length).toBeGreaterThan(0);
        entry.type.forEach((t) => expect(typeof t).toBe("string"));
        expect(typeof entry.valueType).toBe("string");
        expect(entry.valueType.length).toBeGreaterThan(0);
      }
    );

    it("valueType==='none' EXACTLY for the entries whose matcher ignores the filter operand f", () => {
      // The contract: valueType 'none' iff the matcher does not consult f. These
      // are the operand-free predicates (empty/non-empty/truthiness/today). Any
      // future entry that drifts from this set must update the contract knowingly.
      const expectedNone = new Set([
        "isNotEmpty",
        "isEmpty",
        "isSameDateAsToday",
        "isTrue",
        "isFalse",
      ]);
      const actualNone = new Set(
        entries.filter(([, e]) => e.valueType === "none").map(([k]) => k)
      );
      expect(actualNone).toEqual(expectedNone);
    });

    it("the valueType==='none' entries genuinely IGNORE f (same verdict for wildly different f)", () => {
      // Behavioral proof of the 'none' contract: vary f drastically and the
      // verdict must not change for any 'none' entry.
      const noneKeys = entries
        .filter(([, e]) => e.valueType === "none")
        .map(([k]) => k);
      // Use operands each 'none' matcher can chew on: a date for the date one,
      // a string for the rest. The point is f-invariance, not the verdict value.
      const probes: Record<string, any> = {
        isNotEmpty: "x",
        isEmpty: "x",
        isSameDateAsToday: "2024-03-15",
        isTrue: "true",
        isFalse: "true",
      };
      const fsToTry = ["", "ignored", null, undefined, 0, { a: 1 }, ["b"]];
      for (const key of noneKeys) {
        const matcher = filterFnTypes[key].fn;
        const v = probes[key];
        const baseline = matcher(v, fsToTry[0]);
        for (const f of fsToTry.slice(1)) {
          expect(matcher(v, f)).toBe(baseline);
        }
      }
    });

    // Null-safety net: every fn, applied to a value compatible with one of its
    // declared types, is exercised against the hostile-but-typical cell values an
    // empty/garbage row produces. A throw here would crash the WHOLE filter pass
    // (filterReturnForCol has no try/catch), so this is the load-bearing invariant.
    const hostileValues: Array<[string, any]> = [
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace", "   "],
      ["zero", 0],
      ["false", false],
    ];
    // A few representative filter operands per declared valueType, so we exercise
    // each fn with both a null/empty operand AND a plausible typed operand.
    const operandsByValueType: Record<string, any[]> = {
      none: [undefined, null, ""],
      text: [null, "", "abc"],
      number: [null, "", "5"],
      link: [null, "", "Note"],
      list: [null, "", "a,b"],
      date: [null, "", "2024-03-15T12:00:00"],
    };

    // DEFECT-PIN: stringCompare (the include/notInclude matcher) guards its
    // operands only with `(value ?? "")`, which catches null/undefined but NOT
    // a non-string non-nullish primitive. A numeric `0` or boolean `false` cell
    // value reaches `.toLowerCase()` on a number/boolean and THROWS a TypeError.
    // filter.test.ts never exercised stringCompare with 0/false (only strings &
    // null), so this throw was previously unpinned. It is CHARACTERIZED here, not
    // fixed — a flex/number cell whose raw value is 0/false, filtered by a
    // text-style include/notInclude, crashes the table-view filter pass. Recorded
    // as a decision-adjacent follow-up bead rather than blind-fixed.
    const throwsTypeError = (key: string, v: any) =>
      (key === "include" || key === "notInclude") &&
      (v === 0 || v === false);

    describe("null-safety net: hostile cell values across every dispatch entry (load-bearing — filterReturnForCol has no try/catch)", () => {
      for (const [key, entry] of entries) {
        const operands = operandsByValueType[entry.valueType] ?? [null, "", "x"];
        for (const [label, v] of hostileValues) {
          for (const f of operands) {
            if (throwsTypeError(key, v)) {
              it(`DEFECT-PIN: ${key}(${label}, ${JSON.stringify(f)}) THROWS (stringCompare non-string-coercion gap)`, () => {
                expect(() => entry.fn(v, f)).toThrow(TypeError);
              });
            } else {
              it(`${key}(${label}, ${JSON.stringify(f)}) does not throw`, () => {
                expect(() => entry.fn(v, f)).not.toThrow();
              });
            }
          }
        }
      }
    });

    it("every declared type string is a recognized field-type token (no typo'd type)", () => {
      // Catches a fat-fingered type entry that would silently never match a real
      // column. Derived from the union currently used across the map.
      const knownTypes = new Set([
        "text",
        "file",
        "number",
        "option",
        "option-multi",
        "link",
        "link-multi",
        "image",
        "context",
        "context-multi",
        "tags-multi",
        "date",
        "boolean",
      ]);
      for (const [key, entry] of entries) {
        for (const t of entry.type) {
          expect(knownTypes.has(t)).toBe(true);
        }
        // keep `key` referenced for a clearer failure message if it ever trips
        expect(typeof key).toBe("string");
      }
    });
  });
});

/*
 * DEFECT discovered + characterized by this net (decision-adjacent follow-up;
 * src deliberately UNCHANGED in Notidian-u8yx per the characterization mandate):
 *
 *  D1. include / notInclude (matcher: stringCompare in filter.ts) throw a
 *      TypeError on a NON-STRING, NON-NULLISH cell value. The `(value ?? "")`
 *      guard catches null/undefined but not a number `0` or boolean `false`,
 *      which then hit `.toLowerCase()` on a non-string. A flex/number cell whose
 *      raw value is the number 0, or a boolean cell mis-routed to a text-style
 *      include/notInclude filter, crashes the entire table-view filter pass
 *      (filterReturnForCol has no try/catch). filter.test.ts never exercised
 *      stringCompare with 0/false (only strings & null), so this was unpinned.
 *      A fix would coerce the value to a string before .toLowerCase() — e.g.
 *      `String(value ?? "")` — but that changes observable behavior, so it is
 *      filed as a separate decision rather than blind-fixed here.
 *
 * ALSO pinned (existing intentional designs, not defects, surfaced through the
 * dispatch entry for the first time):
 *  - isTrue returns its RAW non-boolean operand for non-string v (only entry in
 *    the map that can return a non-boolean); isFalse normalizes via `!v`. The
 *    two are therefore complements only after coercing isTrue's return to bool.
 *  - isNoneInList is vacuously TRUE for an empty cell (inherits listIncludes'
 *    empty-value short-circuit through the !-derivative).
 */
