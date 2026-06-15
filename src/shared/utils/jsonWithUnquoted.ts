/**
 * Custom JSON utilities that handle unquoted string values
 * Used primarily in the frame system where certain values need to remain unquoted
 */

/**
 * If the input is a quote-wrapped object/array literal — `"{...}"`, `'{...}'`,
 * `"[...]"`, `'[...]'` — return the inner literal text; otherwise return null.
 *
 * Canonical wrapper convention (ADR 0026, decision 1a): a wrapped frame payload
 * — single- OR double-quote wrapped — parses to the inner OBJECT/array, never to
 * the inner string. The frame action consumer (`ButtonSubmenu.parsePropValue`)
 * checks `typeof parsed === "object"` and reads `parsed.command`, so a bare
 * inner-string return is a dead end for every real caller; normalizing both
 * quote styles to the object removes a quote-dependent type ambiguity at the
 * input to the stored-text -> executable-code boundary (ADR 0018 / vke).
 *
 * Only object/array literals are unwrapped: a wrapped SCALAR like `'"hello"'`
 * stays a string (its inner content is not `{...}`/`[...]`), preserving the
 * JSON fast-path contract for primitives.
 */
function unwrapWrappedObjectLiteral(jsonString: string): string | null {
  const str = jsonString.trim();
  if (str.length < 2) return null;
  const first = str[0];
  const last = str[str.length - 1];
  const isQuoteWrapped =
    (first === '"' && last === '"') || (first === "'" && last === "'");
  if (!isQuoteWrapped) return null;

  const inner = str.slice(1, -1).trim();
  const innerIsObjectOrArray =
    (inner.startsWith('{') && inner.endsWith('}')) ||
    (inner.startsWith('[') && inner.endsWith(']'));
  if (!innerIsObjectOrArray) return null;

  // For a double-quote wrapper, the inner literal's own quotes are JSON-escaped
  // (`"{\"a\":1}"`); decode the JSON string once to recover the raw literal.
  // For a single-quote wrapper, the inner text is the raw literal already.
  if (first === '"') {
    try {
      const decoded = JSON.parse(str);
      return typeof decoded === 'string' ? decoded : null;
    } catch (e) {
      return null;
    }
  }
  return inner;
}

/**
 * Parses a JSON-like string that may contain unquoted string values
 * @param jsonString - The JSON string to parse
 * @param hardenFrameExecution - When true (settings.hardenFrameExecution, ADR
 *   0026 decision 2a), the lossy regex value-tokenizer is replaced with a
 *   brace/bracket/quote-aware tokenizer that recovers values containing embedded
 *   `,`/`}`/`]` instead of silently degrading the whole object to `{}`. When
 *   false/undefined the legacy regex behavior is byte-for-byte preserved — this
 *   path widens the set of stored strings that resolve to a runnable action
 *   payload on the frame-execution trust boundary (ADR 0018 / vke), so it rides
 *   the SAME default-OFF flag + live-verify the owner already owes for vke and
 *   adds no new runtime flag.
 * @returns An object with:
 *   - value: The parsed object
 *   - unquotedFields: Object marking which fields were unquoted strings
 */
export function parseJsonWithUnquoted(
  jsonString: string,
  hardenFrameExecution = false
): {
  value: any;
  unquotedFields: Record<string, boolean>;
} {
  if (!jsonString || typeof jsonString !== 'string') {
    return { value: null, unquotedFields: {} };
  }

  const unquotedFields: Record<string, boolean> = {};

  // ADR 0026 decision 1a: normalize a quote-wrapped object/array literal to its
  // inner literal BEFORE the JSON fast-path, so `"{...}"` and `'{...}'` both
  // deterministically parse to the inner OBJECT rather than `"{...}"` returning
  // the inner STRING via the fast-path and `'{...}'` returning the object via
  // the fallback. Scalars (`'"hello"'`) are unaffected.
  const unwrapped = unwrapWrappedObjectLiteral(jsonString);
  const effectiveString = unwrapped ?? jsonString;

  try {
    // First try standard JSON parse
    const parsed = JSON.parse(effectiveString);
    return { value: parsed, unquotedFields };
  } catch (e) {
    // If standard parse fails, handle unquoted strings
    return parseWithUnquotedStrings(effectiveString, hardenFrameExecution);
  }
}

/**
 * Rewrite a single `key: value` pair into quoted-key/quoted-value JSON, applying
 * the unquoted-field marker rules. Shared by both the legacy regex path and the
 * tolerant tokenizer (ADR 0026 2a) so they produce identical output for the same
 * key/value text — only how the pairs are SPLIT differs.
 */
