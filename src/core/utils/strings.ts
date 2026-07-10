import { Superstate } from "makemd-core";
import { safelyParseJSON } from "shared/utils/json";

export const defaultString = (value: any, string: string) => {
  if (!value || value.length == 0) return string;
  return value;
}

export function ensureArray(value: unknown): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

export function ensureStringValueFromSet(value: unknown, values: string[], defaultValue: string) : string {
  const _v = ensureString(value)
  return values.some(f => f == _v) ? _v : defaultValue
}

export function ensureString(value: unknown): string {
  if (!value) return ""
  if (typeof value !== 'string') {
    const newValue = value.toString();
    if (typeof newValue === 'string') {
      return newValue;
    }
    return '';
  }
  return value;
}


export function ensureBoolean(value: unknown): boolean {
  if (!value) return false
  return true;
}

// Coerce a persisted metadata value to a finite number, or undefined when it is
// missing/blank/non-numeric. Used for OPTIONAL per-space numeric view state
// (e.g. noteBodyHeight) where "absent" must stay absent — it must NOT collapse to
// 0, which would be a meaningful (zero-height) value rather than "unset".
export function ensureNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}


export const indexOfCharElseEOS = (char: string, str: string) => {
  if (str.indexOf(char) > 0) return str.indexOf(char);
  return str.length;
};

export const spaceNameFromSpacePath = (contextPath: string, superstate: Superstate) => superstate.pathsIndex.get(contextPath)?.name ?? contextPath
export const schemaNameFromSpacePath = (contextPath: string, schemaId: string, superstate: Superstate) => superstate.contextsIndex.get(contextPath)?.schemas.find(f => f.id == schemaId)?.name ?? schemaId
export const spacePathFromName = (spaceName: string) => "spaces://"+encodeSpaceName(spaceName)
export const encodeSpaceName = (spaceName: string) => spaceName?.replace(/\//g, "+")
;export const tagSpacePathFromTag = (tag: string) =>
"spaces://"+tag


export const wrapObjectString = (s: string) => `{ ${Object.entries(safelyParseJSON(s)).map(([key, value]) => `${key}: ${value}`).join(', ')} }`
export const wrapParanthesis = (s: string) => s ? `(${s})` : null;
// wrapQuotes / removeQuotes are a MATCHED encode/decode pair (Notidian-shrl,
// Notidian-qp1k). To be INJECTIVE, wrapQuotes escapes BACKSLASH FIRST so a value
// literally containing the two chars backslash+n encodes DISTINCTLY from a value
// containing a real newline — otherwise the two share a preimage on decode:
//   literal "\n"  (backslash + n)  -> encodes as  "\\n"  (escaped backslash + n)
//   real newline                   -> encodes as  "\n"   (backslash + n)
// Ordering is load-bearing: escape `\` -> `\\` BEFORE escaping `"` -> `\"` and
// the real newline -> `\n`; escaping backslash last would re-escape the
// backslashes those two later steps introduce and re-open the ambiguity.
export const wrapQuotes = (s: string) => s ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : null
export const unwrapParanthesis = (s: string) => {
  if (!s) return s;
  if (s.startsWith("(")) {
    if (s.endsWith(")")) {
      return s.substring(1, s.length - 1);
    } else if (s.endsWith(");")) {
      return s.substring(1, s.length - 2);
    }
  }
  return s;
}
// Reverse wrapQuotes' escapes in a SINGLE left-to-right pass (Notidian-qp1k):
// each backslash consumes the FOLLOWING char as a unit, so an escaped backslash
// can never combine with a trailing `n` into a spurious newline. A naive
// sequential `.replace(/\\\\/…).replace(/\\n/…)` DOUBLE-unescapes — on the
// encoded "\\n" the first replace turns `\\` into `\`, then the second replace
// sees the surviving `\n` and wrongly emits a newline, collapsing the distinct
// literal-backslash-n and real-newline preimages back together.
// Recognised escapes: \\ -> \ , \" -> " , \n -> real newline. Any other \X is
// left verbatim, matching the pre-qp1k decode which only touched \" and \n.
//
// COMPAT (bounded, Notidian-qp1k — documented, NOT migrated): frame payloads
// serialized BEFORE this fix stored backslashes UNescaped (old wrapQuotes never
// escaped `\`). For such legacy data a literal "\\" (e.g. a Windows UNC path
// "\\server") now decodes one backslash shorter, and a legacy "\n" still
// decodes to a newline. There is no clean old/new discriminator and
// backslash-bearing frame text is rare, so this one-time edge is accepted (a
// dedicated test pins it) rather than carried by a data migration.
const decodeWrapEscapes = (str: string): string =>
  str.replace(/\\([\s\S])/g, (_m, c) =>
    c === "n" ? "\n" : c === '"' ? '"' : c === "\\" ? "\\" : "\\" + c
  );

export const removeQuotes = (s: string): string => {
  if (!s) return s;
  if (typeof s === 'number') return (s as number).toString();
  const singleQuoteWithSemicolon = s.startsWith("'") && (s.endsWith("';") || s.endsWith("'"));
  const doubleQuoteWithSemicolon = s.startsWith('"') && (s.endsWith('";') || s.endsWith('"'));

  if (singleQuoteWithSemicolon || doubleQuoteWithSemicolon) {
      // Did the ORIGINAL wrapped string carry a trailing ';'? This decides the
      // second strip below. substring(1, len-1) drops the opening quote and the
      // LAST char: that last char is the ';' when a semicolon was present
      // (leaving the closing quote still attached, to be stripped next), but is
      // the closing quote itself when there was NO semicolon (already removed —
      // so a second strip must NOT fire). The old code re-inspected the stripped
      // content instead ("does it still end in a quote?"), which conflated an
      // escaped closing quote — e.g. wrapQuotes('say "hi"') === `"say \"hi\""` —
      // with the semicolon case and ate a real character on round-trip.
      const hadSemicolon = s.endsWith(";");
      // Remove the quotes
      s = s.substring(1, s.length - 1);
      // If there was a trailing semicolon, its preceding closing quote is still
      // attached — strip it too. Guarded on hadSemicolon so it fires ONLY for a
      // genuine trailing ';', never for content that merely ends in a quote char.
      if (hadSemicolon && (s.endsWith('"') || s.endsWith("'"))) {
          s = s.substring(0, s.length - 1);
      }
      // Reverse ALL of wrapQuotes' escapes in one pass (\\ -> \, \" -> ", \n ->
      // real newline) so removeQuotes is a true inverse over the FULL domain,
      // including a value that literally contains backslash+n.
      return decodeWrapEscapes(s);
  } else {
      return decodeWrapEscapes(s);
  }
}

export const initiateString = (s: string, defaultString: string) => !s || s.length == 0 ? defaultString : s

export const removeLeadingSlash = (path: string) =>
  path.charAt(0) == "/" ? path.substring(1) : path;
export const pathToParentPath = (path: string) =>
  removeLeadingSlash(path.substring(0, path.lastIndexOf("/"))) ||
  path;



  
