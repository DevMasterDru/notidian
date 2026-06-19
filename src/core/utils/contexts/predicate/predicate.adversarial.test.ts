// Adversarial + property depth for the predicate persistence-validation boundary
// (Notidian-gmzn). The sibling characterization file (predicate.test.ts) pins the
// Notidian-w1bf hardening with one targeted assertion per malformed shape. This
// file is the SAFE INFINITE-QUOTA SINK on the same surface: it goes wider (every
// passthrough field crossed with every wrong container/element shape) and adds the
// two properties no example-based case can express —
//
//   (P1) cleanPredicateType only validates `.fn`; it does NOT validate that a
//        surviving filter/sort carries a STRING `.field`. A known-fn filter whose
//        `field` is missing or non-string therefore passes validation and reaches
//        the FAIL-OPEN dispatchers, which do `row[filter.field]` / `row[sort.field]`
//        (filter.ts:242, sort.ts:310-311). We pin the end-to-end contract: such a
//        predicate survives validation AND the dispatcher never throws (it degrades
//        to the fail-open / no-op result), so a corrupt `.field` can never crash the
//        whole table-view filter/sort pass (the TypeError class filter.ts:19 warns
//        about). This is the bead's load-bearing gap — characterization, not a fix.
//
//   (P2) validatePredicate is a load/save WHITELIST, so the load->save->load loop
//        MUST converge: validatePredicate(validatePredicate(p)) === validatePredicate(p)
//        for arbitrary structured (incl. adversarially malformed) inputs. A
//        non-idempotent validator would mutate a clean predicate on every save —
//        silent drift. We pin the fixed point over a broad corpus, mirroring the
//        repo's existing sanitizeFixedPoint.dom.test convergence pattern.
//
// Pure offline test depth on the most safety-critical persistence surface — NO
// render-path change, so per AGENTS.md it is not flag-gated.
import { defaultPredicate, defaultTablePredicate } from "shared/schemas/predicate";
import { cleanPredicateType, validatePredicate } from "./predicate";
import { filterFnTypes } from "./filterFns/filterFnTypes";
import { filterReturnForCol } from "./filter";
import { sortFnTypes, sortReturnForCol } from "./sort";
import { Filter, Predicate, Sort } from "shared/types/predicate";

// Silence the validate-loud console.warn (ADR 0034) for the whole file; the
// cleanPredicateType warning content is already pinned in predicate.test.ts, and
// here it is incidental noise that would otherwise spam the corpus loops.
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

// The canonical adversarial container corpus: every value a corrupt or forward-
// version predicate could parse a field as, with the wrong TYPE for that field.
// The point is that EACH must coerce to its safe typed fallback WITHOUT throwing —
// never flow into a consumer that spreads (`...predicate.colsSize`) or
// Object.entries(...) it and produce garbage column state.
const NON_RECORD_VALUES: Array<{ label: string; value: unknown }> = [
  { label: "array", value: [240, 300] },
  { label: "empty array", value: [] },
  { label: "string", value: "240" },
  { label: "number", value: 240 },
  { label: "zero", value: 0 },
  { label: "boolean", value: true },
  { label: "null", value: null },
  { label: "undefined", value: undefined },
];

const NON_STRING_VALUES: Array<{ label: string; value: unknown }> = [
  { label: "number", value: 3 },
  { label: "zero", value: 0 },
  { label: "boolean", value: false },
  { label: "array", value: ["frame"] },
  { label: "object", value: { kind: "table" } },
  { label: "null", value: null },
  { label: "undefined", value: undefined },
];

