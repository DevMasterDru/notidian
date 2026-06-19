import fs from "fs";
import path from "path";

const menuCss = fs.readFileSync(path.join(__dirname, "Menu.css"), "utf8");

const cssBlockFor = (selector: string) => {
  const match = menuCss.match(new RegExp(`${selector} \\{([^}]+)\\}`));
  return match?.[1] ?? "";
};

describe("property header name menu CSS", () => {
  test("keeps the header name row inset inside the dropdown", () => {
    const block = cssBlockFor("\\.mk-property-header-name-menu");

    expect(block).toContain("margin: 0 6px;");
    expect(block).toContain("width: calc(100% - 12px);");
    expect(block).not.toContain("width: 100%;");
  });

  test("lets compact header display segments size from their labels", () => {
    const block = cssBlockFor("\\.mk-property-header-display-option");

    expect(block).toContain("flex: 1 1 auto;");
    expect(block).not.toContain("flex: 1 1 0;");
  });
});