function rewriteKeyValuePair(
  key: string,
  rawValue: string,
  unquotedFields: Record<string, boolean>
): string {
  // Clean up the key
  const cleanKey = key.replace(/['"]/g, '');

  // Clean up the value
  let cleanValue = rawValue.trim();

  // Check if value is already quoted
  const isQuoted = (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
                  (cleanValue.startsWith("'") && cleanValue.endsWith("'"));

  // Check if value is a number, boolean, null, or already valid JSON
  const isJsonLiteral = /^(true|false|null|\d+(\.\d+)?|\[.*\]|\{.*\})$/.test(cleanValue);

  if (!isQuoted && !isJsonLiteral) {
    // This is an unquoted string
    unquotedFields[cleanKey] = true;

    // Escape any embedded double-quotes so the value cannot break out of
    // the JSON string it is being wrapped in (defect 2: previously a value
    // like `he said "hi"` produced invalid JSON and was silently dropped).
    // This single rewrite covers both the $-/dotted expression case and the
    // ordinary bare-value case — both are wrapped identically.
    const escapedValue = cleanValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${cleanKey}": "${escapedValue}"`;
  }

  // Already quoted or a JSON literal
  if (isQuoted && cleanValue.startsWith("'")) {
    // A single-quoted value is, by this module's convention, an unquoted
    // frame string (the value was authored without JSON quotes); mark it so
    // a re-stringify can reproduce the unquoted intent (defect 3 — the
    // bare-value path above already does this).
    unquotedFields[cleanKey] = true;
    // Convert single quotes to double quotes
    cleanValue = '"' + cleanValue.slice(1, -1).replace(/"/g, '\\"') + '"';
  }

  return `"${cleanKey}": ${cleanValue}`;
}

/**
 * Tolerant, brace/bracket/quote-aware tokenizer (ADR 0026 decision 2a).
 *
 * Splits the top-level `key: value` pairs of an object-ish payload while
 * tracking nesting depth (`{}`/`[]`) and string state (`'`/`"`/backtick), so a
 * value that legitimately contains a `,`, `}`, or `]` is NO LONGER truncated at
 * the first such character (the legacy regex value class `[^,}\]]+` truncated
 * it, producing unbalanced JSON that silently degraded the whole object to
 * `{}`). Each recovered pair is rewritten by the SAME `rewriteKeyValuePair`
 * rules the regex path uses, so quoting/escaping/markers are identical — only
 * the value boundaries are correct.
 *
 * Gated ON only under hardenFrameExecution because recovering more inputs widens
 * the set of stored strings that become a runnable frame-action payload on the
 * vke trust boundary (ADR 0018). On any structural surprise it returns null so
 * the caller falls back to the legacy aggressive path rather than inventing a
 * shape — it never widens execution beyond well-formed `key: value` recovery.
 */
function tokenizeUnquotedObject(
  str: string,
  unquotedFields: Record<string, boolean>
): string | null {
  const trimmed = str.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);

  const pairs: string[] = [];
  let depth = 0;
  let stringChar: string | null = null;
  let segmentStart = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (stringChar) {
      // Inside a string literal: respect backslash escapes, close on the
      // matching quote. Embedded structural chars are inert here.
      if (ch === '\\') {
        i++; // skip the escaped char
        continue;
      }
      if (ch === stringChar) stringChar = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      stringChar = ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth++;
      continue;
    }
    if (ch === '}' || ch === ']') {
      // After stripping the outer braces, a `}`/`]` at depth 0 is a STRAY
      // literal char inside a value (e.g. `a}b`) — the very case the legacy
      // regex truncated. Treat it as part of the value (clamp at 0) rather than
      // bailing; only an unclosed OPENER (depth > 0 at the end) is malformed.
      if (depth > 0) depth--;
      continue;
    }
    if (ch === ',' && depth === 0) {
      pairs.push(body.slice(segmentStart, i));
      segmentStart = i + 1;
    }
  }

  if (stringChar !== null || depth !== 0) return null; // unterminated/unbalanced
  pairs.push(body.slice(segmentStart));

  const rewritten: string[] = [];
  for (const pair of pairs) {
    if (pair.trim() === '') continue; // tolerate a trailing comma
    // Split on the FIRST top-level colon (depth/string-aware) so a colon inside
    // a value or a nested object does not mis-split the pair.
    const colonIndex = topLevelColonIndex(pair);
    if (colonIndex === -1) return null; // not a key:value pair — bail
    const key = pair.slice(0, colonIndex).trim();
    const value = pair.slice(colonIndex + 1);
    if (key === '' || value.trim() === '') return null; // malformed — bail
    rewritten.push(rewriteKeyValuePair(key, value, unquotedFields));
  }

  return `{${rewritten.join(', ')}}`;
}

/**
 * Index of the first top-level `:` in a `key: value` segment, skipping colons
 * inside strings or nested structures. Returns -1 if none.
 */
function topLevelColonIndex(segment: string): number {
  let depth = 0;
  let stringChar: string | null = null;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (stringChar) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === stringChar) stringChar = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      stringChar = ch;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && depth > 0) depth--; // stray close = literal
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

/**
 * Helper function to parse JSON with unquoted string values
 */
function parseWithUnquotedStrings(
  jsonString: string,
  hardenFrameExecution = false
): {
  value: any;
  unquotedFields: Record<string, boolean>;
} {
  const unquotedFields: Record<string, boolean> = {};

  // Remove leading/trailing whitespace
  let str = jsonString.trim();

  // Handle wrapped quotes from frame system
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1);
  }

  // ADR 0026 decision 2a: under hardenFrameExecution, use the tolerant tokenizer
  // (correct value boundaries) instead of the lossy regex. When OFF, the legacy
  // regex path below runs byte-for-byte unchanged. The tokenizer returns null on
  // any structural surprise, in which case we fall through to the legacy regex +
  // aggressive fallback exactly as before — it never invents a shape.
  if (hardenFrameExecution) {
    const tokenizerUnquoted: Record<string, boolean> = {};
    const tokenized = tokenizeUnquotedObject(str, tokenizerUnquoted);
    if (tokenized !== null) {
      try {
        const parsed = JSON.parse(tokenized);
        return { value: parsed, unquotedFields: tokenizerUnquoted };
      } catch (e) {
        // Tokenizer produced something JSON.parse rejected — fall through to the
        // legacy path rather than degrade silently.
      }
    }
  }

  // Replace unquoted values with quoted ones and track them (legacy regex path)
  const processedStr = str.replace(
    /(\w+)\s*:\s*([^,}\]]+)/g,
    (match, key, value) => rewriteKeyValuePair(key, value, unquotedFields)
  );

  try {
    const parsed = JSON.parse(processedStr);
    return { value: parsed, unquotedFields };
  } catch (e) {
    // If still fails, try more aggressive processing
    try {
      // Handle nested objects and special cases. Track unquoted fields here too
      // and merge them with the primary pass: the aggressive fallback is the
      // path that handles the re-stringified `{"command": $abc}` form (the key
      // is already quoted, so the primary key:value regex never matched it), and
      // it must NOT discard the unquoted intent (defect 1 — previously this
      // returned `unquotedFields: {}`, so a stringify -> parse round-trip lost
      // the marker and a subsequent re-stringify would re-quote the expression).
      const aggressiveUnquoted: Record<string, boolean> = { ...unquotedFields };
      const aggressiveStr = processedStr
        .replace(/(\w+):/g, '"$1":') // Quote all keys
        .replace(/:\s*'([^']*)'/g, (_m, inner) => `: "${inner.replace(/"/g, '\\"')}"`) // single -> double quotes
        // Capture ANY quoted key (escape-aware), not just a bareword \w+ key.
        // An earlier narrowing to "(\w+)" regressed every non-word key — a
        // hyphen, dot, or space (content-type, api-key, my.key are all valid
        // JSON keys and realistic frame/command parameter names): their bare
        // $-expression/dotted values stopped being quoted, so JSON.parse threw
        // and the whole object degraded to {} (total data loss). Group 2 = key,
        // group 3 = value; the JSON-literal guard and escape logic are unchanged.
        .replace(/("((?:[^"\\]|\\.)*)"\s*:\s*)([^",\s{}[\]]+)/g, (match, prefix, key, value) => {
          // Quote unquoted values, recording the field as unquoted so the marker
          // survives the round-trip.
          if (!/^(true|false|null|\d+(\.\d+)?|\[.*\]|\{.*\})$/.test(value)) {
            aggressiveUnquoted[key] = true;
            const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return `${prefix}"${escaped}"`;
          }
          return match;
        });

      const parsed = JSON.parse(aggressiveStr);
      return { value: parsed, unquotedFields: aggressiveUnquoted };
    } catch (e2) {
      // Return empty object if all parsing fails
      console.error('Failed to parse JSON with unquoted values:', e2);
      return { value: {}, unquotedFields: {} };
    }
  }
}

/**
 * Stringifies an object to JSON, leaving specified fields unquoted
 * @param obj - The object to stringify
 * @param unquotedFields - Object marking which fields should have unquoted string values
 * @param space - Optional indentation (same as JSON.stringify)
 * @returns The stringified JSON with specified fields unquoted
 */
export function stringifyJsonWithUnquoted(
  obj: any,
  unquotedFields: Record<string, boolean> = {},
  space?: string | number
): string {
  if (obj === null || obj === undefined) {
    return 'null';
  }
  
  // First, get standard JSON string
  let jsonStr = JSON.stringify(obj, null, space);
  
  // If no unquoted fields specified, return standard JSON
  if (!unquotedFields || Object.keys(unquotedFields).length === 0) {
    return jsonStr;
  }
  
  // Process each unquoted field
  Object.entries(unquotedFields).forEach(([fieldPath, shouldUnquote]) => {
    if (!shouldUnquote) return;
    
    // Handle nested field paths (e.g., "props.value")
    const pathParts = fieldPath.split('.');
    
    if (pathParts.length === 1) {
      // Simple field
      const field = pathParts[0];
      const value = obj[field];
      
      if (typeof value === 'string') {
        // Create regex to find this field in the JSON
        // Match patterns like "field": "value" or "field":"value"
        const regex = new RegExp(
          `"${field}"\\s*:\\s*"([^"]*)"`,
          'g'
        );
        
        jsonStr = jsonStr.replace(regex, (match, capturedValue) => {
          // Check if the value looks like an expression or template
          if (capturedValue.startsWith('$') || 
              capturedValue.startsWith('`') ||
              capturedValue.includes('${')) {
            // Return unquoted
            return `"${field}": ${capturedValue}`;
          }
          // Keep quoted for regular strings
          return match;
        });
      }
    } else {
      // Nested field - more complex handling
      // For now, we'll handle the most common case of one level nesting
      if (pathParts.length === 2) {
        const [parent, child] = pathParts;
        const parentValue = obj[parent];
        
        if (parentValue && typeof parentValue === 'object') {
          const childValue = parentValue[child];
          
          if (typeof childValue === 'string') {
            // Find and replace nested field
            // This is more complex and needs careful regex
            const regex = new RegExp(
              `("${parent}"\\s*:\\s*\\{[^}]*"${child}"\\s*:\\s*)"([^"]*)"`,
              'g'
            );
            
            jsonStr = jsonStr.replace(regex, (match, prefix, value) => {
              if (value.startsWith('$') || 
                  value.startsWith('`') ||
                  value.includes('${')) {
                return prefix + value;
              }
              return match;
            });
          }
        }
      }
    }
  });
  
  return jsonStr;
}

