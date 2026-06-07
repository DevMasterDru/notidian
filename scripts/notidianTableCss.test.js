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

  it("gives icon-only headers three pixels of side padding", () => {
    const css = read("src/css/SpaceViewer/TableView.css");

    expect(css).toMatch(
      /\.mk-col-header\.mk-col-header--icon\s*{[^}]*padding:\s*0 3px;/s
    );
  });

  it("does not force the last data column to fill remaining table width", () => {
    const css = read("src/css/SpaceViewer/TableView.css");

    expect(css).not.toMatch(
      /\.mk-table table th:last-child\s*{[^}]*width:\s*100%;/s
    );
  });

  it("lets compact boolean table cells shrink to checkbox width", () => {
    const css = read("src/css/SpaceViewer/TableView.css");

    expect(css).toMatch(
      /\.mk-td-compact\.mk-td-boolean\s*{[^}]*padding:\s*0;/s
    );
    expect(css).toMatch(
      /\.mk-td-compact \.mk-cell-boolean\s*{[^}]*justify-content:\s*center;[^}]*padding:\s*0;/s
    );
    expect(css).toMatch(
      /\.mk-td-compact \.mk-cell-boolean input\[type="checkbox"\]\s*{[^}]*margin:\s*0;/s
    );
  });

  it("lets the row-number gutter use runtime width instead of fixed CSS width", () => {
    const css = read("src/css/SpaceViewer/TableView.css");

    expect(css).not.toMatch(
      /\.mk-row-gutter(?:-header)?\s*{[^}]*width:\s*42px;/s
    );
    expect(css).toMatch(
      /\.mk-row-gutter-inner\s*{[^}]*width:\s*100%;/s
    );
    expect(css).toMatch(
      /\.mk-row-drag-handle\s*{[^}]*position:\s*absolute;/s
    );
  });
});
