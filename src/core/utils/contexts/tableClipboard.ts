export type TableClipboardGrid = string[][];

const trimFinalClipboardNewline = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");

const parseUnquotedTsv = (text: string): TableClipboardGrid =>
  text.split("\n").map((row) => row.split("\t"));

// Spreadsheet applications encode cells containing a tab, newline, or quote as
// quoted TSV fields (with embedded quotes doubled). Treating every tab/newline
// as a structural delimiter shifts all following cells to the wrong targets.
// If a clipboard claims to be quoted TSV but never closes its opening quote,
// preserve the legacy literal split rather than silently consuming characters.
const parseQuotedTsv = (text: string): TableClipboardGrid | null => {
  const grid: TableClipboardGrid = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inQuotes) {
      if (character == '"') {
        if (text[index + 1] == '"') {
          value += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character == '"' && value.length == 0) {
      inQuotes = true;
    } else if (character == "\t") {
      row.push(value);
      value = "";
    } else if (character == "\n") {
      row.push(value);
      grid.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (inQuotes) return null;
  row.push(value);
  grid.push(row);
  return grid;
};

const serializeTsvCell = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  return /["\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const parseTableClipboardText = (text: string): TableClipboardGrid => {
  const normalized = trimFinalClipboardNewline(text ?? "");
  if (normalized.length === 0) return [[""]];
  return parseQuotedTsv(normalized) ?? parseUnquotedTsv(normalized);
};

export const serializeTableClipboardGrid = (grid: unknown[][]): string =>
  grid.map((row) => row.map(serializeTsvCell).join("\t")).join("\n");
