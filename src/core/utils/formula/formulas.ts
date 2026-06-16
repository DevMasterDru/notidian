import { format as formatDate } from "date-fns";
import { MathNode, SymbolNode } from "mathjs";
import { PathState } from "shared/types/PathState";
import { uniq } from "shared/utils/array";
import { parseMultiString } from "utils/parsers";
import { parseMDBStringValue } from "utils/properties";
import { parseDate } from "../date";

const letFunction = (args: MathNode[], math: any, scope: Map<string, any>) => {
	const variable = args[0] as SymbolNode;
	if (!variable.isSymbolNode) {
		return ""
	}
	if (args.length !== 3) {
		return "";
	}
	const name = variable.name;
	const value = args[1] as MathNode;
	math.evaluate(`${name} = ${value.toString()}`, scope);
	const fnCode = args[2].compile();
	return fnCode.evaluate(scope);
}

letFunction.rawArgs = true;

const letsFunction = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length % 2 !== 1) {
		return "";
	}

	for (let i = 0; i < args.length - 1; i += 2) {
		const variable = args[i] as SymbolNode;
		if (!variable.isSymbolNode) {
			return ""
		}
		const name = variable.name;
		const value = args[i + 1] as MathNode;
		math.evaluate(`${name} = ${value.toString()}`, scope);
	}
	
	const fnCode = args[args.length - 1].compile()
	return fnCode.evaluate(scope)
}

letsFunction.rawArgs = true;

const path = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 1) {
		return "";
	}
	const res = args.map(function (arg) {
		return arg.compile().evaluate(scope)
	})
	let path = res[0];
	if (typeof res[0] != 'string' && res[0].path) {
		path = res[0].path;
	}
	const value = (scope.get("$paths") as Map<string, PathState>).get(path);
	return value;

}
path.rawArgs = true;

const spaceItems = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 1) {
		return "";
	}
	const res = args.map(function (arg) {
		return arg.compile().evaluate(scope)
	})
	let path = res[0];
	if (typeof res[0] != 'string' && res[0].path) {
		path = res[0].path;
	}
	const value = (scope.get("$items") as Map<string, Set<string>>).get(path);
	const paths = (scope.get("$paths") as Map<string, PathState>);
	const result = [...(value ?? [])].map(f => paths.get(f));
	return result;

}
spaceItems.rawArgs = true;

const spaces = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 1) {
		return "";
	}
	const res = args.map(function (arg) {
		return arg.compile().evaluate(scope)
	})
	let path = res[0];
	if (typeof res[0] != 'string' && res[0].path) {
		path = res[0].path;
	}
	const value = (scope.get("$spaces") as Map<string, Set<string>>).get(path);
	const paths = (scope.get("$paths") as Map<string, PathState>);
	const result = [...(value ?? [])].map(f => paths.get(f));
	return result;

}
spaces.rawArgs = true;

const current = (args: MathNode[], math: any, scope: Map<string, any>) => {
	return scope?.get("$current");
}
current.rawArgs = true;

const index = (args: MathNode[], math: any, scope: Map<string, any>) => {
	return scope?.get("$index");
}
index.rawArgs = true;

const find = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 2) {
		return "";
	}
	const arr = args[0].compile().evaluate
		? args[0].compile().evaluate(scope)
		: args[0];
	if (Array.isArray(arr)) 
	{
		return arr.find((f, i) => {
			scope.set("$current", f);
			scope.set("$index", i);
			math.evaluate("current = _current(); index = _index()", scope)
			const value = args[1].compile().evaluate
			? args[1].compile().evaluate(scope)
			: args[1];
			return f === value;
		}) ?? "";
	}
	return "";
}
find.rawArgs = true;

const findIndex = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 2) {
		return "";
	}
	const arr = args[0].compile().evaluate
		? args[0].compile().evaluate(scope)
		: args[0];
	if (Array.isArray(arr)) 
	{
		return arr.findIndex((f, i) => {
			scope.set("$current", f);
			scope.set("$index", i);
			math.evaluate("current = _current(); index = _index()", scope)
			const value = args[1].compile().evaluate
			? args[1].compile().evaluate(scope)
			: args[1];
			return f === value;
		});
	}
	return "";
}
findIndex.rawArgs = true;

