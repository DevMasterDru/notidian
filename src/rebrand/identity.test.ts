const manifest = require("../../manifest.json");
const packageJson = require("../../package.json");
import {
  legacyMakeMdKitUrlPrefix,
  legacyMakeMdWebHost,
  pluginRepositoryUrl,
} from "shared/pluginIdentity";

describe("Notidian identity", () => {
  it("uses Notidian package and Obsidian plugin metadata", () => {
    expect(packageJson.name).toBe("notidian");
    expect(packageJson.description).toContain("Notidian");
    expect(manifest.id).toBe("notidian");
    expect(manifest.name).toBe("Notidian");
    expect(manifest.description).toContain("Notidian");
  });

  it("points public package metadata at the Notidian repository", () => {
    expect(packageJson.repository.url).toBe(
      "git+https://github.com/DevMasterDru/notidian.git"
    );
    expect(packageJson.bugs.url).toBe(
      "https://github.com/DevMasterDru/notidian/issues"
    );
    expect(packageJson.homepage).toBe(
      "https://github.com/DevMasterDru/notidian#readme"
    );
    expect(pluginRepositoryUrl).toBe("https://github.com/DevMasterDru/notidian");
  });

  it("keeps legacy Make.md web assets explicit", () => {
    expect(legacyMakeMdWebHost).toBe("https://www.make.md");
    expect(legacyMakeMdKitUrlPrefix).toBe(
      "https://www.make.md/static/kits/"
    );
  });
});
