import { defaultPredicate } from "shared/schemas/predicate";
import { safelyParseJSON } from "shared/utils/json";
import {
  ChartPredicate,
  ColumnDataAnchor,
  ColumnHeaderDisplayMode,
  ColumnWrapMode,
  Filter,
  Predicate,
  Sort,
  SubItemsDisplay,
  SubItemsFilterScope,
  SubItemsPredicate,
} from "shared/types/predicate";
import { defaultPredicateForSchema, validatePredicate } from "./predicate";

// ===========================================================================
// Notidian-5bqg — PROPERTY TESTS for predicate persistence round-trip.
//
// Generates 1000+ random Predicate objects and verifies the four invariants:
// (1) save-then-load round-trip preserves all fields byte-identically,
// (2) validatePredicate never drops recognized Predicate-type fields,
// (3) partial edits via spread never overwrite unrelated fields,
// (4) adversarial values (0, false, empty arrays, Unicode keys, deeply nested
//     chart/subItems) survive the cycle.
//
// Uses the same saveCycle/loadCycle seam as predicate.persistence.test.ts.
// ===========================================================================

// --- seeded PRNG (xorshift32) for deterministic property tests ---
class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed | 0 || 1;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x;
    return (x >>> 0) / 0x100000000;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  bool(): boolean {
    return this.next() < 0.5;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  subset<T>(arr: readonly T[], maxLen?: number): T[] {
    const len = this.int(0, maxLen ?? arr.length);
    const copy = [...arr];
    const result: T[] = [];
    for (let i = 0; i < len && copy.length > 0; i++) {
      const idx = this.int(0, copy.length - 1);
      result.push(copy.splice(idx, 1)[0]);
    }
    return result;
  }
}

// --- Production seam (identical to predicate.persistence.test.ts) ---
const saveCycle = (
  prev: Partial<Predicate>,
  edit: Partial<Predicate>,
  defPredicate: Predicate
): string => {
  const merged = { ...defPredicate, ...prev, ...edit } as Predicate;
  return JSON.stringify(validatePredicate(merged, defPredicate));
};
const loadCycle = (stored: string, defPredicate: Predicate): Predicate =>
  validatePredicate(safelyParseJSON(stored), defPredicate);

// --- Known valid enum values ---
const KNOWN_FILTER_FNS = [
  "isNotEmpty", "isEmpty", "include", "notInclude", "is", "isNot", "equal",
  "isLink", "isNotLink", "isGreatThan", "isLessThan", "isLessThanOrEqual",
  "isGreatThanOrEqual", "dateBefore", "dateAfter", "isSameDate",
  "isSameDateAsToday", "isExactList", "isAnyInList", "isNoneInList",
  "isTrue", "isFalse",
] as const;

const KNOWN_SORT_FNS = [
  "alphabetical", "reverseAlphabetical", "optionOrder", "reverseOptionOrder",
  "linkAlphabetical", "linkReverseAlphabetical", "earliest", "latest",
  "boolean", "booleanReverse", "number", "reverseNumber",
  "optionMultiOrder", "reverseOptionMultiOrder", "count", "reverseCount",
  "optionMultiCount", "reverseOptionMultiCount",
] as const;

const FILTER_TYPES = [
  "text", "file", "number", "option", "option-multi", "link",
  "link-multi", "date", "boolean", "context", "context-multi",
] as const;

const HEADER_DISPLAYS: ColumnHeaderDisplayMode[] = ["adaptive", "full", "text", "icon"];
const DATA_ANCHORS: ColumnDataAnchor[] = ["left", "center", "right"];
const WRAP_MODES: ColumnWrapMode[] = ["clip", "wrap"];
const SUB_ITEMS_DISPLAYS: SubItemsDisplay[] = ["nested", "flattened", "parents-only"];
const SUB_ITEMS_FILTER_SCOPES: SubItemsFilterScope[] = [
  "parents", "parentsAndSubItems", "subItems",
];
const VIEWS = ["list", "table", "board", "flow", "calendar", "detail", "catalog"];

// Unicode and adversarial column names
const ADVERSARIAL_NAMES = [
  "Name", "Count", "Status", "O'Brien", 'a"b', "c'd", "", "  ", "0",
  "éàü", "你好", "😀🚀", "العربية",
  "col with spaces", "col\twith\ttabs", "null", "undefined", "true", "false",
  "__proto__", "constructor", "toString", "hasOwnProperty",
];

