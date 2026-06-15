import { parseFlexValue } from "core/schemas/parseFieldValue";
import { formatDate, parseDate } from "core/utils/date";
import { median } from "mathjs";
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
        fn: (v) => {
            const filtered = v.map(f => parseFloat(f)).filter((f) => !isNaN(f));
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
        fn: (v) => Math.min(...v.map(f => parseFloat(f)).filter(f => !isNaN(f))),
        valueType: "number",
    },
    max: {
        type: "number",
        fn: (v) => Math.max(...v.map(f => parseFloat(f)).filter(f => !isNaN(f))),
        valueType: "number",
    },
    range: {
        type: "number",
        fn: (v) => Math.max(...v.map(f => parseFloat(f)).filter(f => !isNaN(f))) - Math.min(...v.filter(f => !isNaN(f))),
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
        fn: (v) => new Date(Math.min(...v.map((f) => f.getTime()))),
        valueType: "date",
    },
    latest: {
        type: "date",
        fn: (v) => new Date(Math.max(...v.map((f) => f.getTime()))),
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
        fn: (v) => {
            const dates = v.map((f) => f.getTime());
            return Math.max(...dates) - Math.min(...dates);
        },
        valueType: "duration",
    }
};