/**
 * Deep merge unquoted field markers
 * Useful when combining multiple unquoted field objects
 */
export function mergeUnquotedFields(
  ...fieldObjects: Record<string, boolean>[]
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  
  fieldObjects.forEach(fieldObj => {
    if (fieldObj) {
      Object.entries(fieldObj).forEach(([key, value]) => {
        if (value) {
          result[key] = true;
        }
      });
    }
  });
  
  return result;
}

/**
 * Extract unquoted fields from a frame node's props
 * Identifies which props contain template expressions or references
 */
export function detectUnquotedFields(obj: any, path: string = ''): Record<string, boolean> {
  const unquotedFields: Record<string, boolean> = {};
  
  if (!obj || typeof obj !== 'object') {
    return unquotedFields;
  }
  
  Object.entries(obj).forEach(([key, value]) => {
    const currentPath = path ? `${path}.${key}` : key;
    
    if (typeof value === 'string') {
      // Check if the string looks like it should be unquoted
      if (value.startsWith('$') ||        // Variable reference
          value.startsWith('`') ||         // Template literal
          value.includes('${') ||          // Template expression
          /^\w+\.\w+/.test(value) ||      // Property access
          /^\w+\(/.test(value)) {         // Function call
        unquotedFields[currentPath] = true;
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recursively check nested objects
      const nestedUnquoted = detectUnquotedFields(value, currentPath);
      Object.assign(unquotedFields, nestedUnquoted);
    }
  });
  
  return unquotedFields;
}

/**
 * Utility to wrap a value in quotes for frame system
 */
export function wrapQuotes(value: string): string {
  if (!value) return "''";
  
  // Check if already wrapped
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('`') && value.endsWith('`'))) {
    return value;
  }
  
  // Use single quotes by default
  // Escape any single quotes in the value
  const escaped = value.replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * Utility to unwrap quotes from a value
 */
export function unwrapQuotes(value: string): string {
  if (!value) return '';

  // Single-quote wrapped: reverse wrapQuotes' line-281 escaping so the two are
  // true inverses (defect 4: previously `slice(1, -1)` left the `\'` escape
  // backslash, so unwrapQuotes(wrapQuotes("it's")) was "it\\'s", not "it's").
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'");
  }

  // Double-quote / backtick wrapped: strip the outer pair as before.
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('`') && value.endsWith('`'))) {
    return value.slice(1, -1);
  }

  return value;
}