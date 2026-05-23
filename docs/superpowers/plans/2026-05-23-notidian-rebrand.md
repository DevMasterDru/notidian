# Notidian Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the fork as Notidian while preserving a migration path from Make.md plugin data.

**Architecture:** Keep the internal engine stable and limit this phase to identity surfaces, visible product strings, Obsidian plugin metadata, and compatibility path helpers. Legacy `make-md` paths are read as fallbacks, while new writes target `notidian`.

**Tech Stack:** TypeScript, Jest, Obsidian plugin manifest, npm package metadata, esbuild production bundle.

---

### Task 1: Identity Regression Test

**Files:**
- Create: `src/rebrand/identity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import manifest from "../../manifest.json";
import packageJson from "../../package.json";

describe("Notidian identity", () => {
  it("uses Notidian package and Obsidian plugin metadata", () => {
    expect(packageJson.name).toBe("notidian");
    expect(packageJson.description).toContain("Notidian");
    expect(manifest.id).toBe("notidian");
    expect(manifest.name).toBe("Notidian");
    expect(manifest.description).toContain("Notidian");
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx jest src/rebrand/identity.test.ts --runInBand`

Expected: FAIL because package and manifest still use Make.md identity.

- [ ] **Step 3: Commit only after the rebrand implementation passes**

This task is committed together with Task 2 because it describes the new metadata contract.

### Task 2: Metadata And Visible Identity

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `src/shared/en.ts`
- Modify: visible URL/message files discovered by `rg`

- [ ] **Step 1: Update manifest and package metadata**

Set:

```json
{
  "id": "notidian",
  "name": "Notidian",
  "description": "Notidian turns Obsidian folders and properties into database-like workspaces.",
  "author": "DevMasterDru",
  "authorUrl": "https://github.com/DevMasterDru"
}
```

Set `package.json`:

```json
{
  "name": "notidian",
  "description": "Notidian turns Obsidian folders and properties into database-like workspaces."
}
```

- [ ] **Step 2: Update README**

Replace the Make.md marketing README with a fork README that states:

- Notidian is an independent fork of Make.md.
- Obsidian Markdown/frontmatter properties are the canonical data layer.
- Existing Make.md lineage is credited under MIT.
- Legacy Make.md data can be migrated/read by Notidian.

- [ ] **Step 3: Update visible strings**

Replace user-facing `Make.md`/`make.md` strings with `Notidian`, including startup notifications, help/community labels, and plugin protocol IDs.

- [ ] **Step 4: Keep internal lineage names where intentional**

Leave `MakeMDPlugin`, `MakeMDSettings`, `IMakeMDPlugin`, `makemd-core`, docs for the property-backed contexts design, and `spaces://` untouched in this phase.

### Task 3: Legacy Data Path Compatibility

**Files:**
- Create: `src/shared/pluginIdentity.ts`
- Modify: `src/main.ts`
- Modify: `src/adapters/obsidian/filesystem/filesystem.ts`

- [ ] **Step 1: Add plugin identity constants**

```ts
export const pluginId = "notidian";
export const legacyPluginId = "make-md";
export const pluginDisplayName = "Notidian";
export const pluginDataDir = (configDir: string) => `${configDir}/plugins/${pluginId}`;
export const legacyPluginDataDir = (configDir: string) =>
  `${configDir}/plugins/${legacyPluginId}`;
```

- [ ] **Step 2: Use Notidian path for new writes**

Replace hard-coded `"/plugins/make-md"` path construction with `pluginDataDir(this.app.vault.configDir)`.

- [ ] **Step 3: Read legacy data if new data is absent**

For `Spaces.mdb`, prefer the Notidian path. If the Notidian file is absent and the legacy file exists, read the legacy file.

### Task 4: Verification And Commit

- [ ] **Step 1: Verify GREEN for identity test**

Run: `npx jest src/rebrand/identity.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 2: Verify full tests**

Run: `npm test -- --runInBand`

Expected: all suites pass.

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: exit code 0.

- [ ] **Step 4: Verify production build**

Run: `npm run build`

Expected: build writes `main.js`, `styles.css`, and copied `manifest.json` without errors.

- [ ] **Step 5: Commit**

```bash
git add manifest.json package.json package-lock.json README.md src/rebrand/identity.test.ts src/shared/pluginIdentity.ts src/main.ts src/adapters/obsidian/filesystem/filesystem.ts src/shared/en.ts main.js
git commit -m "chore: rebrand fork as Notidian"
```

