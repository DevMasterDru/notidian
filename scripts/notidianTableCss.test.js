const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("Notidian table CSS", () => {
  it("paints frozen table cells with an opaque backing layer", () => {
    const css = read("src/css/SpaceViewer/TableView.css");

    expect(css).toMatch(/\.mk-frozen-column::before/);
    expect(css).toMatch(/\.mk-frozen-row-gutter::before/);
    expect(css).toMatch(/background:\s*var\(--mk-ui-background\)/);
    expect(css).toMatch(/pointer-events:\s*none/);
  });

  it("keeps frozen header dividers visible", () => {
    const css = read("src/css/SpaceViewer/TableView.css");

    expect(css).toMatch(
      /\.mk-frozen-row-gutter::before,\s*\.mk-frozen-column::before\s*{[^}]*inset:\s*0;/s
    );
    expect(css).toMatch(
      /\.mk-table thead \.mk-frozen-column,\s*\.mk-table thead \.mk-frozen-row-gutter\s*{[^}]*box-shadow:\s*inset 0 -0\.5px 0 var\(--background-modifier-border\);/s
    );
    expect(css).toMatch(
      /\.mk-table thead \.mk-frozen-column-last\s*{[^}]*inset 0 -0\.5px 0 var\(--background-modifier-border\)/s
    );
  });
});