const filter = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 2) {
		return "";
	}
	const arr = args[0].compile().evaluate
		? args[0].compile().evaluate(scope)
		: args[0];
	if (Array.isArray(arr)) {
		return arr.filter((f, i) => {
			scope.set("$current", f);
			scope.set("$index", i);
			math.evaluate("current = _current(); index = _index()", scope)
			return args[1].compile().evaluate(scope);
		});
	}
	return "";
}
filter.rawArgs = true;

const map = (args: MathNode[], math: any, scope: Map<string, any>) => {

	if (args.length !== 2) {
		return "";
	}
	const arr = args[0].compile().evaluate
		? args[0].compile().evaluate(scope)
		: args[0];

	if (Array.isArray(arr)) {
		
		return arr.map((f, i) => {
			scope.set("$current", f);
			scope.set("$index", i);
			math.evaluate("current = _current(); index = _index()", scope)
			const result = args[1].compile().evaluate(scope);
			return result;
		});
	}
	return [];
}
map.rawArgs = true;

const some = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 2) {
		return "";
	}
	const arr = args[0].compile().evaluate
		? args[0].compile().evaluate(scope)
		: args[0];
	if (Array.isArray(arr)) {
		return arr.some((f, i) => {
			scope.set("$current", f);
			scope.set("$index", i);
			math.evaluate("current = _current(); index = _index()", scope)
			return args[1].compile().evaluate(scope);
		});
	}
	return "";
}
some.rawArgs = true;

const every = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 2) {
		return "";
	}
	const arr = args[0].compile().evaluate
		? args[0].compile().evaluate(scope)
		: args[0];
	if (Array.isArray(arr)) {
		return arr.every((f, i) => {
			scope.set("$current", f);
			scope.set("$index", i);
			math.evaluate("current = _current(); index = _index()", scope)
			return args[1].compile().evaluate(scope);
		});
	}
	return "";
}
every.rawArgs = true;

const flat = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 1) {
		return "";
	}
	const arr = args[0].compile().evaluate
		? args[0].compile().evaluate(scope)
		: args[0];
	if (Array.isArray(arr)) {
		return arr.flat();
	}
	return "";
}
flat.rawArgs = true;


const prop = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length !== 1) {
		return "";
	}
	const res = args.map(function (arg) {
		return arg.compile().evaluate(scope)
	})
	

	const type = scope.get('$properties')?.[res[0]]?.type;
	let value = parseMDBStringValue(type, scope.get(res[0]));

	if (type == 'file' || type == 'link' || type == 'context') {
		if (type.includes('multi')) {
			value = parseMultiString(value).map(f => (scope.get("$paths") as Map<string, PathState>).get(f) ?? f);
		} else {

			value = (scope.get("$paths") as Map<string, PathState>).get(value) ?? value;
		}
	}
	if (type == 'date') {
		value = parseDate(value)
	}
	return value ?? "";
};
prop.rawArgs = true;
const ifs =(args: MathNode[], math: any, scope: Map<string, any>) => {
	if ((args.length - 1) % 2 !== 0) {
		return "";
	}
	for (let i = 0; i < args.length-1; i += 2) {
		if (args[i].compile().evaluate() === true) {
			return args[i + 1].compile().evaluate(scope);
		}
	}
	return args[args.length - 1].compile().evaluate(scope);
}
ifs.rawArgs = true;
const formatDateString = (args: MathNode[], math: any, scope: Map<string, any>) => {
	if (args.length < 1 || args.length > 2) {
		return "";
	}
	let date = args[0].compile().evaluate(scope);
	if (!(date instanceof Date)) {
		date = new Date(date);
	}
	const dateFormat = args[1]?.compile().evaluate(scope);
	if (dateFormat?.length > 0) {
		return formatDate(date, dateFormat);
	}
	return formatDate(date, scope.get("$settings")?.dateFormat ?? "yyyy-MM-dd");
}
formatDateString.rawArgs = true;
const format = (arg: any) =>{

	if (typeof arg === "string"|| arg instanceof String) {
		return arg;
	}
	if (arg instanceof Date) {
		return formatDate(arg, "yyyy-MM-dd");
	}
	if (typeof arg === "number") {
		return arg.toFixed(0);
	}
	if (arg?.path) {
		return arg.path;
	}
	return "";

}

