/**
 * Filename template engine (Notidian-pay5.1.1 / ADR 0054).
 *
 * Pure functions for parsing template strings like
 * `{board_id:02d}-ch{address:02d}-{device|slug}`, evaluating them against a
 * frontmatter record, and resolving collisions. No Obsidian imports -- this
 * module is unit-testable without mocks.
 */

import { validatePageTitle } from "./pageTitle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateLiteral = { kind: "literal"; text: string };

export type TemplateVariable = {
  kind: "variable";
  field: string;
  transform?: string; // e.g. "slug"
  transformParam?: number; // e.g. 30 for slug:30
  format?: string; // e.g. "02d"
};

export type TemplateSegment = TemplateLiteral | TemplateVariable;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a filename template string into an array of segments.
 *
 * Syntax: literal text outside `{}` becomes a TemplateLiteral.
 * Inside `{}`: `{field}`, `{field:02d}`, `{field|slug}`, `{field|slug:30}`.
 */
export const parseFilenameTemplate = (
  template: string
): TemplateSegment[] => {
  const segments: TemplateSegment[] = [];
  let i = 0;

  while (i < template.length) {
    const openBrace = template.indexOf("{", i);

    if (openBrace === -1) {
      // Rest is literal text
      segments.push({ kind: "literal", text: template.slice(i) });
      break;
    }

    // Literal text before the brace
    if (openBrace > i) {
      segments.push({ kind: "literal", text: template.slice(i, openBrace) });
    }

    const closeBrace = template.indexOf("}", openBrace);
    if (closeBrace === -1) {
      throw new Error(
        `Malformed template: unmatched '{' at position ${openBrace}`
      );
    }

    const inner = template.slice(openBrace + 1, closeBrace);
    if (inner.length === 0) {
      throw new Error(
        `Malformed template: empty field name at position ${openBrace}`
      );
    }

    const variable: TemplateVariable = { kind: "variable", field: "" };

    // Split on '|' first to separate field from transform
    const pipeIndex = inner.indexOf("|");
    if (pipeIndex >= 0) {
      const fieldPart = inner.slice(0, pipeIndex);
      const transformPart = inner.slice(pipeIndex + 1);

      if (fieldPart.length === 0) {
        throw new Error(
          `Malformed template: empty field name at position ${openBrace}`
        );
      }

      // Field may have a format: {field:02d|slug} is not valid syntax --
      // format goes on the field when no transform, or on the transform.
      // Spec says: {field|transform} or {field|transform:param}
      variable.field = fieldPart;

      const colonIndex = transformPart.indexOf(":");
      if (colonIndex >= 0) {
        variable.transform = transformPart.slice(0, colonIndex);
        const paramStr = transformPart.slice(colonIndex + 1);
        const paramNum = Number(paramStr);
        if (Number.isFinite(paramNum)) {
          variable.transformParam = paramNum;
        } else {
          throw new Error(
            `Malformed template: non-numeric transform param '${paramStr}' at position ${openBrace}`
          );
        }
      } else {
        variable.transform = transformPart;
      }
    } else {
      // No pipe -- check for format on the field: {field:02d}
      const colonIndex = inner.indexOf(":");
      if (colonIndex >= 0) {
        const fieldPart = inner.slice(0, colonIndex);
        const formatPart = inner.slice(colonIndex + 1);

        if (fieldPart.length === 0) {
          throw new Error(
            `Malformed template: empty field name at position ${openBrace}`
          );
        }

        variable.field = fieldPart;
        variable.format = formatPart;
      } else {
        variable.field = inner;
      }
    }

    segments.push(variable);
    i = closeBrace + 1;
  }

  return segments;
};

// ---------------------------------------------------------------------------
// Slug transform
// ---------------------------------------------------------------------------

/**
 * Convert a value to a filename-safe slug.
 *
 * Pipeline:
 * 1. Strip Unicode emoji (So, Sk categories, ZWJ sequences, variation selectors)
 * 2. Lowercase
 * 3. Replace spaces, underscores, dots with hyphens
 * 4. Strip chars unsafe for filenames
 * 5. Collapse consecutive hyphens
 * 6. Trim leading/trailing hyphens
 * 7. Truncate to maxLength (default 50)
 * 8. Fallback to "_" if empty after stripping
 */
export const slugify = (value: string, maxLength?: number): string => {
  const limit = maxLength ?? 50;

  let result = String(value);

  // 1. Strip emoji: So, Sk categories + ZWJ + variation selectors
  // Using a broad approach that handles surrogate pairs
  result = result.replace(/[\p{So}\p{Sk}‍︀-️]/gu, "");

  // 2. Lowercase
  result = result.toLowerCase();

  // 3. Replace spaces, underscores, dots, commas with hyphens
  result = result.replace(/[\s_.,]+/g, "-");

  // 4. Strip chars unsafe for filenames: : / \ * ? " < > | # { } % & + ! @
  result = result.replace(/[:/\\*?"<>|#{}%&+!@']/g, "");

  // 5. Collapse consecutive hyphens
  result = result.replace(/-{2,}/g, "-");

  // 6. Trim leading/trailing hyphens
  result = result.replace(/^-+|-+$/g, "");

  // 7. Truncate
  if (result.length > limit) {
    result = result.slice(0, limit).replace(/-+$/, "");
  }

  // 8. Fallback
  if (result.length === 0) {
    return "_";
  }

  return result;
};

// ---------------------------------------------------------------------------
// Format transform
// ---------------------------------------------------------------------------

/**
 * Apply a format specifier to a value.
 *
 * Supported formats:
 * - `Nd` (e.g. "02d", "03d"): zero-pad a number to N digits.
 */
export const formatValue = (value: any, format: string): string => {
  const padMatch = format.match(/^(\d+)d$/);
  if (padMatch) {
    const width = parseInt(padMatch[1], 10);
    const num = Number(value);
    if (Number.isNaN(num)) {
      // Non-numeric values: return string representation
      return String(value);
    }
    return String(num).padStart(width, "0");
  }

  throw new Error(`Unknown format specifier: '${format}'`);
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a parsed template against a frontmatter record to produce a
 * filename string (without extension).
 */
export const evaluateFilenameTemplate = (
  segments: TemplateSegment[],
  frontmatter: Record<string, any>
): string => {
  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.kind === "literal") {
      parts.push(seg.text);
      continue;
    }

    let value = frontmatter[seg.field];

    // Missing/null/empty field => placeholder
    if (value === null || value === undefined || value === "") {
      value = "_";
    }

    let str = String(value);

    // Apply transform
    if (seg.transform === "slug") {
      str = slugify(str, seg.transformParam);
    }

    // Apply format
    if (seg.format) {
      str = formatValue(str, seg.format);
    }

    parts.push(str);
  }

  const result = parts.join("");

  // Validate that the produced filename is legal
  const validation = validatePageTitle(result);
  if (validation.ok === false) {
    throw new Error(
      `Template produced invalid filename '${result}': ${validation.reason}`
    );
  }

  return validation.title;
};

// ---------------------------------------------------------------------------
// Collision resolver
// ---------------------------------------------------------------------------

/**
 * If `baseName` is not in `existingNames`, return it. Otherwise try
 * `baseName-2`, `baseName-3`, etc. Cap at 100 attempts.
 */
export const resolveCollision = (
  baseName: string,
  existingNames: Set<string>
): string => {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  for (let i = 2; i <= 101; i++) {
    const candidate = `${baseName}-${i}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Collision resolution exhausted after 100 attempts for '${baseName}'`
  );
};
