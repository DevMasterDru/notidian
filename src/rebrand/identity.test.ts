const manifest = require("../../manifest.json");
const packageJson = require("../../package.json");

describe("Notidian identity", () => {
  it("uses Notidian package and Obsidian plugin metadata", () => {
    expect(packageJson.name).toBe("notidian");
    expect(packageJson.description).toContain("Notidian");
    expect(manifest.id).toBe("notidian");
    expect(manifest.name).toBe("Notidian");
    expect(manifest.description).toContain("Notidian");
  });
});
