import { parseFieldValue } from "core/schemas/parseFieldValue";
import { SpaceProperty } from "shared/types/mdb";

export const defaultValueForField = (field: SpaceProperty, value?: any, path?: string) => {

const parsedValue = parseFieldValue(field.value, field.type)

  if (field.type == 'number' || field.type == 'boolean') {
    // Presence, not truthiness: a legitimately-entered 0 (number) or false
    // (boolean) is a SUPPLIED value and must NOT collapse to the configured
    // default. Only an absent value (undefined/null) — or an empty string ''
    // — falls through. The '' exclusion keeps this branch consistent with the
    // string branch's "empty string is no value" semantics: the live caller
    // (ButtonSubmenu.tsx) seeds these fields from a STRING param map, so an
    // unset number/boolean param arrives as '' and must still pre-fill the
    // configured default rather than rendering blank. This mirrors the string
    // branch's intent (a supplied value wins over the default) while avoiding
    // the falsy-collapse class fixed elsewhere in the repo (sortingUtils ADR
    // 0025/0033) — 0 and false are NOT '', so they survive. See fields.test.ts.
    if (value !== undefined && value !== null && value !== "")
      return value;
  } else {
    // For string/option/other kinds a present, non-empty string is "supplied";
    // an empty string '' is treated as no value and falls through to default
    // (matches the long-standing length-based presence check).
    if (value?.length > 0) {
      return value
    }
  }

  if (parsedValue) {
    if (parsedValue.default == '$space' && path) return path;
    return parsedValue.default;
  }
};
export const saveDefaultValueForField = (field: SpaceProperty, value: any) => {
    const parsedValue = parseFieldValue(field.value, field.type)
  return {
    ...field,
    value: JSON.stringify({
      ...parsedValue,
      default: value
    })
  };
};