// --- Random generators ---
function randomColumnName(rng: SeededRandom): string {
  return rng.pick(ADVERSARIAL_NAMES);
}

function randomColumnNames(rng: SeededRandom, min = 0, max = 6): string[] {
  const len = rng.int(min, max);
  const result: string[] = [];
  for (let i = 0; i < len; i++) {
    result.push(randomColumnName(rng));
  }
  return result;
}

function randomFilter(rng: SeededRandom): Filter {
  return {
    field: randomColumnName(rng),
    fn: rng.pick(KNOWN_FILTER_FNS),
    value: rng.bool() ? "" : `val-${rng.int(0, 1000)}`,
    fType: rng.pick(FILTER_TYPES),
  };
}

function randomSort(rng: SeededRandom): Sort {
  return {
    field: randomColumnName(rng),
    fn: rng.pick(KNOWN_SORT_FNS),
  };
}

function randomRecord<V>(
  rng: SeededRandom,
  valueFn: (rng: SeededRandom) => V,
  max = 5
): Record<string, V> {
  const len = rng.int(0, max);
  const result: Record<string, V> = {};
  for (let i = 0; i < len; i++) {
    result[randomColumnName(rng)] = valueFn(rng);
  }
  return result;
}

function randomChart(rng: SeededRandom): ChartPredicate | undefined {
  if (rng.next() < 0.6) return undefined;
  const aggregates = ["count", "sum", "avg", "min", "max"] as const;
  return {
    visible: rng.bool(),
    groupKey: randomColumnName(rng),
    aggregate: rng.pick(aggregates),
    valueKey: rng.bool() ? randomColumnName(rng) : undefined,
  };
}

function randomSubItems(rng: SeededRandom): SubItemsPredicate | undefined {
  if (rng.next() < 0.6) return undefined;
  const field = randomColumnName(rng);
  // Empty string field makes validateSubItems return undefined, skip that
  if (!field) return undefined;
  const out: SubItemsPredicate = { field };
  // Add non-default display with some probability
  if (rng.bool()) {
    const display = rng.pick(SUB_ITEMS_DISPLAYS);
    if (display !== "nested") out.display = display;
  }
  // Add non-default filterScope with some probability
  if (rng.bool()) {
    const scope = rng.pick(SUB_ITEMS_FILTER_SCOPES);
    if (scope !== "parentsAndSubItems") out.filterScope = scope;
  }
  // Add collapsed paths
  if (rng.bool()) {
    const paths = randomColumnNames(rng, 1, 4).filter((p) => p.length > 0);
    if (paths.length > 0) out.collapsed = paths;
  }
  return out;
}

// Generate a valid (non-default-only) Record<string, ColumnHeaderDisplayMode>
// that will survive validation: only non-"adaptive" values persist in
// validation because "adaptive" is the default and gets reduced away.
// Actually: looking at validatePredicate, it keeps values that match the
// propertyHeaderDisplayModeForValue output. So any valid display mode stays.
function randomColsHeaderDisplay(
  rng: SeededRandom
): Record<string, ColumnHeaderDisplayMode> {
  return randomRecord(rng, (r) => r.pick(HEADER_DISPLAYS));
}

// Only non-"auto" values survive colsDataAnchor validation.
function randomColsDataAnchor(
  rng: SeededRandom
): Record<string, ColumnDataAnchor> {
  return randomRecord(rng, (r) => r.pick(DATA_ANCHORS));
}

// Only "wrap" survives colsWrap validation (not "clip", which is the default
// and is dropped).
function randomColsWrap(
  rng: SeededRandom
): Record<string, ColumnWrapMode> {
  return randomRecord(rng, (r) => r.pick(WRAP_MODES));
}

