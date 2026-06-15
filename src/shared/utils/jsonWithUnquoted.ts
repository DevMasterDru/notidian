/**
 * Custom JSON utilities that handle unquoted string values
 * Used primarily in the frame system where certain values need to remain unquoted
 */

/**
 * Parses a JSON-like string that may contain unquoted string values
 * @param jsonString - The JSON string to parse
 * @returns An object with:
 *   - value: The parsed object
 *   - unquotedFields: Object marking which fields were unquoted strings
 */
export function parseJsonWithUnquoted(jsonString: string): {
  value: any;
  unquotedFields: Record<string, boolean>;
} {
  if (!jsonString || typeof jsonString !== 'string') {
    return { value: null, unquotedFields: {} };
  }

  const unquotedFields: Record<string, boolean> = {};
  
  try {
    // First try standard JSON parse
    const parsed = JSON.parse(jsonString);
    return { value: parsed, unquotedFields };
  } catch (e) {
    // If standard parse fails, handle unquoted strings
    return parseWithUnquotedStrings(jsonString);
  }
}

/**
 * Helper function to parse JSON with unquoted string values
 */
function parseWithUnquotedStrings(jsonString: string): {
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
  
  // Replace unquoted values with quoted ones and track them
  const processedStr = str.replace(
    /(\w+)\s*:\s*([^,}\]]+)/g,
    (match, key, value) => {
      // Clean up the key
      const cleanKey = key.replace(/['"]/g, '');
      
      // Clean up the value
      let cleanValue = value.trim();
      
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
        // bare-value path at line 70 already does this).
        unquotedFields[cleanKey] = true;
        // Convert single quotes to double quotes
        cleanValue = '"' + cleanValue.slice(1, -1).replace(/"/g, '\\"') + '"';
      }

      return `"${cleanKey}": ${cleanValue}`;
    }
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