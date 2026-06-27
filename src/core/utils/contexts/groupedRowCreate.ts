import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";

export type GroupedRowCreatePlan = {
  name: string;
  values: Record<string, string>;
};

export type PlanGroupedRowCreateArgs = {
  rows: DBRow[];
  columns: SpaceTableColumn[];
  groupColumnId: string;
  groupValue: unknown;
  noValueSentinel?: string;
};

const columnId = (column: Pick<SpaceTableColumn, "name" | "table">): string =>
  column.name + (column.table ?? "");

const stringValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value);
};

const nonEmptyValues = (rows: DBRow[], key: string, fallbackKey?: string): string[] =>
  rows
    .map((row) => stringValue(row[key] ?? (fallbackKey ? row[fallbackKey] : undefined)))
    .filter((value) => value.trim().length > 0);

const distinctValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.reduce<string[]>((result, value) => {
    if (seen.has(value)) return result;
    seen.add(value);
    result.push(value);
    return result;
  }, []);
};

const basenameWithoutMarkdownExtension = (path: string): string => {
  const basename = path.split("/").pop() ?? path;
  return basename.replace(/\.md$/i, "");
};

const incrementIntegerText = (value: string, nextNumber: number): string =>
  String(nextNumber).padStart(value.length, "0");

const continueIntegerPattern = (values: string[]): string | null => {
  const distinct = distinctValues(values);
  if (distinct.length == 0) return null;
  const parsed = distinct.map((value) => {
    const match = value.match(/^(.*\D|)(\d+)(\D*)$/);
    if (!match) return null;
    return {
      value,
      prefix: match[1] ?? "",
      numberText: match[2],
      suffix: match[3] ?? "",
      number: Number(match[2]),
    };
  });
  if (parsed.some((item) => !item)) return null;
  const entries = parsed as Array<{
    value: string;
    prefix: string;
    numberText: string;
    suffix: string;
    number: number;
  }>;
  const first = entries[0];
  if (
    entries.some(
      (entry) =>
        entry.prefix != first.prefix ||
        entry.suffix != first.suffix ||
        !Number.isInteger(entry.number)
    )
  ) {
    return null;
  }
  const nextNumber = Math.max(...entries.map((entry) => entry.number)) + 1;
  const widest = Math.max(...entries.map((entry) => entry.numberText.length));
  return `${first.prefix}${incrementIntegerText(
    String(nextNumber).padStart(widest, "0"),
    nextNumber
  )}${first.suffix}`;
};

const continuedOrStableValue = (values: string[]): string | null => {
  const distinct = distinctValues(values);
  if (distinct.length == 0) return null;
  if (distinct.length == 1) return distinct[0];
  return continueIntegerPattern(distinct);
};

const continuedNameFromRows = (rows: DBRow[]): string => {
  const pathBasenames = nonEmptyValues(rows, PathPropertyName).map(
    basenameWithoutMarkdownExtension
  );
  return continueIntegerPattern(pathBasenames) ?? "";
};

export const planGroupedRowCreate = ({
  rows,
  columns,
  groupColumnId,
  groupValue,
  noValueSentinel,
}: PlanGroupedRowCreateArgs): GroupedRowCreatePlan => {
  const values: Record<string, string> = {};
  const groupColumn = columns.find((column) => columnId(column) == groupColumnId);
  const normalizedGroupValue = stringValue(groupValue);
  if (
    groupColumn &&
    normalizedGroupValue.length > 0 &&
    normalizedGroupValue != noValueSentinel
  ) {
    values[groupColumn.name] = normalizedGroupValue;
  }

  for (const column of columns) {
    if (column.name == PathPropertyName || column.name == "_index") continue;
    if (groupColumn && column.name == groupColumn.name && column.table == groupColumn.table)
      continue;
    const continued = continuedOrStableValue(
      nonEmptyValues(rows, columnId(column), column.name)
    );
    if (continued !== null) values[column.name] = continued;
  }

  return {
    name: continuedNameFromRows(rows),
    values,
  };
};
