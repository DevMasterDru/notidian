const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("Notidian personal core", () => {
  it("does not expose native Bases as an active runtime surface", () => {
    const main = read("src/main.ts");
    const commands = read("src/commands.tsx");
    const realVaultHarness = read("scripts/notidianRealVaultHarness.js");

    expect(main).not.toContain("registerNotidianBasesView");
    expect(main).not.toContain("notidianBasesViewRegistered");
    expect(commands).not.toContain("openBaseExportPreview");
    expect(commands).not.toContain("notidian-export-active-folder-base");
    expect(commands).not.toContain("Export active folder as Obsidian Base");
    expect(realVaultHarness).not.toContain("--base-export");
    expect(realVaultHarness).not.toContain("--base-view");
  });

  it("does not leave removed Bases implementation paths in the active tree", () => {
    [
      "src/adapters/obsidian/bases",
      "src/core/react/components/Bases",
      "src/core/utils/bases",
    ].forEach((relativePath) => {
      expect(fs.existsSync(path.join(repoRoot, relativePath))).toBe(false);
    });
  });

  it("keeps active architecture docs free of removed Bases workflow hooks", () => {
    [
      "docs/README.md",
      "docs/current-state.md",
      "docs/notidian-system-architecture.md",
      "docs/table-database-workflows.md",
      "docs/real-vault-smoke-harness.md",
      "docs/superpowers/plans/2026-05-27-notidian-only-personal-core.md",
    ].forEach((relativePath) => {
      const text = read(relativePath);
      expect(text).not.toMatch(/base-adapter\.md/);
      expect(text).not.toMatch(/--base-export|--base-view/);
      expect(text).not.toMatch(/src\/core\/utils\/bases/);
      expect(text).not.toMatch(/src\/adapters\/obsidian\/bases/);
      expect(text).not.toMatch(/notidianBaseAdapter|notidianBasesView/);
      expect(text).not.toMatch(/optional Bases compatibility/i);
    });
  });

  it("keeps the superseded Bases-compatible plan non-executable", () => {
    const plan = read(
      "docs/superpowers/plans/2026-05-27-notidian-first-architecture.md"
    );

    expect(plan).toMatch(/Superseded/);
    expect(plan).toMatch(/Do not execute this plan/);
    expect(plan).not.toMatch(/--base-export|--base-view/);
    expect(plan).not.toMatch(/base-adapter\.md/);
    expect(plan).not.toMatch(/src\/core\/utils\/bases/);
    expect(plan).not.toMatch(/src\/adapters\/obsidian\/bases/);
    expect(plan).not.toMatch(/notidianBaseAdapter|notidianBasesView/);
  });

  it("wires table redo as a first-class keyboard operation", () => {
    const tableView = read(
      "src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx"
    );

    expect(tableView).toContain("tableRedoStack");
    expect(tableView).toContain("redoLastTableOperation");
    expect(tableView).toContain('e.key.toLowerCase() == "y"');
    expect(tableView).toContain("redoWrites");
  });
});
