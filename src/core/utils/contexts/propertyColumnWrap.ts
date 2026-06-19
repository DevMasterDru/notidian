import type { ColumnWrapMode } from "shared/types/predicate";

export const columnWrapModes: ColumnWrapMode[] = ["clip", "wrap"];

// Default to single-line "clip" (Notion's default): clean, uniform rows, with
// "wrap" opted in per column.
export const defaultColumnWrapMode: ColumnWrapMode = "clip";

export const columnWrapModeForValue = (value?: unknown): ColumnWrapMode =>
  columnWrapModes.includes(value as ColumnWrapMode)
    ? (value as ColumnWrapMode)
    : defaultColumnWrapMode;
