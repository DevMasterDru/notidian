import { DBRow } from "shared/types/mdb";
import { parseMultiString } from "utils/parsers";

export type GroupBucketColumn = {
  name: string;
  table?: string;
  type?: string;
};

export type GroupBucketFilter = {
  fn: (value: string, filterValue: string) => boolean;
};

/**
 * Decide whether `row` belongs in the list/board group bucket keyed by
 * `optionValue` ("" is the None / ungrouped bucket).
 *
 * Notidian-kxka: a row that is simply MISSING the grouped property reads as
 * `undefined`. The default `is` filter does `value == optionValue`, and
 * `undefined == ""` is `false` in JS, so a value-less row matched NO bucket and
 * silently vanished from every grouped list/board view. We normalize a
 * null/undefined cell to "" so it lands in the None bucket — restoring symmetry
 * with the option-list builder, which already coerces with `value ?? ""`.
 *
 * Multi-value fields (`*-multi`, `tags`) keep their existing semantics: a row
 * with no parsed values belongs to None, otherwise to each option it contains.
 */
export const rowMatchesGroupOption = (
  row: DBRow,
  groupBy: GroupBucketColumn,
  optionValue: string,
  filterFn: GroupBucketFilter
): boolean => {
  const value = row[groupBy.name + (groupBy.table ?? "")] ?? "";
  const isMultiField =
    groupBy.type?.endsWith("-multi") || groupBy.type === "tags";

  if (isMultiField && value) {
    const values = parseMultiString(value);
    return optionValue === ""
      ? values.length === 0
      : values.includes(optionValue);
  }

  return filterFn.fn(value, optionValue);
};
