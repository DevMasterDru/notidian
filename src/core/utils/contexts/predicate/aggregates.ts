import { parseFlexValue } from "core/schemas/parseFieldValue";
import { formatDate, isValidDate, parseDate } from "core/utils/date";
function median(arr: number[]): number {
    if (arr.length === 0) throw new Error("Cannot calculate median of an empty array");
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
import { SpaceProperty } from "shared/types/mdb";
import { MakeMDSettings } from "shared/types/settings";
import { uniq } from "shared/utils/array";
import { safelyParseJSON } from "shared/utils/json";
import { parseProperty } from "utils/parsers";
import { empty } from "./filter";

export type AggregateFunctionType = {
    type: string;
    fn: (v: any[], type: string) => any;
    valueType: string;
};

/**
 * Decompose a non-negative millisecond span into a `{ values: { days, hours,
 * minutes, seconds } }` object — the exact shape parseProperty's `duration`
 * branch consumes (it renders each unit whose count > 0 as "<count> <unit>",
 * joined by ", "). This is the bridge between dateRange's numeric (ms) fn result
 * and its declared `valueType: "duration"`: without it, parseProperty does
 * `Object.keys(value.values)` on a raw number, throws, is caught, and the footer
 * renders blank (Notidian-i9f / DEFECT D3).
 *
 * Non-finite or negative input (e.g. dateRange of [] -> -Infinity) yields all
 * zero counts, so the duration branch renders an empty footer rather than
 * leaking a math identity — the sensible "no span" rendering.
 */
export const msToDurationValue = (ms: number): { values: Record<string, number> } => {
    const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
    const seconds = Math.floor(safe / 1000) % 60;
    const minutes = Math.floor(safe / (1000 * 60)) % 60;
    const hours = Math.floor(safe / (1000 * 60 * 60)) % 24;
    const days = Math.floor(safe / (1000 * 60 * 60 * 24));
    return { values: { days, hours, minutes, seconds } };
};

/**
 * Collapse an aggregate input set to the usable, finite, real-Date subset —
 * ONCE — so the date-family fns (earliest/latest/dateRange) can apply a clean
 * empty contract WITHOUT throwing on a non-Date element. Mirrors the proven
 * `toFiniteDates` type-gate in formulas.ts (Notidian-l6ha): it gates by TYPE
 * BEFORE coercion, accepting only real Dates, finite epoch-millis numbers, and
 * non-empty parseable date-strings.
 *
 * Why this is the direct-call hardening this bead (Notidian-h8mc) is about: the
 * legacy bodies did `v.map(f => f.getTime())` and `new Date(Math.min/Math.max
 * (...))`, so a non-Date element THREW "f.getTime is not a function" and an
 * empty set produced an Invalid Date / -Infinity span. The normal
 * calculateAggregate pipeline masked the throw by pre-mapping every value via
 * `new Date(v)` (the `type == 'date'` branch), but the pure fns were NOT
 * direct-call-safe — unlike their D1/D4-hardened numeric siblings
 * (range/min/max/avg). This is the exact defect class already fixed for those.
 *
 * The type-gate is load-bearing: `new Date(null)`/`new Date(false)` coerce to
 * epoch 0 and `new Date(true)` to epoch 1 — JS would silently turn a null/boolean
 * cell into a "valid" 1970 date and poison the min/max — so those are excluded
 * BEFORE the Date constructor, not after. `isValidDate`/`Number.isFinite` then
 * drop Invalid Dates and non-finite epochs (e.g. `new Date('not a date')`).
 */
const toFiniteDateMillis = (v: any[]): number[] => {
    if (!Array.isArray(v)) return [];
    const out: number[] = [];
    for (const f of v) {
        if (f instanceof Date) {
            if (isValidDate(f)) out.push(f.getTime());
        } else if (typeof f === "number") {
            if (Number.isFinite(f)) out.push(f); // finite epoch-millis
        } else if (typeof f === "string" && f.length > 0) {
            const t = new Date(f).getTime(); // parseable date-string -> millis
            if (Number.isFinite(t)) out.push(t);
        }
        // null / undefined / boolean / object / '' -> no usable date (skip, not throw)
    }
    return out;
};

export const calculateAggregate = (settings: MakeMDSettings, values: any[], fn: string, col: SpaceProperty) => {
    const aggregateFn = aggregateFnTypes[fn];
    if (!aggregateFn) {
        return null;
    }
    if (col.type == 'flex') {
        values = values.map((v) => {
            const parsed = parseFlexValue(v);
            return parsed.value;
        });
    }
    const type = aggregateFn.type;
    // `result` holds an intermediate value (string, number, or — for the
    // 'duration' valueType — a { values } object) that the parseProperty
    // post-pass below normalizes to its final rendered string. Typed `any` to
    // match the existing `calcResult ?? ''` fallthrough branch.
    let result: any = '';
    try {
        
        if (type == 'number') {
            values = values.map((v) => parseFloat(v));
        }
        if (type == 'date') {
            values = values.map((v) => new Date(v));
        }
        const calcResult = aggregateFn.fn(values, col.type);
        if (aggregateFn.valueType == 'date') {
            const format = safelyParseJSON(col.value)?.format
            result = formatDate(settings, parseDate(calcResult), format);
        } else if (aggregateFn.valueType == 'number') {
            result = calcResult.toString();
        } else if (aggregateFn.valueType == 'duration') {
            // calcResult is a numeric ms span (dateRange). Shape it into the
            // { values: {...} } object parseProperty's duration branch expects,
            // paralleling the 'date' branch above. (Notidian-i9f / DEFECT D3.)
            result = msToDurationValue(calcResult);
        } else {
            result = calcResult ?? '';
        }
        // The parseProperty post-pass normalizes structured intermediates (date,
        // number, duration, link/option/etc.) to their final rendered string.
        // But parseProperty has NO switch case for the 'none' or 'string'
        // valueTypes (values, empty, notEmpty, percentageEmpty,
        // percentageNotEmpty, percentageComplete): it falls through and returns
        // '', silently BLANKING footers whose fn ALREADY produced the final
        // value (e.g. '67%', 'a, b', or a raw count). Skip the post-pass for
        // those valueTypes and pass `result` through unchanged — the fns own the
        // final form. (Notidian-wis / DEFECT D2.) Preferred over adding identity
        // cases to the shared parsers.ts (smaller blast radius). The typeof
        // guard below still coerces a non-string `result` (the 'none' counts —
        // empty/notEmpty — return numbers) to a stringified footer.
        if (aggregateFn.valueType != 'none' && aggregateFn.valueType != 'string') {
            result = parseProperty("", result, aggregateFn.valueType)
        }
        if (typeof result != "string") {
            result = result == null ? '' : String(result)
		}
    } catch (e) {
        result = '';
        console.error(e);
    }

    return result

}

export const aggregateFnTypes: Record<string, AggregateFunctionType> = {
    values: {
        type: 'any',
        fn: (v) => uniq(v.map(f => parseProperty("", f))).join(", "),
        valueType: "none",
    },
    sum: {
        type: "number",
        fn: (v) => v.map(f => parseFloat(f)).filter(f => !isNaN(f)).reduce((a, b) => b ? a + b : a, 0),
        valueType: "number",
    },
    avg: {
        type: "number",
        // Empty / all-non-numeric set -> 0/0 -> NaN -> "NaN" footer: floor to ''
        // (Notion-parity blank, matching the percentage family + median's
        // caught-throw '' — Notidian-lac / DEFECT D4). The number valueType
        // post-pass parseProperty('', '', 'number') keeps '' blank, so nothing
        // downstream resurrects the NaN.
        fn: (v) => {
            const filtered = v.map(f => parseFloat(f)).filter((f) => !isNaN(f));
            if (filtered.length == 0) return '';
            return filtered.reduce((a, b) => a + b, 0) / filtered.length
        },
        valueType: "number",
    },
    median: {
        type: "number",
        fn: (v) => {
            const filtered = v.map(f => parseFloat(f)).filter((f) => !isNaN(f));
            return median(filtered)
        },
        valueType: "number",
    },
    count: {
        type: 'any',
        fn: (v) => v.length,
        valueType: "number",
    },
    countValues: {
        type: 'any',
        fn: (v) => v.flat().length,
        valueType: "number",
    },
    countUniques: {
        type: 'any',
        fn: (v) => new Set(v.flat()).size,
        valueType: "number",
    },
    percentageEmpty: {
        type: 'any',
        // Empty column -> #/0 -> NaN -> "NaN%": floor to '' (Notion shows blank,
        // and the parseProperty post-pass is skipped for valueType 'string', so
        // nothing downstream blanks it — Notidian-wis / DEFECT D4). Parallels the
        // msToDurationValue non-finite flooring for dateRange.
        fn: (v) => v.length == 0 ? '' : Math.round(v.filter((f) => empty(f, '')).length / v.length * 100) + "%",
        valueType: "string",
    },
    percentageNotEmpty: {
        type: 'any',
        fn: (v) => v.length == 0 ? '' : Math.round(v.filter((f) => !empty(f, '')).length / v.length * 100) + "%",
        valueType: "string",
    },
    min: {
        type: "number",
        // Empty / all-non-numeric set -> Math.min() = +Infinity -> "Infinity"
        // footer: floor to '' (Notion-parity blank — Notidian-lac / DEFECT D4),
        // paralleling avg/range and the percentage family.
        fn: (v) => {
            const nums = v.map(f => parseFloat(f)).filter(f => !isNaN(f));
            if (nums.length == 0) return '';
            return Math.min(...nums);
        },
        valueType: "number",
    },
    max: {
        type: "number",
        // Empty / all-non-numeric set -> Math.max() = -Infinity -> "-Infinity"
        // footer: floor to '' (Notion-parity blank — Notidian-lac / DEFECT D4).
        fn: (v) => {
            const nums = v.map(f => parseFloat(f)).filter(f => !isNaN(f));
            if (nums.length == 0) return '';
            return Math.max(...nums);
        },
        valueType: "number",
    },
    range: {
        type: "number",
        // Both extremes MUST be computed over the SAME numeric set. Previously the
        // max side mapped values with parseFloat before filtering NaN, but the min
        // side filtered RAW values with isNaN (no parseFloat map), so a string that
        // parseFloat's to a number yet is NaN under raw isNaN (e.g. '2x' -> 2,
        // '10px' -> 10) was kept in the max set but DROPPED from the min set —
        // giving max and min DIVERGENT value sets and a wrong range whenever such a
        // value is the minimum (e.g. ['2x','5','9'] wrongly yielded 9-5=4 instead
        // of 9-2=7). Masked in the normal calculateAggregate pipeline only because
        // number cols are pre-mapped to real numbers, but wrong when range.fn is
        // called directly. Share one parseFloat-mapped set for both extremes.
        // (Notidian-7yh / DEFECT D1.)
        fn: (v) => {
            const nums = v.map(f => parseFloat(f)).filter(f => !isNaN(f));
            // Empty / all-non-numeric set -> (-Infinity)-(Infinity) = -Infinity ->
            // "-Infinity" footer: floor to '' (Notion-parity blank — Notidian-lac /
            // DEFECT D4), paralleling avg/min/max and the percentage family.
            if (nums.length == 0) return '';
            return Math.max(...nums) - Math.min(...nums);
        },
        valueType: "number",
    },
    empty: {
        type: 'any',
        fn: (v) => v.filter((f) => empty(f, '')).length,
        valueType: "none",
    },
    notEmpty: {
        type: 'any',
        fn: (v) => v.filter((f) => !empty(f, '')).length,
        valueType: "none",
    },
    earliest: {
        type: "date",
        // Direct-call-safe + empty-floored (Notidian-h8mc). Legacy
        // `new Date(Math.min(...v.map(f => f.getTime())))` THREW on a non-Date
        // element and returned Invalid Date on []. Coerce/filter to the finite
        // real-Date subset ONCE (toFiniteDateMillis), then floor the empty /
        // all-invalid set to '' (Notion-parity blank — matching the numeric
        // siblings' D4 contract and formulas.ts's earliest empty-sentinel). For
        // valueType 'date' the '' flows through formatDate(settings,
        // parseDate('')=null, ...) -> caught -> '' end-to-end, so the pipeline
        // (which pre-maps via new Date(v)) is unchanged for all-valid input and
        // still renders '' for []. The MIXED valid+empty/invalid case DOES change,
        // though: the legacy getTime() spread let an Invalid Date's NaN poison
        // Math.min -> blank, while toFiniteDateMillis now drops invalids and
        // returns the extreme of the valid subset (a Notion-parity improvement —
        // see the dateRange note + the Layer-2 'BEHAVIOR CHANGE' test). Returns
        // the min Date for a non-empty usable set.
        fn: (v) => {
            const ts = toFiniteDateMillis(v);
            if (ts.length == 0) return '';
            return new Date(Math.min(...ts));
        },
        valueType: "date",
    },
    latest: {
        type: "date",
        // Mirror of earliest (Notidian-h8mc): direct-call-safe over non-Date
        // elements, empty / all-invalid set floored to '' (was Invalid Date).
        fn: (v) => {
            const ts = toFiniteDateMillis(v);
            if (ts.length == 0) return '';
            return new Date(Math.max(...ts));
        },
        valueType: "date",
    },
    complete: {
        type: 'boolean',
        fn: (v) => v.filter((f) => f == 'true').length,
        valueType: "number",
    },
    incomplete: {
        type: 'boolean',
        fn: (v) => v.filter((f) => f != 'true').length,
        valueType: "number",
    },
    percentageComplete: {
        type: 'boolean',
        // Empty column -> #/0 -> NaN -> "NaN%": floor to '' (parity-correct, blank).
        fn: (v) => v.length == 0 ? '' : Math.round(v.filter((f) => f == 'true').length / v.length * 100) + "%",
        valueType: "string",
    },
    dateRange: {
        type: "date",
        // Direct-call-safe + empty-floored (Notidian-h8mc). Legacy
        // `v.map(f => f.getTime())` THREW on a non-Date element and gave
        // (-Infinity) - (Infinity) = -Infinity on []. Coerce/filter to the finite
        // real-Date subset ONCE, then return 0 (a zero ms span) for the empty /
        // all-invalid set. valueType is 'duration': calculateAggregate post-passes
        // the ms span through msToDurationValue, which floors 0 (and any
        // non-finite/negative input) to all-zero units -> '' — so the EMPTY-set
        // footer stays blank (unchanged). 0 is preferred over the legacy -Infinity
        // (cleaner, never leaks a math identity if the fn is read directly).
        // NOTE: the MIXED valid+empty/invalid case IS a user-visible change — the
        // legacy `f.getTime()` spread let an Invalid Date's NaN poison Math.max/min
        // -> NaN span -> blank footer, whereas toFiniteDateMillis now spans the
        // valid subset (e.g. ["2020-05-10","","2020-12-31"] -> "235 days", was
        // blank). This is a Notion-parity improvement (Notion ignores empty rows),
        // pinned by the Layer-2 'BEHAVIOR CHANGE: mixed valid+empty/garbage' test.
        // Returns the ms span over the valid subset otherwise.
        fn: (v) => {
            const ts = toFiniteDateMillis(v);
            if (ts.length == 0) return 0;
            return Math.max(...ts) - Math.min(...ts);
        },
        valueType: "duration",
    }
};
