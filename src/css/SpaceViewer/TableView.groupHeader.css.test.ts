import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.join(__dirname, "TableView.css"), "utf8");

const ruleBody = (selector: string) => {
  const match = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
};

const ruleBodies = (selector: string) =>
  Array.from(
    css.matchAll(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`, "g"))
  )
    .map((match) => match[1])
    .join("\n");

describe("grouped-table island header CSS", () => {
  it("pins the growable group-label button to the inline start", () => {
    // Obsidian globally centers flex-button contents. This button fills the
    // group band, so an explicit start alignment keeps the island name visible
    // at the left edge instead of centering it beyond a horizontally scrolled
    // table viewport.
    expect(ruleBody("\\.mk-group-header-label-button")).toMatch(
      /justify-content:\s*flex-start/
    );
  });

  it("sizes the group manager to content, while keeping it resizable and viewport-safe", () => {
    const manager = ruleBody("\\.mk-grouped-island-menu");
    expect(manager).toMatch(/width:\s*max-content/);
    expect(manager).toMatch(/max-width:\s*min\(80vw,\s*720px\)/);
    expect(manager).toMatch(/resize:\s*horizontal/);
    expect(manager).toMatch(/overflow:\s*auto/);
    expect(ruleBody("\\.mk-grouped-island-option-name")).toMatch(
      /flex:\s*0 1 auto/
    );
    expect(ruleBodies("\\.mk-grouped-island-option")).toMatch(
      /justify-content:\s*flex-start/
    );
    expect(ruleBody("\\.mk-grouped-island-option-name")).toMatch(
      /margin-inline-end:\s*auto/
    );
  });
});