// Build a RegExp from a user-authored formula string without ever throwing.
// `new RegExp("(")` (and friends) raise a SyntaxError; inside a computed cell
// that would propagate up the mathjs engine and crash the whole cell render.
// Returning null lets the callers degrade gracefully (false / null / no-op).
const safeRegExp = (pattern: string, flags?: string): RegExp | null => {
	try {
		return new RegExp(pattern, flags);
	} catch {
		return null;
	}
};

// A correct, non-NaN, TOTAL-ORDER comparator for the mixed values a computed
// `sort` column can hold. The legacy `(a, b) => b - a` only worked for numbers
// (and descending at that): on strings / dates it produced NaN, which leaves the
// array order engine-defined (effectively unsorted).
//
// Correctness requirement: Array.prototype.sort demands a strict weak ordering
// (reflexive, antisymmetric, TRANSITIVE). Classifying the comparison scheme
// per-PAIR — "numeric if BOTH are number/Date, else string" — breaks transitivity
// on mixed input, because the SAME value is treated as a number in one pair and as
// its string form in another. Counter-example (number 5, number 10, string "2"):
// cmp(5,10) = -1 (numeric), cmp(10,"2") = -1 ("10" < "2" lexically), but
// cmp(5,"2") = +1 ("5" > "2" lexically) — so 5<10 and 10<"2" yet 5>"2". V8 then
// emits an arbitrary, input-position-dependent permutation (the same multiset
// sorts differently depending on its initial order) — visible garbage in the
// computed column the owner reads.
//
// Fix (ADR-0033 / ADR-0025 precedent — per-VALUE classification into a real
// strict weak ordering): classify each value ONCE into a stable bucket
// (number/Date -> the numeric bucket, everything else -> the string bucket); a
// value's bucket no longer depends on its partner, so the relation is transitive
// by construction. Order numbers/Dates numerically within the numeric bucket and
// everything else by its `format()` string within the string bucket; order the
// buckets deterministically (numeric < string). This keeps the common homogeneous
// single-type sort (all numbers / all Dates / all strings) identical to before —
// the only behavior delta is that genuinely mixed-type arrays, which the old
// comparator scrambled incoherently, now have a defined, stable order.
const NUMERIC_BUCKET = 0;
const STRING_BUCKET = 1;
type SortKey =
	| { bucket: typeof NUMERIC_BUCKET; num: number }
	| { bucket: typeof STRING_BUCKET; str: string };
const sortKey = (v: any): SortKey => {
	if (typeof v === "number" && !Number.isNaN(v)) {
		return { bucket: NUMERIC_BUCKET, num: v };
	}
	if (v instanceof Date) {
		const t = v.getTime();
		if (!Number.isNaN(t)) return { bucket: NUMERIC_BUCKET, num: t };
		// An Invalid Date (getTime() -> NaN) has no coherent numeric position AND
		// `format()` (date-fns) THROWS on it — give it a stable sentinel string so
		// it lands in the string bucket deterministically without poisoning the
		// comparator (NaN) or crashing the cell.
		return { bucket: STRING_BUCKET, str: "￿Invalid Date" };
	}
	return { bucket: STRING_BUCKET, str: format(v) };
};
// Exported for direct strict-weak-ordering law verification in tests (a 2-element
// `sort` can short-circuit in V8 and not call the comparator, so the laws must be
// checked against the comparator itself, not inferred from sort output).
export const compareSortValues = (a: any, b: any): number => {
	const ka = sortKey(a);
	const kb = sortKey(b);
	if (ka.bucket !== kb.bucket) return ka.bucket < kb.bucket ? -1 : 1;
	if (ka.bucket === NUMERIC_BUCKET && kb.bucket === NUMERIC_BUCKET) {
		return ka.num < kb.num ? -1 : ka.num > kb.num ? 1 : 0;
	}
	const sa = (ka as { str: string }).str;
	const sb = (kb as { str: string }).str;
	return sa < sb ? -1 : sa > sb ? 1 : 0;
};

