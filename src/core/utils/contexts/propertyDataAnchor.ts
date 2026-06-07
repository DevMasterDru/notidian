import type {
  ColumnDataAnchor,
  ColumnDataAnchorMode,
  ColumnHeaderDisplayMode,
} from "shared/types/predicate";
import { propertyHeaderDisplayParts } from "./propertyHeaderDisplayMode";

export const columnDataAnchors: ColumnDataAnchor[] = [
  "left",
  "center",
  "right",
];

export const columnDataAnchorModes: ColumnDataAnchorMode[] = [
  "auto",
  ...columnDataAnchors,
];

export const defaultColumnDataAnchorMode: ColumnDataAnchorMode = "auto";

export const columnDataAnchorModeForValue = (
  value?: unknown
): ColumnDataAnchorMode =>
  columnDataAnchorModes.includes(value as ColumnDataAnchorMode)
    ? (value as ColumnDataAnchorMode)
    : defaultColumnDataAnchorMode;

const rtlPattern = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;

export const containsRTLText = (values: unknown[]): boolean =>
  values.some((value) => {
    if (typeof value != "string") return false;
    const text = value.trim();
    return text.length > 0 && rtlPattern.test(text);
  });

export const columnDataAnchorForCells = ({
  mode,
  headerDisplayMode,
  columnWidth,
  values,
}: {
  mode: ColumnDataAnchorMode;
  headerDisplayMode: ColumnHeaderDisplayMode;
  columnWidth?: number;
  values: unknown[];
}): ColumnDataAnchor => {
  if (mode != "auto") return mode;

  const displayParts = propertyHeaderDisplayParts({
    mode: headerDisplayMode,
    columnWidth,
  });
  if (displayParts.effectiveMode == "icon") return "center";

  return containsRTLText(values) ? "right" : "left";
};
