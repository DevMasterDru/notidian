import {
  parseCsv,
  parseCsvToRecords,
  serializeCsv,
  tableToCsv,
} from "core/utils/contexts/tableCsv";

describe("serializeCsv (RFC 4180)", () => {
  it("joins plain cells with commas and rows with newlines", () => {
    expect(
      serializeCsv([
        ["a", "b"],
        ["c", "d"],
      ])
    ).toBe("a,b\nc,d");
  });

  it("quotes cells containing a comma, quote, or newline", () => {
    expect(serializeCsv([["a,b", 'he said "hi"', "line1\nline2"]])).toBe(
      '"a,b","he said ""hi""","line1\nline2"'
    );
  });

  it("leaves empty cells empty (unquoted)", () => {
    expect(serializeCsv([["", "x", ""]])).toBe(",x,");
  });
});

describe("parseCsv (RFC 4180)", () => {
  it("parses plain rows", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses quoted fields with embedded commas and newlines", () => {
    expect(parseCsv('"a,b","line1\nline2"')).toEqual([["a,b", "line1\nline2"]]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsv('"he said ""hi"""')).toEqual([['he said "hi"']]);
  });

  it("accepts CRLF and a trailing newline without an extra empty row", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns an empty grid for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n")).toEqual([["   "]]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("keeps a bare mid-field quote literal instead of corrupting the row", () => {
    expect(parseCsv('a"b,c')).toEqual([['a"b', "c"]]);
  });

  it("recovers an unterminated quoted field at EOF", () => {
    expect(parseCsv('"abc')).toEqual([["abc"]]);
  });
});

describe("round trip", () => {
  it("parse(serialize(x)) === x for tricky values", () => {
    const grid = [
      ["name", "note"],
      ["A, Inc", 'quote " and , comma'],
      ["multi\nline", ""],
    ];
    expect(parseCsv(serializeCsv(grid))).toEqual(grid);
  });
});

describe("tableToCsv", () => {
  it("emits a header from column names and string cells by key", () => {
    const csv = tableToCsv({
      columns: [
        { key: "NameFile", name: "Name" },
        { key: "statusctx", name: "Status" },
      ],
      rows: [
        { NameFile: "Alpha", statusctx: "active" },
        { NameFile: "Beta, Co", statusctx: 2 },
      ],
    });
    expect(csv).toBe('Name,Status\nAlpha,active\n"Beta, Co",2');
  });
});

describe("parseCsvToRecords", () => {
  it("maps header columns to per-row records and skips fully-empty rows", () => {
    const result = parseCsvToRecords("Name,Status\nAlpha,active\n,\nBeta,done");
    expect(result.headers).toEqual(["Name", "Status"]);
    expect(result.rows).toEqual([
      { Name: "Alpha", Status: "active" },
      { Name: "Beta", Status: "done" },
    ]);
  });

  it("returns empties for blank input", () => {
    expect(parseCsvToRecords("")).toEqual({ headers: [], rows: [] });
  });
});
