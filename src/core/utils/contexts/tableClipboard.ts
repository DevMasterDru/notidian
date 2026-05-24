export type TableClipboardGrid = string[][];

const trimFinalClipboardNewline = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");

export const parseTableClipboardText = (text: string): TableClipboardGrid => {
  const normalized = trimFinalClipboardNewline(text ?? "");
  if (normalized.length === 0) return [[""]];
  return normalized.split("\n").map((row) => row.split("\t"));
};

export const serializeTableClipboardGrid = (grid: unknown[][]): string =>
  grid
    .map((row) =>
      row.map((cell) => (cell == null ? "" : String(cell))).join("\t")
    )
    .join("\n");
