const manifest = require("../../manifest.json");
const packageJson = require("../../package.json");
const fs = require("fs");
const path = require("path");
import { pluginRepositoryUrl } from "shared/pluginIdentity";

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");

const readRepoFileIfExists = (relativePath: string) => {
  const filePath = path.join(__dirname, "..", "..", relativePath);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
};

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

  it("does not expose legacy Make.md remote kit or web space entry points", () => {
    const activeRuntimeFiles = [
      "src/shared/pluginIdentity.ts",
      "src/main.ts",
      "src/adapters/obsidian/ui/kit/InstallKitModal.tsx",
      "src/core/spaceManager/webAdapter/webAdapter.ts",
      "src/core/spaceManager/webAdapter/webCache.ts",
    ];
    const blockedRuntimeText = [
      "legacyMakeMdWebHost",
      "legacyMakeMdKitUrlPrefix",
      "https://www.make.md",
      "static/kits",
      "new WebSpaceAdapter",
      "addSpaceAdapter(webSpaceAdapter",
    ];

    for (const runtimeFile of activeRuntimeFiles) {
      const source = readRepoFileIfExists(runtimeFile);
      for (const blocked of blockedRuntimeText) {
        expect(source).not.toContain(blocked);
      }
    }
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

  it("does not automatically read legacy Make.md plugin data", () => {
    const main = readRepoFile("src/main.ts");
    const identity = readRepoFile("src/shared/pluginIdentity.ts");
    const readme = readRepoFile("README.md");

    expect(main).not.toContain("loadDataWithLegacyFallback");
    expect(main).not.toContain("pluginDataFilePathWithLegacyFallback");
    expect(main).not.toContain("migrateLegacyPluginDataFile");
    expect(main).not.toContain("legacyPluginDataPath");
    expect(identity).not.toContain("legacyPluginDataDir");
    expect(identity).not.toContain("legacyPluginDataPath");
    expect(readme).not.toContain(".obsidian/plugins/make-md");
  });

  it("does not depend on Make.md GitHub forks", () => {
    const lockfile = readRepoFileIfExists("package-lock.json");
    const dependencyText = `${JSON.stringify(packageJson.dependencies ?? {})}\n${JSON.stringify(packageJson.devDependencies ?? {})}\n${lockfile}`;

    expect(dependencyText).not.toContain("github:make-md");
    expect(dependencyText).not.toContain("github.com/make-md");
    expect(dependencyText).not.toContain("git@github.com:make-md");
  });
});
