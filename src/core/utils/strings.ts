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
export const wrapQuotes = (s: string) => s ? `"${s.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : null
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
      // Reverse BOTH of wrapQuotes' escapes: \" -> " and the literal two-char
      // sequence \n -> a real newline, so removeQuotes is a true inverse.
      return s.replace(/\\"/g, '"').replace(/\\n/g, "\n")
  } else {
      return s.replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
}

export const initiateString = (s: string, defaultString: string) => !s || s.length == 0 ? defaultString : s

export const removeLeadingSlash = (path: string) =>
  path.charAt(0) == "/" ? path.substring(1) : path;
export const pathToParentPath = (path: string) =>
  removeLeadingSlash(path.substring(0, path.lastIndexOf("/"))) ||
  path;



  
