import {
  serializeMultiDisplayString,
  serializeMultiString,
} from "utils/serializers";

const uniqueNonEmpty = (values: string[]): string[] => [
  ...new Set(
    values
      .map((value) => (value == null ? "" : String(value)))
      .filter((value) => value.length > 0)
  ),
];

export const normalizeOptionCellSelection = ({
  incomingValues,
  multi,
}: {
  currentValues: string[];
  incomingValues: string[];
  multi: boolean;
}): string[] => {
  const values = uniqueNonEmpty(incomingValues);
  return multi ? values : values.slice(-1);
};

export const serializeOptionCellSelection = (
  values: string[],
  multi: boolean
): string => {
  if (values.length == 0) return "";
  return multi
    ? serializeMultiString(values)
    : serializeMultiDisplayString(values);
};

export const optionCellMenuSavePayload = ({
  optionValues,
  incomingValues,
  multi,
}: {
  optionValues: string[];
  incomingValues: string[];
  multi: boolean;
}): { optionValues: string[]; selectedValues: string[] } => ({
  optionValues: uniqueNonEmpty(optionValues),
  selectedValues: normalizeOptionCellSelection({
    currentValues: [],
    incomingValues,
    multi,
  }),
});
