const manifest = require("../../manifest.json");
const packageJson = require("../../package.json");
const fs = require("fs");
const path = require("path");
import {
  legacyMakeMdKitUrlPrefix,
  legacyMakeMdWebHost,
  pluginRepositoryUrl,
} from "shared/pluginIdentity";

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");

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

  it("does not write runtime caches into legacy Make.md vault paths", () => {
    const runtimeFiles = [
      "src/main.ts",
      "src/adapters/obsidian/filesystem/filesystem.ts",
      "src/adapters/obsidian/filetypes/markdownAdapter.ts",
      "src/adapters/image/imageAdapter.ts",
    ];

    for (const runtimeFile of runtimeFiles) {
      const source = readRepoFile(runtimeFile);
      expect(source).not.toContain(".makemd/");
    }
  });

  it("keeps the root README aligned with the Notidian-only architecture", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain(
      "Notidian is the only intended database engine and interface"
    );
    expect(readme).toContain(
      "Native Obsidian Bases and `.base` files are not active runtime targets"
    );
    expect(readme).not.toContain("Bases-first convergence");
    expect(readme).not.toContain("--base-export");
    expect(readme).not.toContain("--base-view");
  });
});
