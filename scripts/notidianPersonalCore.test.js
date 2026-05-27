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
});
