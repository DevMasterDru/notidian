import { parseCsvToRecords } from "core/utils/contexts/tableCsv";
import { planCsvImport } from "core/utils/contexts/tableCsvImport";

const plan = (
  csv: string,
  opts?: {
    existingColumnNames?: string[];
    existingRowTitles?: string[];
    titleHeader?: string | null;
  }
) =>
  planCsvImport({
    parsed: parseCsvToRecords(csv),
    existingColumnNames: opts?.existingColumnNames ?? [],
    existingRowTitles: opts?.existingRowTitles ?? [],
    titleHeader: opts?.titleHeader,
  });

describe("planCsvImport", () => {
  it("uses the first header as the title and maps the rest to frontmatter", () => {
    const result = plan("Name,Status,Hours\nAlpha,active,3\nBeta,done,5");
    expect(result.titleHeader).toBe("Name");
    expect(result.importableCount).toBe(2);
    expect(result.rows[0]).toEqual({
      title: "Alpha",
      fileName: "Alpha",
      properties: { Status: "active", Hours: "3" },
      collision: "none",
    });
    expect(result.rows[1].title).toBe("Beta");
    expect(result.rows[1].properties).toEqual({ Status: "done", Hours: "5" });
  });

  it("honors an explicit title header and excludes it from properties", () => {
    const result = plan("Name,Key,Status\nA,k1,open", {
      titleHeader: "Key",
    });
    expect(result.titleHeader).toBe("Key");
    expect(result.rows[0]).toEqual({
      title: "k1",
      fileName: "k1",
      properties: { Name: "A", Status: "open" },
      collision: "none",
    });
  });

  it("falls back to the first header when the requested title header is absent", () => {
    const result = plan("Name,Status\nA,open", { titleHeader: "Missing" });
    expect(result.titleHeader).toBe("Name");
  });

  it("flags headers that already exist as columns vs new ones", () => {
    const result = plan("Name,Status,Notes\nA,open,hi", {
      existingColumnNames: ["Name", "Status"],
    });
    expect(result.headers).toEqual([
      { header: "Name", existingColumn: true, isTitle: true },
      { header: "Status", existingColumn: true, isTitle: false },
      { header: "Notes", existingColumn: false, isTitle: false },
    ]);
  });

  it("marks a collision with an existing row title", () => {
    const result = plan("Name,Status\nAlpha,open\nBeta,done", {
      existingRowTitles: ["Alpha"],
    });
    expect(result.rows[0].collision).toBe("existing");
    expect(result.rows[1].collision).toBe("none");
  });

  it("marks a duplicate title within the same import (first wins as none)", () => {
    const result = plan("Name,Status\nDup,a\nDup,b");
    expect(result.rows[0].collision).toBe("none");
    expect(result.rows[1].collision).toBe("duplicate");
  });

  it("skips records whose title cell is empty (cannot name a file)", () => {
    const result = plan("Name,Status\nA,open\n   ,blank\nB,done");
    expect(result.totalRecords).toBe(3);
    expect(result.importableCount).toBe(2);
    expect(result.skippedNoTitle).toBe(1);
    expect(result.rows.map((r) => r.title)).toEqual(["A", "B"]);
  });

  it("ignores a blank header so it never becomes a frontmatter key", () => {
    const result = plan("Name,,Status\nA,junk,open");
    expect(result.rows[0].properties).toEqual({ Status: "open" });
  });

  it("returns an empty plan for an empty CSV", () => {
    const result = plan("");
    expect(result.titleHeader).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.importableCount).toBe(0);
  });

  it("round-trips quoted values with commas/newlines from the parser", () => {
    const result = plan('Name,Note\n"A, the first","line1\nline2"');
    expect(result.rows[0]).toEqual({
      title: "A, the first",
      fileName: "A, the first",
      properties: { Note: "line1\nline2" },
      collision: "none",
    });
  });

  it("sanitizes path separators / illegal chars out of the file name", () => {
    const result = plan("Name,Status\nA/B:C,open");
    expect(result.rows[0].title).toBe("A/B:C");
    expect(result.rows[0].fileName).toBe("ABC");
  });

  it("skips a record whose title sanitizes to nothing", () => {
    const result = plan("Name,Status\n///,open\nReal,done");
    expect(result.importableCount).toBe(1);
    expect(result.skippedNoTitle).toBe(1);
    expect(result.rows[0].fileName).toBe("Real");
  });

  it("detects collisions on the sanitized file name", () => {
    // "A/B" and "AB" both sanitize to "AB" -> second is a duplicate.
    const result = plan("Name\nA/B\nAB");
    expect(result.rows[0].collision).toBe("none");
    expect(result.rows[1].collision).toBe("duplicate");
  });
});