// Generate groupOrder/collapsedGroups: Record<string, string[]> where keys are
// non-empty and values are non-empty arrays of non-empty, unique strings.
function randomGroupedIslandRecord(
  rng: SeededRandom
): Record<string, string[]> | undefined {
  if (rng.next() < 0.5) return undefined;
  const len = rng.int(1, 3);
  const result: Record<string, string[]> = {};
  for (let i = 0; i < len; i++) {
    const key = randomColumnName(rng);
    if (key.length === 0) continue;
    const values: string[] = [];
    const vLen = rng.int(1, 4);
    for (let j = 0; j < vLen; j++) {
      const v = randomColumnName(rng);
      if (v.length > 0 && !values.includes(v)) values.push(v);
    }
    if (values.length > 0) result[key] = values;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function randomPredicate(rng: SeededRandom): Predicate {
  const filtersCount = rng.int(0, 5);
  const filters: Filter[] = [];
  for (let i = 0; i < filtersCount; i++) filters.push(randomFilter(rng));

  const sortsCount = rng.int(0, 4);
  const sort: Sort[] = [];
  for (let i = 0; i < sortsCount; i++) sort.push(randomSort(rng));

  const frozenColumnCount = rng.int(0, 10);
  const limit = rng.int(0, 100);

  return {
    view: rng.pick(VIEWS),
    listView: rng.bool() ? `lv-${rng.int(0, 10)}` : "",
    listItem: rng.bool() ? `li-${rng.int(0, 10)}` : "",
    listGroup: rng.bool() ? `lg-${rng.int(0, 10)}` : "",
    listViewProps: rng.bool() ? { key: `val-${rng.int(0, 10)}` } : {},
    listItemProps: rng.bool() ? { key: `val-${rng.int(0, 10)}` } : {},
    listGroupProps: rng.bool() ? { key: `val-${rng.int(0, 10)}` } : {},
    filters,
    sort,
    groupBy: randomColumnNames(rng),
    groupOrder: randomGroupedIslandRecord(rng),
    collapsedGroups: randomGroupedIslandRecord(rng),
    colsOrder: randomColumnNames(rng),
    colsHidden: randomColumnNames(rng),
    colsSize: randomRecord(rng, (r) => r.int(20, 500)),
    colsCalc: randomRecord(rng, (r) => r.pick(["sum", "avg", "count", "min", "max", "none"])),
    colsHeaderDisplay: randomColsHeaderDisplay(rng),
    colsDataAnchor: randomColsDataAnchor(rng),
    colsWrap: randomColsWrap(rng),
    tableDirection: rng.bool() ? "rtl" : "ltr",
    frozenColumnCount,
    limit,
    chart: randomChart(rng),
    subItems: randomSubItems(rng),
  };
}

// --- Normalization: what validatePredicate canonically does ---
// Some fields are canonically dropped/transformed during validation. To test
// byte-identity we need to understand the canonical form after one pass.
// Instead of re-implementing the validator, we simply pass through validate
// once and use THAT as the expected canonical form.

describe("Notidian-5bqg: property tests for predicate persistence round-trip integrity", () => {
  const defPredicate = defaultPredicateForSchema({
    id: "files",
    name: "Files",
    type: "db",
  } as any);

  const ITERATION_COUNT = 1200;

  // =====================================================================
  // INVARIANT 1: save-then-load round-trip preserves all fields
  // byte-identically (serialize(deserialize(s)) === s).
  // =====================================================================
  describe("invariant 1: save-then-load byte-identity", () => {
    it(`round-trips ${ITERATION_COUNT} random predicates through save/load without mutation`, () => {
      const rng = new SeededRandom(42);
      let failures = 0;
      const failureDetails: string[] = [];

      for (let i = 0; i < ITERATION_COUNT; i++) {
        const pred = randomPredicate(rng);
        const stored = saveCycle({}, pred, defPredicate);
        const loaded = loadCycle(stored, defPredicate);
        const stored2 = JSON.stringify(validatePredicate(loaded, defPredicate));

        if (stored !== stored2) {
          failures++;
          if (failureDetails.length < 5) {
            failureDetails.push(
              `iteration ${i}: stored1 length=${stored.length}, stored2 length=${stored2.length}`
            );
          }
        }
      }

      expect(failures).toBe(0);
      if (failures > 0) {
        // Provide debug info on failure
        throw new Error(
          `${failures}/${ITERATION_COUNT} predicates failed byte-identity round-trip:\n` +
          failureDetails.join("\n")
        );
      }
    });

    it("round-trip is idempotent: multiple cycles produce the same bytes", () => {
      const rng = new SeededRandom(123);
      for (let i = 0; i < 200; i++) {
        const pred = randomPredicate(rng);
        const stored1 = saveCycle({}, pred, defPredicate);
        const loaded1 = loadCycle(stored1, defPredicate);
        const stored2 = saveCycle({}, loaded1, defPredicate);
        const loaded2 = loadCycle(stored2, defPredicate);
        const stored3 = saveCycle({}, loaded2, defPredicate);
        expect(stored2).toBe(stored1);
        expect(stored3).toBe(stored1);
      }
    });
  });

  // =====================================================================
  // INVARIANT 2: validatePredicate never drops recognized Predicate fields.
  // =====================================================================
  describe("invariant 2: validatePredicate preserves all recognized Predicate-type fields", () => {
    // These are ALL the required + optional keys defined on the Predicate type.
    const PREDICATE_KEYS: (keyof Predicate)[] = [
      "view", "listView", "listItem", "listGroup",
      "listViewProps", "listItemProps", "listGroupProps",
      "filters", "sort", "groupBy",
      "groupOrder", "collapsedGroups",
      "colsOrder", "colsHidden", "colsSize", "colsCalc",
      "colsHeaderDisplay", "colsDataAnchor", "colsWrap",
      "tableDirection", "frozenColumnCount", "limit",
      "chart", "subItems",
    ];

    // Required keys that must always appear on the validated output
    const REQUIRED_KEYS: (keyof Predicate)[] = [
      "view", "listView", "listItem", "listGroup",
      "listViewProps", "listItemProps", "listGroupProps",
      "filters", "sort", "groupBy",
      "colsOrder", "colsHidden", "colsSize", "colsCalc",
      "colsHeaderDisplay", "colsDataAnchor",
      "tableDirection", "frozenColumnCount", "limit",
    ];

    it(`all required Predicate keys survive validation across ${ITERATION_COUNT} random inputs`, () => {
      const rng = new SeededRandom(777);
      for (let i = 0; i < ITERATION_COUNT; i++) {
        const pred = randomPredicate(rng);
        const validated = validatePredicate(pred, defPredicate);
        for (const key of REQUIRED_KEYS) {
          expect(validated).toHaveProperty(key);
        }
      }
    });

    it("optional fields (chart, subItems, groupOrder, collapsedGroups, colsWrap) are preserved when valid", () => {
      const rng = new SeededRandom(999);
      let chartPreserved = 0;
      let subItemsPreserved = 0;
      let groupOrderPreserved = 0;
      let collapsedGroupsPreserved = 0;
      let colsWrapPreserved = 0;

      for (let i = 0; i < ITERATION_COUNT; i++) {
        const pred = randomPredicate(rng);
        const validated = validatePredicate(pred, defPredicate);

        if (pred.chart && typeof pred.chart === "object") {
          expect(validated.chart).toBeDefined();
          chartPreserved++;
        }
        if (
          pred.subItems &&
          typeof pred.subItems === "object" &&
          typeof pred.subItems.field === "string" &&
          pred.subItems.field.length > 0
        ) {
          expect(validated.subItems).toBeDefined();
          expect(validated.subItems!.field).toBe(pred.subItems.field);
          subItemsPreserved++;
        }
        if (pred.groupOrder) {
          // groupOrder survives if it has at least one non-empty key with
          // non-empty string values (the validator drops empty ones)
          const hasValidEntry = Object.entries(pred.groupOrder).some(
            ([k, v]) =>
              k.length > 0 &&
              Array.isArray(v) &&
              v.some((s) => typeof s === "string" && s.length > 0)
          );
          if (hasValidEntry) {
            expect(validated.groupOrder).toBeDefined();
            groupOrderPreserved++;
          }
        }
        if (pred.collapsedGroups) {
          const hasValidEntry = Object.entries(pred.collapsedGroups).some(
            ([k, v]) =>
              k.length > 0 &&
              Array.isArray(v) &&
              v.some((s) => typeof s === "string" && s.length > 0)
          );
          if (hasValidEntry) {
            expect(validated.collapsedGroups).toBeDefined();
            collapsedGroupsPreserved++;
          }
        }
        if (pred.colsWrap && Object.keys(pred.colsWrap).length > 0) {
          // colsWrap survives for values that are "wrap" (not "clip")
          const hasWrap = Object.values(pred.colsWrap).some((v) => v === "wrap");
          if (hasWrap) {
            expect(validated.colsWrap).toBeDefined();
            colsWrapPreserved++;
          }
        }
      }

      // Sanity: at least some optional fields were generated and preserved
      expect(chartPreserved).toBeGreaterThan(0);
      expect(subItemsPreserved).toBeGreaterThan(0);
      expect(groupOrderPreserved).toBeGreaterThan(0);
      expect(colsWrapPreserved).toBeGreaterThan(0);
    });

    it("validatePredicate output contains no EXTRA keys beyond the Predicate type", () => {
      const rng = new SeededRandom(555);
      for (let i = 0; i < 200; i++) {
        const pred = randomPredicate(rng);
        const validated = validatePredicate(pred, defPredicate);
        const validatedKeys = Object.keys(validated);
        for (const key of validatedKeys) {
          expect(PREDICATE_KEYS).toContain(key);
        }
      }
    });
  });

  // =====================================================================
  // INVARIANT 3: partial edits via spread never overwrite unrelated fields.
  // =====================================================================
  describe("invariant 3: partial edits preserve unrelated fields", () => {
    it(`partial edits across ${ITERATION_COUNT} random predicates preserve non-edited fields`, () => {
      const rng = new SeededRandom(314);

      // Each partial-edit field and a generator for it
      const editGenerators: {
        key: keyof Predicate;
        gen: (r: SeededRandom) => Partial<Predicate>;
      }[] = [
        { key: "colsSize", gen: (r) => ({ colsSize: { X: r.int(50, 300) } }) },
        { key: "colsHidden", gen: (r) => ({ colsHidden: randomColumnNames(r, 1, 3) }) },
        { key: "colsOrder", gen: (r) => ({ colsOrder: randomColumnNames(r, 1, 3) }) },
        { key: "frozenColumnCount", gen: (r) => ({ frozenColumnCount: r.int(0, 5) }) },
        { key: "filters", gen: (r) => ({ filters: [randomFilter(r)] }) },
        { key: "sort", gen: (r) => ({ sort: [randomSort(r)] }) },
        { key: "groupBy", gen: (r) => ({ groupBy: randomColumnNames(r, 1, 2) }) },
        {
          key: "colsCalc",
          gen: (r) => ({ colsCalc: { [randomColumnName(r)]: r.pick(["sum", "avg"]) } }),
        },
        {
          key: "colsHeaderDisplay",
          gen: (r) => ({
            colsHeaderDisplay: { [randomColumnName(r)]: r.pick(HEADER_DISPLAYS) },
          }),
        },
        {
          key: "colsDataAnchor",
          gen: (r) => ({
            colsDataAnchor: { [randomColumnName(r)]: r.pick(DATA_ANCHORS) },
          }),
        },
        {
          key: "colsWrap",
          gen: (r) => ({
            colsWrap: { [randomColumnName(r)]: r.pick(WRAP_MODES) },
          }),
        },
        { key: "limit", gen: (r) => ({ limit: r.int(0, 50) }) },
      ];

      for (let i = 0; i < ITERATION_COUNT; i++) {
        const basePred = randomPredicate(rng);
        // Establish baseline by doing one round-trip
        const stored1 = saveCycle({}, basePred, defPredicate);
        const baseline = loadCycle(stored1, defPredicate);

        // Pick a random edit
        const editSpec = rng.pick(editGenerators);
        const edit = editSpec.gen(rng);

        // Apply partial edit
        const stored2 = saveCycle(baseline, edit, defPredicate);
        const afterEdit = loadCycle(stored2, defPredicate);

        // Verify all NON-edited fields are unchanged
        const baselineJson = JSON.parse(stored1);
        const afterEditJson = JSON.parse(stored2);

        for (const key of Object.keys(baselineJson)) {
          if (key === editSpec.key) continue;
          // The edited field was the only one that should differ
          expect(afterEditJson[key]).toEqual(baselineJson[key]);
        }
      }
    });
  });

  // =====================================================================
  // INVARIANT 4: adversarial values survive the cycle.
  // =====================================================================
  describe("invariant 4: adversarial values survive the round-trip", () => {
    it("frozenColumnCount = 0 survives (falsy but valid)", () => {
      const stored = saveCycle({}, { frozenColumnCount: 0 }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.frozenColumnCount).toBe(0);
    });

    it("limit = 0 survives (falsy but valid)", () => {
      const stored = saveCycle({}, { limit: 0 }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.limit).toBe(0);
    });

    it("chart.visible = false survives", () => {
      const chart: ChartPredicate = {
        visible: false,
        groupKey: "Status",
        aggregate: "count",
      };
      const stored = saveCycle({}, { chart }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.chart).toBeDefined();
      expect(loaded.chart!.visible).toBe(false);
    });

    it("empty arrays for filters/sort/groupBy/colsOrder/colsHidden survive", () => {
      const stored = saveCycle(
        {},
        {
          filters: [],
          sort: [],
          groupBy: [],
          colsOrder: [],
          colsHidden: [],
        },
        defPredicate
      );
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.filters).toEqual([]);
      expect(loaded.sort).toEqual([]);
      expect(loaded.groupBy).toEqual([]);
      expect(loaded.colsOrder).toEqual([]);
      expect(loaded.colsHidden).toEqual([]);
    });

    it("empty records for colsSize/colsCalc/colsHeaderDisplay/colsDataAnchor survive", () => {
      const stored = saveCycle(
        {},
        {
          colsSize: {},
          colsCalc: {},
          colsHeaderDisplay: {},
          colsDataAnchor: {},
        },
        defPredicate
      );
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.colsSize).toEqual({});
      expect(loaded.colsCalc).toEqual({});
      expect(loaded.colsHeaderDisplay).toEqual({});
      expect(loaded.colsDataAnchor).toEqual({});
    });

    it("Unicode column keys survive in all record fields", () => {
      const unicodeKeys = ["你好", "éàü", "😀🚀", "العربية"];
      const stored = saveCycle(
        {},
        {
          colsSize: Object.fromEntries(unicodeKeys.map((k) => [k, 100])),
          colsCalc: Object.fromEntries(unicodeKeys.map((k) => [k, "sum"])),
          colsHidden: unicodeKeys,
          colsOrder: unicodeKeys,
          groupBy: unicodeKeys,
        },
        defPredicate
      );
      const loaded = loadCycle(stored, defPredicate);
      for (const k of unicodeKeys) {
        expect(loaded.colsSize[k]).toBe(100);
        expect(loaded.colsCalc[k]).toBe("sum");
      }
      expect(loaded.colsHidden).toEqual(unicodeKeys);
      expect(loaded.colsOrder).toEqual(unicodeKeys);
      expect(loaded.groupBy).toEqual(unicodeKeys);
    });

    it("prototype-polluting key names in records do not corrupt the object", () => {
      // __proto__ as a record key is intercepted by JS's __proto__ setter in the
      // validator's reduce loop, so it does NOT survive as an own data property.
      // This is the SAFE outcome — we verify no corruption, not round-trip.
      const dangerousKeys = ["__proto__", "constructor", "toString", "hasOwnProperty"];
      // Keys that survive as own properties (non-__proto__)
      const survivingKeys = ["constructor", "toString", "hasOwnProperty"];
      const stored = saveCycle(
        {},
        {
          colsSize: Object.fromEntries(dangerousKeys.map((k) => [k, 100])),
          colsCalc: Object.fromEntries(dangerousKeys.map((k) => [k, "sum"])),
          colsHidden: dangerousKeys,
          colsOrder: dangerousKeys,
        },
        defPredicate
      );
      const loaded = loadCycle(stored, defPredicate);
      // Surviving keys round-trip in Record fields
      for (const k of survivingKeys) {
        expect(loaded.colsSize[k]).toBe(100);
        expect(loaded.colsCalc[k]).toBe("sum");
      }
      // __proto__ is NOT an own property on the result (safe)
      expect(Object.prototype.hasOwnProperty.call(loaded.colsSize, "__proto__")).toBe(false);
      // String arrays carry all keys including __proto__ (they're just strings)
      expect(loaded.colsHidden).toEqual(dangerousKeys);
      expect(loaded.colsOrder).toEqual(dangerousKeys);
      // The object is not corrupted — prototype is still Object.prototype
      expect(Object.getPrototypeOf(loaded.colsSize)).toBe(Object.prototype);
    });

    it("deeply nested chart config survives", () => {
      const chart: ChartPredicate = {
        visible: true,
        groupKey: "你好",
        aggregate: "sum",
        valueKey: "😀",
      };
      const stored = saveCycle({}, { chart }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.chart).toEqual(chart);
    });

    it("deeply nested subItems config survives", () => {
      const subItems: SubItemsPredicate = {
        field: "Parent",
        display: "flattened",
        filterScope: "parents",
        collapsed: ["path/to/row1", "path/to/row2", "你好/行"],
      };
      const stored = saveCycle({}, { subItems }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.subItems).toEqual(subItems);
    });

    it("subItems with only required field (minimal) survives", () => {
      const subItems: SubItemsPredicate = { field: "ParentLink" };
      const stored = saveCycle({}, { subItems }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.subItems).toBeDefined();
      expect(loaded.subItems!.field).toBe("ParentLink");
    });

    it("tableDirection 'rtl' survives", () => {
      const stored = saveCycle({}, { tableDirection: "rtl" }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.tableDirection).toBe("rtl");
    });

    it("tableDirection 'ltr' survives", () => {
      const stored = saveCycle({}, { tableDirection: "ltr" }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.tableDirection).toBe("ltr");
    });

    it("filter with empty string value survives", () => {
      const filter: Filter = { field: "Col", fn: "isEmpty", value: "", fType: "text" };
      const stored = saveCycle({}, { filters: [filter] }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.filters).toHaveLength(1);
      expect(loaded.filters[0].value).toBe("");
    });

    it("colsHeaderDisplay with all four modes survives (minus adaptive fallback)", () => {
      const display: Record<string, ColumnHeaderDisplayMode> = {
        a: "adaptive",
        b: "full",
        c: "text",
        d: "icon",
      };
      const stored = saveCycle({}, { colsHeaderDisplay: display }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      // All four modes are valid and pass propertyHeaderDisplayModeForValue
      expect(loaded.colsHeaderDisplay).toEqual(display);
    });

    it("colsDataAnchor with all three modes survives", () => {
      const anchors: Record<string, ColumnDataAnchor> = {
        a: "left",
        b: "center",
        c: "right",
      };
      const stored = saveCycle({}, { colsDataAnchor: anchors }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.colsDataAnchor).toEqual(anchors);
    });

    it("colsWrap with 'wrap' mode survives (clip is dropped as default)", () => {
      const wraps: Record<string, ColumnWrapMode> = {
        Name: "wrap",
        Count: "clip",
      };
      const stored = saveCycle({}, { colsWrap: wraps }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      // "clip" is the default and is dropped during validation, only "wrap" persists
      expect(loaded.colsWrap).toEqual({ Name: "wrap" });
    });

    it("groupOrder and collapsedGroups with valid data survive", () => {
      const groupOrder: Record<string, string[]> = {
        Status: ["Open", "Closed", "Pending"],
        Priority: ["High", "Low"],
      };
      const collapsedGroups: Record<string, string[]> = {
        Status: ["Closed"],
      };
      const stored = saveCycle(
        {},
        { groupOrder, collapsedGroups },
        defPredicate
      );
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.groupOrder).toEqual(groupOrder);
      expect(loaded.collapsedGroups).toEqual(collapsedGroups);
    });

    it("maximum frozenColumnCount (10) survives", () => {
      const stored = saveCycle({}, { frozenColumnCount: 10 }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.frozenColumnCount).toBe(10);
    });

    it("large limit value survives", () => {
      const stored = saveCycle({}, { limit: 99999 }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.limit).toBe(99999);
    });

    it("multiple filters and sorts with all recognized fn types survive", () => {
      const filters: Filter[] = KNOWN_FILTER_FNS.map((fn) => ({
        field: "Col",
        fn,
        value: "test",
        fType: "text",
      }));
      const sort: Sort[] = KNOWN_SORT_FNS.map((fn) => ({
        field: "Col",
        fn,
      }));
      const stored = saveCycle({}, { filters, sort }, defPredicate);
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.filters).toHaveLength(KNOWN_FILTER_FNS.length);
      expect(loaded.sort).toHaveLength(KNOWN_SORT_FNS.length);
      // Each fn round-trips
      for (let i = 0; i < KNOWN_FILTER_FNS.length; i++) {
        expect(loaded.filters[i].fn).toBe(KNOWN_FILTER_FNS[i]);
      }
      for (let i = 0; i < KNOWN_SORT_FNS.length; i++) {
        expect(loaded.sort[i].fn).toBe(KNOWN_SORT_FNS[i]);
      }
    });

    it("listViewProps/listItemProps/listGroupProps with nested objects survive", () => {
      const props = { nested: { deep: { value: 42 } }, arr: [1, 2, 3] };
      const stored = saveCycle(
        {},
        {
          listViewProps: props,
          listItemProps: props,
          listGroupProps: props,
        },
        defPredicate
      );
      const loaded = loadCycle(stored, defPredicate);
      expect(loaded.listViewProps).toEqual(props);
      expect(loaded.listItemProps).toEqual(props);
      expect(loaded.listGroupProps).toEqual(props);
    });

    it("a fully-loaded predicate with all optional fields survives intact", () => {
      const fullPredicate: Predicate = {
        view: "table",
        listView: "custom-list-view",
        listItem: "custom-list-item",
        listGroup: "custom-list-group",
        listViewProps: { showHeader: true },
        listItemProps: { compact: false },
        listGroupProps: { collapsible: true },
        filters: [
          { field: "Status", fn: "is", value: "Done", fType: "text" },
          { field: "Count", fn: "isGreatThan", value: "5", fType: "number" },
        ],
        sort: [
          { field: "Name", fn: "alphabetical" },
          { field: "Date", fn: "latest" },
        ],
        groupBy: ["Status", "Priority"],
        groupOrder: { Status: ["Done", "Todo", "In Progress"] },
        collapsedGroups: { Status: ["Done"] },
        colsOrder: ["Name", "Status", "Count", "Date"],
        colsHidden: ["Internal", "Secret"],
        colsSize: { Name: 250, Status: 120, Count: 80 },
        colsCalc: { Count: "sum", Status: "count" },
        colsHeaderDisplay: { Name: "full", Status: "icon" },
        colsDataAnchor: { Count: "right", Name: "left" },
        colsWrap: { Name: "wrap" },
        tableDirection: "ltr",
        frozenColumnCount: 2,
        limit: 50,
        chart: {
          visible: true,
          groupKey: "Status",
          aggregate: "count",
          valueKey: "Count",
        },
        subItems: {
          field: "Parent",
          display: "flattened",
          filterScope: "subItems",
          collapsed: ["row/a", "row/b"],
        },
      };

      const stored = saveCycle({}, fullPredicate, defPredicate);
      const loaded = loadCycle(stored, defPredicate);

      // Deep equality for the full predicate
      expect(loaded.view).toBe(fullPredicate.view);
      expect(loaded.filters).toEqual(fullPredicate.filters);
      expect(loaded.sort).toEqual(fullPredicate.sort);
      expect(loaded.groupBy).toEqual(fullPredicate.groupBy);
      expect(loaded.groupOrder).toEqual(fullPredicate.groupOrder);
      expect(loaded.collapsedGroups).toEqual(fullPredicate.collapsedGroups);
      expect(loaded.colsOrder).toEqual(fullPredicate.colsOrder);
      expect(loaded.colsHidden).toEqual(fullPredicate.colsHidden);
      expect(loaded.colsSize).toEqual(fullPredicate.colsSize);
      expect(loaded.colsCalc).toEqual(fullPredicate.colsCalc);
      expect(loaded.colsHeaderDisplay).toEqual(fullPredicate.colsHeaderDisplay);
      expect(loaded.colsDataAnchor).toEqual(fullPredicate.colsDataAnchor);
      expect(loaded.colsWrap).toEqual(fullPredicate.colsWrap);
      expect(loaded.tableDirection).toBe(fullPredicate.tableDirection);
      expect(loaded.frozenColumnCount).toBe(fullPredicate.frozenColumnCount);
      expect(loaded.limit).toBe(fullPredicate.limit);
      expect(loaded.chart).toEqual(fullPredicate.chart);
      expect(loaded.subItems).toEqual(fullPredicate.subItems);

      // Byte-identity
      const stored2 = JSON.stringify(validatePredicate(loaded, defPredicate));
      expect(stored2).toBe(stored);
    });
  });
});