describe("validatePredicate adversarial passthrough coverage (Notidian-gmzn)", () => {
  // ---------------------------------------------------------------------------
  // colsSize: Record<string, number>. validateRecordField(..., isFiniteNumber).
  // Wrong CONTAINER -> {}. Wrong VALUE entries -> dropped. Never throws.
  // ---------------------------------------------------------------------------
  describe("colsSize (Record<string, finite number>)", () => {
    it.each(NON_RECORD_VALUES)(
      "coerces a non-record colsSize ($label) to {} without throwing",
      ({ value }) => {
        let result!: Predicate;
        expect(() => {
          result = validatePredicate(
            { ...defaultPredicate, colsSize: value as any },
            defaultPredicate
          );
        }).not.toThrow();
        expect(result.colsSize).toEqual({});
      }
    );

    it("drops non-number value entries (string/null/bool/NaN/Infinity) and keeps finite numbers", () => {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          colsSize: {
            "Title.": 240,
            "Zero.": 0,
            "Neg.": -5,
            "Str.": "wide" as any,
            "Null.": null as any,
            "Bool.": true as any,
            "NaN.": NaN as any,
            "Inf.": Infinity as any,
            "Arr.": [1] as any,
          } as any,
        },
        defaultPredicate
      );
      // 0 and a negative are finite numbers and are KEPT (no >=0 floor on cols
      // sizes — that floor is frozenColumnCount/limit, not colsSize); NaN and
      // Infinity are NOT finite and are dropped.
      expect(result.colsSize).toEqual({ "Title.": 240, "Zero.": 0, "Neg.": -5 });
    });
  });

  // ---------------------------------------------------------------------------
  // colsCalc: Record<string, string>. validateRecordField(..., isString).
  // ---------------------------------------------------------------------------
  describe("colsCalc (Record<string, string>)", () => {
    it.each(NON_RECORD_VALUES)(
      "coerces a non-record colsCalc ($label) to {} without throwing",
      ({ value }) => {
        let result!: Predicate;
        expect(() => {
          result = validatePredicate(
            { ...defaultPredicate, colsCalc: value as any },
            defaultPredicate
          );
        }).not.toThrow();
        expect(result.colsCalc).toEqual({});
      }
    );

    it("drops non-string value entries (number/null/object/array) and keeps strings", () => {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          colsCalc: {
            "Amount.": "sum",
            "Empty.": "",
            "Count.": 3 as any,
            "Null.": null as any,
            "Obj.": { fn: "sum" } as any,
            "Arr.": ["sum"] as any,
          } as any,
        },
        defaultPredicate
      );
      // "" is a string and is kept; only non-string values are dropped.
      expect(result.colsCalc).toEqual({ "Amount.": "sum", "Empty.": "" });
    });
  });

  // ---------------------------------------------------------------------------
  // listViewProps / listItemProps / listGroupProps: plain object else default {}.
  // Valid objects are passed through by REFERENCE (identity preserved).
  // ---------------------------------------------------------------------------
  describe("list*Props (plain Record else default {})", () => {
    const PROP_FIELDS = [
      "listViewProps",
      "listItemProps",
      "listGroupProps",
    ] as const;

    for (const field of PROP_FIELDS) {
      it.each(NON_RECORD_VALUES)(
        `coerces a non-object ${field} ($label) to the default {} without throwing`,
        ({ value }) => {
          let result!: Predicate;
          expect(() => {
            result = validatePredicate(
              { ...defaultPredicate, [field]: value as any },
              defaultPredicate
            );
          }).not.toThrow();
          expect(result[field]).toEqual({});
        }
      );

      it(`preserves a valid ${field} object by reference (no spurious copy)`, () => {
        const obj = { displayProperty: "Name", nested: { a: 1 } };
        const result = validatePredicate(
          { ...defaultPredicate, [field]: obj },
          defaultPredicate
        );
        expect(result[field]).toEqual(obj);
        // Identity is preserved — validation does not deep-clone a valid record,
        // so consumers that compare by reference (memo deps) do not see churn.
        expect(result[field]).toBe(obj);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // view / listView / listItem / listGroup: string scalar else schema default.
  // ---------------------------------------------------------------------------
  describe("string-scalar frame/view fields", () => {
    const SCALAR_FIELDS = ["view", "listView", "listItem", "listGroup"] as const;

    for (const field of SCALAR_FIELDS) {
      it.each(NON_STRING_VALUES)(
        `falls back to the default ${field} for a non-string ($label) without throwing`,
        ({ value }) => {
          let result!: Predicate;
          expect(() => {
            result = validatePredicate(
              { ...defaultPredicate, [field]: value as any },
              defaultPredicate
            );
          }).not.toThrow();
          expect(result[field]).toBe(defaultPredicate[field]);
          expect(typeof result[field]).toBe("string");
        }
      );

      it(`preserves a valid string ${field} (no behavior change)`, () => {
        const result = validatePredicate(
          { ...defaultPredicate, [field]: "custom-frame" },
          defaultPredicate
        );
        expect(result[field]).toBe("custom-frame");
      });

      it(`keeps the empty string "" for ${field} (a valid string, not a fallback)`, () => {
        // "" is the schema default for the list* frames; it is a legitimate
        // string, so it must survive rather than be re-defaulted.
        const result = validatePredicate(
          { ...defaultPredicate, [field]: "" },
          defaultPredicate
        );
        expect(result[field]).toBe("");
        expect(typeof result[field]).toBe("string");
      });
    }
  });

  // ---------------------------------------------------------------------------
  // groupBy / colsOrder / colsHidden: string[] (filter to string elements).
  // ---------------------------------------------------------------------------
  describe("string-array column-id fields", () => {
    const ARRAY_FIELDS = ["groupBy", "colsOrder", "colsHidden"] as const;

    for (const field of ARRAY_FIELDS) {
      it.each(NON_RECORD_VALUES.filter((v) => !Array.isArray(v.value)))(
        `coerces a non-array ${field} ($label) to [] without throwing`,
        ({ value }) => {
          let result!: Predicate;
          expect(() => {
            result = validatePredicate(
              { ...defaultPredicate, [field]: value as any },
              defaultPredicate
            );
          }).not.toThrow();
          expect(result[field]).toEqual([]);
        }
      );

      it(`filters non-string elements out of ${field} and keeps order of strings`, () => {
        const result = validatePredicate(
          {
            ...defaultPredicate,
            [field]: [
              "Title.",
              3 as any,
              null as any,
              { x: 1 } as any,
              "Status.",
              undefined as any,
              ["nested"] as any,
              "",
            ] as any,
          },
          defaultPredicate
        );
        // "" is a string and is kept; every non-string element is removed, order
        // among the surviving strings is preserved.
        expect(result[field]).toEqual(["Title.", "Status.", ""]);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // A SINGLE all-fields-corrupt predicate: every passthrough field is the wrong
  // shape at once. The whole thing must validate to a safe, fully typed shape and
  // never throw — the realistic "forward-version / hand-corrupted JSON" scenario.
  // ---------------------------------------------------------------------------
  it("validates an all-fields-corrupt predicate to a safe typed shape without throwing", () => {
    let result!: Predicate;
    expect(() => {
      result = validatePredicate(
        {
          // Deliberately every field is the WRONG type for its slot.
          view: 1 as any,
          listView: ["frame"] as any,
          listItem: 2 as any,
          listGroup: {} as any,
          listViewProps: "x" as any,
          listItemProps: [1] as any,
          listGroupProps: 5 as any,
          filters: "not-an-array" as any,
          sort: { fn: "alphabetical" } as any,
          groupBy: "Status." as any,
          colsOrder: 0 as any,
          colsHidden: { a: true } as any,
          colsSize: [1, 2] as any,
          colsCalc: "sum" as any,
          colsHeaderDisplay: "wide" as any,
          colsDataAnchor: 7 as any,
          colsWrap: "wrap" as any,
          tableDirection: "sideways" as any,
          frozenColumnCount: -3 as any,
          limit: -1 as any,
        } as any,
        defaultPredicate
      );
    }).not.toThrow();
    // Every field landed on its safe typed fallback.
    expect(typeof result.view).toBe("string");
    expect(result.listViewProps).toEqual({});
    expect(result.listItemProps).toEqual({});
    expect(result.listGroupProps).toEqual({});
    expect(result.filters).toEqual([]);
    expect(result.sort).toEqual([]);
    expect(result.groupBy).toEqual([]);
    expect(result.colsOrder).toEqual([]);
    expect(result.colsHidden).toEqual([]);
    expect(result.colsSize).toEqual({});
    expect(result.colsCalc).toEqual({});
    expect(result.colsHeaderDisplay).toEqual({});
    expect(result.colsDataAnchor).toEqual({});
    expect(result.tableDirection).toBe("ltr");
    expect(result.frozenColumnCount).toBe(0);
    expect(result.limit).toBe(0);
  });

  it("returns the default predicate verbatim for a null/undefined input (no throw)", () => {
    expect(validatePredicate(null as any, defaultPredicate)).toBe(defaultPredicate);
    expect(validatePredicate(undefined as any, defaultPredicate)).toBe(
      defaultPredicate
    );
  });
});

// ===========================================================================
// (P1) cleanPredicateType validates `.fn` but NOT `.field`. A known-fn filter/
// sort whose `field` is missing or non-string survives validation and reaches
// the fail-open dispatchers (row[filter.field] / row[sort.field]). Pin that the
// gap is handled SAFELY end-to-end: survives validation, dispatcher never throws.
// ===========================================================================
describe("cleanPredicateType + dispatcher field type-robustness (Notidian-gmzn)", () => {
  const textCol = { name: "Title", schemaId: "s", type: "text" } as any;
  const flexCol = { name: "Mixed", schemaId: "s", type: "flex" } as any;
  const row = { Title: "Hello World", Mixed: JSON.stringify({ value: "v", type: "text" }) } as any;

  // The exact malformed `.field` shapes the dispatcher must tolerate (it indexes
  // row[field], so any non-string is a missing-key lookup -> undefined, never a
  // throw). `undefined`/missing field exercises the absent-key path too.
  const BAD_FIELDS: Array<{ label: string; field: unknown }> = [
    { label: "missing", field: undefined },
    { label: "null", field: null },
    { label: "number", field: 3 },
    { label: "boolean", field: true },
    { label: "object", field: { name: "Title" } },
    { label: "array", field: ["Title"] },
  ];

  it("does NOT drop a KNOWN-fn filter merely because .field is non-string (only fn is validated)", () => {
    const filters = [
      { fn: "is", field: 3 as any, value: "x" } as Filter,
      { fn: "is", value: "x" } as Filter, // .field entirely absent
      { fn: "include", field: null as any, value: "y" } as Filter,
    ];
    const kept = cleanPredicateType(filters, filterFnTypes) as Filter[];
    // All three have a known fn, so all three survive — this is the documented
    // gap the dispatchers must (and do) tolerate, NOT a drop point.
    expect(kept).toHaveLength(3);
  });

  it("does NOT drop a KNOWN-fn sort merely because .field is non-string", () => {
    const sorts = [
      { fn: "alphabetical", field: 7 as any } as Sort,
      { fn: "alphabetical" } as Sort, // .field absent
    ];
    const kept = cleanPredicateType(sorts, sortFnTypes) as Sort[];
    expect(kept).toHaveLength(2);
  });

  it.each(BAD_FIELDS)(
    "filterReturnForCol never throws on a $label .field (literal fType, text + flex col)",
    ({ field }) => {
      expect(() =>
        filterReturnForCol(
          textCol,
          { fn: "include", fType: "literal", field: field as any, value: "x" } as any,
          row,
          {}
        )
      ).not.toThrow();
      expect(() =>
        filterReturnForCol(
          flexCol,
          { fn: "include", fType: "literal", field: field as any, value: "x" } as any,
          row,
          {}
        )
      ).not.toThrow();
    }
  );

  it.each(BAD_FIELDS)(
    "sortReturnForCol never throws on a $label .field (text col) and returns a number",
    ({ field }) => {
      // The gmzn concern: row[sort.field] with a non-string field is a missing-key
      // lookup -> undefined; the comparator must tolerate it (stringSort guards
      // null). Pinned on the text column — the realistic table-row sort path.
      let result: number = NaN;
      expect(() => {
        result = sortReturnForCol(
          textCol,
          { fn: "alphabetical", field: field as any } as any,
          { Title: "a" } as any,
          { Title: "b" } as any
        );
      }).not.toThrow();
      expect(typeof result).toBe("number");
    }
  );

  it.each(BAD_FIELDS)(
    "sortReturnForCol never throws on a $label .field for a flex col under a COUNT sort",
    ({ field }) => {
      // The flex path runs row[field] through parseMultiString (always an array);
      // the count-family sorts compare `.length` numerically (safe). A non-string
      // field -> parseMultiString(undefined) -> [] -> length 0, no throw.
      // (The alphabetical/number flex sorts have an ORTHOGONAL pre-existing defect
      // pinned separately below — Notidian-gmzn discovery — so they are not used
      // here to keep this assertion about the .field concern only.)
      let result: number = NaN;
      expect(() => {
        result = sortReturnForCol(
          flexCol,
          { fn: "count", field: field as any } as any,
          row,
          row
        );
      }).not.toThrow();
      expect(typeof result).toBe("number");
    }
  );

  // ---- DEFECT-PIN (discovered by Notidian-gmzn; follow-up filed) -------------
  // sortReturnForCol on a FLEX column under a STRING/NUMBER sort (alphabetical,
  // number, …) THROWS — independently of `.field` validity. The flex branch wraps
  // the cell in parseMultiString (which always returns an array), but stringSort
  // does `value.localeCompare(...)` and numSort treats it numerically; an array
  // has no .localeCompare, so Array.prototype.sort's comparator throws and aborts
  // the WHOLE sort pass. Locked as characterization (current behavior), NOT fixed
  // here: this is outside gmzn's persistence-validation scope. Flipping it is a
  // deliberate, reviewed fix on the discovered follow-up bead.
  it("DEFECT-PIN: a flex column under an `alphabetical` sort throws (parseMultiString array vs stringSort.localeCompare)", () => {
    const validFlexRow = {
      Mixed: JSON.stringify({ value: "a", type: "text" }),
    } as any;
    const validFlexRow2 = {
      Mixed: JSON.stringify({ value: "b", type: "text" }),
    } as any;
    // Throws even with a perfectly VALID string field — so it is a flex+string-sort
    // defect, not a `.field` type problem.
    expect(() =>
      sortReturnForCol(
        flexCol,
        { fn: "alphabetical", field: "Mixed" } as any,
        validFlexRow,
        validFlexRow2
      )
    ).toThrow(TypeError);
  });

  it("end-to-end: a validated predicate carrying a non-string-field filter does not crash the dispatcher", () => {
    // validatePredicate keeps the known-fn filter (fn === "include") even though
    // its .field is a number; feeding the survivor to the dispatcher must not
    // throw — pins the whole load -> filter pass against the row[filter.field]
    // TypeError class (filter.ts:19) for a corrupt field.
    const validated = validatePredicate(
      {
        ...defaultPredicate,
        filters: [
          { fn: "include", fType: "literal", field: 99 as any, value: "x" } as Filter,
        ],
        sort: [{ fn: "alphabetical", field: 99 as any } as Sort],
      },
      defaultPredicate
    );
    expect(validated.filters).toHaveLength(1);
    expect(validated.sort).toHaveLength(1);
    for (const f of validated.filters) {
      expect(() =>
        filterReturnForCol(textCol, f as any, row, {})
      ).not.toThrow();
    }
    for (const s of validated.sort) {
      expect(() =>
        sortReturnForCol(textCol, s as any, { Title: "a" } as any, { Title: "b" } as any)
      ).not.toThrow();
    }
  });
});

// ===========================================================================
// (P2) Fixed-point / idempotence property: validatePredicate is a WHITELIST, so
// the load->save->load loop MUST converge. validatePredicate(validatePredicate(p))
// === validatePredicate(p) for arbitrary structured inputs. Mirrors the repo's
// sanitizeFixedPoint.dom.test convergence pattern.
// ===========================================================================
describe("validatePredicate fixed-point / idempotence property (Notidian-gmzn)", () => {
  // A broad corpus: well-formed predicates (must be untouched), partially corrupt
  // predicates (one bad field), and an all-bad predicate. Each must reach a fixed
  // point in one pass and stay there.
  const goodFilter: Filter = { fn: "is", fType: "literal", field: "Title", value: "x" };
  const goodSort: Sort = { fn: "alphabetical", field: "Title" };

  const CORPUS: Array<{ label: string; predicate: any }> = [
    { label: "the default predicate itself", predicate: { ...defaultPredicate } },
    { label: "the default TABLE predicate", predicate: { ...defaultTablePredicate } },
    {
      label: "a fully-populated valid predicate",
      predicate: {
        ...defaultTablePredicate,
        view: "table",
        listView: "frame",
        listViewProps: { displayProperty: "Name" },
        filters: [goodFilter],
        sort: [goodSort],
        groupBy: ["Status."],
        colsOrder: ["Title.", "Status."],
        colsHidden: ["Tags."],
        colsSize: { "Title.": 240, "Status.": 120 },
        colsCalc: { "Amount.": "sum" },
        colsHeaderDisplay: { "Status.": "icon" },
        colsDataAnchor: { "Amount.": "right" },
        colsWrap: { "Notes.": "wrap" },
        tableDirection: "rtl",
        frozenColumnCount: 2,
        limit: 50,
        chart: { visible: true, groupKey: "Status", aggregate: "count" },
        subItems: { field: "Parent" },
      },
    },
    {
      label: "a partially-corrupt predicate (wrong container types)",
      predicate: {
        ...defaultPredicate,
        colsSize: { a: NaN, b: 5, c: "wide" },
        colsCalc: ["sum"],
        view: 3,
        listViewProps: ["x"],
        colsOrder: ["x", 3, null],
        groupBy: { Status: true },
        filters: [
          goodFilter,
          { fn: "noSuchFn", field: "A", value: "z" },
          { fn: "include", field: 7, value: "q" },
        ],
        sort: [goodSort, { fn: "noSuchSort", field: "B" }, { fn: "alphabetical", field: 9 }],
        frozenColumnCount: 2.9,
        limit: -4,
        tableDirection: "sideways",
        chart: 5,
        subItems: { notField: true },
      },
    },
    {
      label: "an all-fields-corrupt predicate",
      predicate: {
        view: [1],
        listView: 2,
        listItem: {},
        listGroup: null,
        listViewProps: "x",
        listItemProps: 1,
        listGroupProps: [2],
        filters: "x",
        sort: 3,
        groupBy: "x",
        colsOrder: 0,
        colsHidden: { a: 1 },
        colsSize: "240",
        colsCalc: 9,
        colsHeaderDisplay: "wide",
        colsDataAnchor: [1],
        colsWrap: 4,
        tableDirection: 7,
        frozenColumnCount: "x",
        limit: {},
      },
    },
  ];

  it.each(CORPUS)("reaches a fixed point on $label", ({ predicate }) => {
    const once = validatePredicate(predicate as Predicate, defaultPredicate);
    const twice = validatePredicate(once, defaultPredicate);
    // Structural equality: the second pass changes nothing.
    expect(twice).toEqual(once);
    // And a THIRD pass is still stable (true convergence, not a 2-cycle).
    expect(validatePredicate(twice, defaultPredicate)).toEqual(once);
  });

  it("a clean validated predicate is BYTE-stable (no silent drift on re-save)", () => {
    // The headline reason idempotence matters: opening and re-saving a view must
    // not mutate a clean predicate. JSON round-trip equality catches any reorder/
    // type drift a shallow toEqual might miss.
    for (const { predicate } of CORPUS) {
      const once = validatePredicate(predicate as Predicate, defaultPredicate);
      const twice = validatePredicate(once, defaultPredicate);
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    }
  });

  it("the SECOND pass over a corrupt predicate no longer warns (unknown fns already stripped)", () => {
    // After one validation pass the unknown-fn filters/sorts are gone, so a
    // re-validate (the steady-state re-save) is silent — the validate-loud warning
    // fires once at the corruption boundary, not on every subsequent save.
    const corrupt = {
      ...defaultPredicate,
      filters: [goodFilter, { fn: "noSuchFn", field: "A", value: "z" } as Filter],
      sort: [goodSort, { fn: "noSuchSort", field: "B" } as Sort],
    };
    const once = validatePredicate(corrupt, defaultPredicate);
    warnSpy.mockClear();
    const twice = validatePredicate(once, defaultPredicate);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(twice).toEqual(once);
  });

  it("the fully-populated valid predicate survives validation unchanged (whitelist preserves all known fields)", () => {
    const valid = CORPUS.find(
      (c) => c.label === "a fully-populated valid predicate"
    )!.predicate;
    const result = validatePredicate(valid as Predicate, defaultPredicate);
    // Every field the user set is carried through (no silent loss on save).
    expect(result.view).toBe("table");
    expect(result.filters).toEqual(valid.filters);
    expect(result.sort).toEqual(valid.sort);
    expect(result.colsSize).toEqual(valid.colsSize);
    expect(result.colsCalc).toEqual(valid.colsCalc);
    expect(result.tableDirection).toBe("rtl");
    expect(result.frozenColumnCount).toBe(2);
    expect(result.limit).toBe(50);
    expect(result.chart).toEqual(valid.chart);
    expect(result.subItems).toEqual(valid.subItems);
    // And it is a fixed point.
    expect(validatePredicate(result, defaultPredicate)).toEqual(result);
  });
});