export const formulas = {
	"prop": prop,
	"_current": current,
	"_index": index,
	"slice": (str: string, start: number, end: number) => {
		str = format(str);
		return str.slice(start, end);
	},
	"if": (condition: boolean, ifTrue: any, ifFalse: any) => {
		return condition === true ? ifTrue : ifFalse;
	},
	"ifs": ifs,
	"empty": (args: string[] | string) => {
		if (!args) return true;
		if (args.length == 0) {
			return true;
		}
		return false;
	},
	"length": (arg: string | any[]) => arg.length,
	"values": (arg: any[]) => arg.flat().length,
	"uniques": (arg: any[]) => uniq(arg.flat()).length,
	"substring": (str: string, start: number, end?: number) => {
		str = format(str);
		if (!end) {
			return str.substring(start);
		}
		return str.substring(start, end);
	},
	"startsWith": (str: string, subStr: string) => {
		str = format(str);
		subStr = format(subStr);
		return str.startsWith(subStr);
	},
	"contains": (str: string, subStr: string) => {
		str = format(str);
		subStr = format(subStr);
		return str.includes(subStr);
	},
	"test": (str: string, regex: string) => {
		str = format(str);
		// A malformed user regex must not crash the computed cell — fail soft
		// to false (no match) instead of throwing a SyntaxError up the engine.
		const re = safeRegExp(regex);
		return re ? re.test(str) : false;
	},
	"match": (str: string, regex: string) => {
		str = format(str);
		// Fail soft to null (the no-match shape String.match already returns)
		// rather than throwing on an invalid pattern.
		const re = safeRegExp(regex);
		return re ? str.match(re) : null;
	},
	"replace": (str: string, search: string, replace: string) => {
		str = format(str);
		// Fail soft to the untouched input when the pattern is malformed, so a
		// bad formula degrades to a no-op instead of crashing the cell.
		const re = safeRegExp(search);
		return re ? str.replace(re, replace) : str;
	},
	"replaceAll": (str: string, search: string, replace: string) => {
		str = format(str);
		search = format(search);
		replace = format(replace);
		const re = safeRegExp(search, "g");
		return re ? str.replace(re, replace) : str;
	},
	"lower": (str: string) => {
		str = format(str);
		return str.toLowerCase();
	},
	"upper": (str: string) => {
		str = format(str);
		return str.toUpperCase();
	},
	"repeat": (str: string, times: number) => {
		return str.repeat(times);
	},
	"format": format,
	"toNumber": (arg: any) => {
		if (arg instanceof Date) {
			return arg.getTime();
		}
		if (typeof arg === "string")
			return parseFloat(arg);
		return arg
	},
	"now": () => {
		return new Date();
	},
	
	"minute": (date: Date) => {
		return date.getMinutes()
	},
	"hour": (date: Date) => {
		return date.getHours()
	},
	"day": (date: Date) => {
		return date.getDay()
	},
	"date": (date: Date) => {
		return date.getDate();
	},
	"week": (date: Date) => {
		return formatDate(date, "w");
	},
	"month": (date: Date) => {
		return date.getMonth() + 1;
	},
	"year": (date: Date) => {
		return date.getFullYear();
	},
	'pad': (str: string, length: number, char: string) => {
		return str.padStart(length, char);
	},
	"range": (arr: number[]) => {
		return Math.max(...arr) - Math.min(...arr);
	},
	"latest": (arr: Date[]) => {
		return new Date(Math.max(...arr.map(f => f.getTime())));
	},
	"earliest": (arr: Date[]) => {
		return new Date(Math.min(...arr.map(f => f.getTime())));
	},
	"dateRange": (arr: Date[], type: string) => {
		const diff = Math.abs(Math.max(...arr.map(f => f.getTime())) - Math.min(...arr.map(f => f.getTime())));
		if (type.startsWith("day")) return diff / (1000 * 60 * 60 * 24);
		if (type.startsWith("month")) return diff / (1000 * 60 * 60 * 24 * 30);
		if (type.startsWith("year")) return diff / (1000 * 60 * 60 * 24 * 365);
		if (type.startsWith("hour")) return diff / (1000 * 60 * 60);
		if (type.startsWith("minute")) return diff / (1000 * 60);
		if (type.startsWith("second")) return diff / 1000;
		if (type.startsWith("week")) return diff / (1000 * 60 * 60 * 24 * 7);
		if (type.startsWith("quarter")) return diff / (1000 * 60 * 60 * 24 * 30 * 3);
		return diff / (1000 * 60 * 60 * 24);
	},
	"dateAdd": (newDate: Date, amount: number, type: string) => {
		
		if (type.startsWith("day")) newDate.setDate(newDate.getDate() + amount);
		if (type.startsWith("month")) newDate.setMonth(newDate.getMonth() + amount);
		if (type.startsWith("year")) newDate.setFullYear(newDate.getFullYear() + amount);
		if (type.startsWith('quarter')) newDate.setMonth(newDate.getMonth() + amount * 3);
		if (type.startsWith('week')) newDate.setDate(newDate.getDate() + amount * 7);
		if (type.startsWith("hour")) newDate.setHours(newDate.getHours() + amount);
		if (type.startsWith("minute")) newDate.setMinutes(newDate.getMinutes() + amount);
		if (type.startsWith("second")) newDate.setSeconds(newDate.getSeconds() + amount);
		return newDate;
	},
	"dateSubtract": (newDate: Date, amount: number, type: string) => {
		
		if (type.startsWith("day")) newDate.setDate(newDate.getDate() - amount);
		if (type.startsWith("month")) newDate.setMonth(newDate.getMonth() - amount);
		if (type.startsWith("year")) newDate.setFullYear(newDate.getFullYear() - amount);
		if (type.startsWith('quarter')) newDate.setMonth(newDate.getMonth() - amount * 3);
		if (type.startsWith('week')) newDate.setDate(newDate.getDate() - amount * 7);
		if (type.startsWith("hour")) newDate.setHours(newDate.getHours() - amount);
		if (type.startsWith("minute")) newDate.setMinutes(newDate.getMinutes() - amount);
		if (type.startsWith("second")) newDate.setSeconds(newDate.getSeconds() - amount);
		return newDate;
	},
	"dateBetween": (current: Date, end: Date, format: string) => {
		const msPerDay = 24 * 60 * 60 * 1000;
		const msPerMonth = msPerDay * 30; // Approximation
		const msPerYear = msPerDay * 365; // Approximation
		const diffMs = Math.abs(end.getTime() - current.getTime());
		switch (format) {
			case 'days':
			return Math.round(diffMs / msPerDay);
			case 'months':
			return Math.round(diffMs / msPerMonth);
			case 'years':
			return Math.round(diffMs / msPerYear);
		case 'hours':
			return Math.round(diffMs / (60 * 60 * 1000));
		case 'minutes':
			return Math.round(diffMs / (60 * 1000));
		case 'seconds':
			return Math.round(diffMs / 1000);
		case "weeks":
			return Math.round(diffMs / (msPerDay * 7));
		case "quarters":
			return Math.round(diffMs / (msPerMonth * 3));
		default:
			return Math.round(diffMs / msPerDay);
		}	
	},
	"style": (str: string, style: string) => {
		return str;
	},
	"timeStamp": (date: Date) => {
		
		return date.getTime()
	},
	"at": (arr: any[], index: number) => {
		return arr[index];
	},
	"first": (arr: any[]) => {
		return arr[0];
	},
	"last": (arr: any[]) => {
		return arr[arr.length - 1];
	},
	"concat": (arr1: any[], arr2: any[]) => {
		return arr1.concat(arr2);
	},
	"sort": (arr: any[]) => {
		// Non-mutating (copy first) so a shared computed-input array isn't
		// reordered out from under other cells, and a genuine total-order
		// comparator (per-value bucket classification — see compareSortValues)
		// so non-numeric AND mixed-type data sorts deterministically instead of
		// NaN-poisoning or scrambling into an input-position-dependent permutation.
		return [...arr].sort(compareSortValues);
	},
	"reverse": (arr: any[]) => {
		// Non-mutating: copy before reversing so the caller's array is untouched.
		return [...arr].reverse();
	},
	"join": (arr: any[], separator: string) => {
		return arr.join(separator);
	},
	"includes": (arr: any[], value: any) => {
		return arr.includes(value);
	},
	"split": (str: string, separator: string) => {
		return str.split(separator);
	},
	"formatDate": formatDateString,
	"parseDate": (str:string) => {
		return parseDate(str);
	},
	find: find,
	findIndex: findIndex,
	filter: filter,
	map: map,
	some: some,
	every: every,
	flat: flat,
	path: path,
	let: letFunction,
	lets: letsFunction,
	spaceItems: spaceItems,
	spaces: spaces,
};
