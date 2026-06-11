## Verdict

This dimension is functional but not clean. I did not find active native Bases, Make.md web-market, makemd.com API, collaboration, or AI surfaces in the inspected runtime paths, but several Make.md-era local subsystems remain compiled and reachable. The highest-risk issues are not bundle size; they are legacy UI paths that can still persist frontmatter values into context MDB and move runtime storage away from `.notidian`.

## Findings

### [SEV-high] Frontmatter property action can persist ordinary values into context MDB

Evidence: `src/core/react/components/Explorer/PropertiesView.tsx:82-94`

```ts
const properties = pathState?.metadata?.property ?? {};
const fmKeys = uniqCaseInsensitive([
  ...Object.keys(properties),
...
schemaId: "",
type: detectPropertyType(properties[f], f),
```

Evidence: `src/core/react/components/UI/Menus/properties/propertiesMenu.tsx:33-39`

```ts
name: i18n.menu.syncToContext,
icon: "ui//sync",
onClick: (e) => {
  syncProperty(property);
},
```

Evidence: `src/shared/en.ts:307`

```ts
"syncToContext": "Add Property to Context",
```

Evidence: `src/core/react/components/Explorer/PropertiesView.tsx:161-176`

```ts
const field: SpaceProperty = {
  ...property,
  schemaId: defaultContextSchemaID,
};
await props.superstate.spaceManager.addSpaceProperty(space, field);
await updateContextValue(..., pathState.path, field.name, values[field.name]);
```

Evidence: `src/core/utils/contexts/context.ts:241-250`

```ts
let newMDB = updateFunction(f, PathPropertyName, path, field, value);
return saveContext(manager, space, newMDB, force, calculate)
```

Why it matters: ordinary frontmatter-backed values must not become durable MDB row data. This creates a reachable divergence path where `.notidian` can contain stale copies of values owned by Markdown frontmatter.

Suggested fix direction: remove or re-scope “Add Property to Context” for frontmatter properties. If a context column is needed, store schema/view metadata only, never the current frontmatter row value.

Confidence: high. Cheapest confirmation: in a scratch vault, add a frontmatter property, use the property menu action, then inspect the corresponding `.notidian` context MDB row.

### [SEV-high] Runtime storage root is still user-mutable away from `.notidian`

Evidence: `src/shared/pluginIdentity.ts:1-14`

```ts
export const pluginStorageRoot = ".notidian";
...
export const isLegacyStorageRoot = (value: unknown) =>
  legacyStorageRoots.includes(String(value ?? ""));
```

Evidence: `src/main.ts:177-180`

```ts
if (isLegacyStorageRoot(settings.spaceSubFolder)) {
  settings.spaceSubFolder = pluginStorageRoot;
}
```

Evidence: `src/core/react/components/System/SettingsSections/AdvancedSettings.tsx:121-127`

```tsx
<input
  type="text"
  value={spaceSubFolder}
  onChange={(e) => {
    setSpaceSubFolder(e.target.value);
    superstate.settings.spaceSubFolder = e.target.value;
```

Evidence: `src/commands.tsx:72-88`

```ts
id: "move-space-folder",
...
moveSpaceFiles(
  plugin,
  plugin.superstate.settings.spaceSubFolder,
  path
);
```

Evidence: `src/adapters/obsidian/filesystem/spaceFileOps.tsx:14-30`

```ts
plugin.superstate.settings.spaceSubFolder = newString;
plugin.superstate.saveSettings();
...
await plugin.superstate.spaceManager.renamePath(oldString, newString);
```

Why it matters: the current architecture says runtime storage writes target `.notidian`. Exact legacy roots are normalized, but arbitrary custom roots still survive settings save and the command palette can move storage there.

Suggested fix direction: make `spaceSubFolder` internal and fixed to `pluginStorageRoot`. Keep migration as an explicit one-way command that accepts only legacy roots or reviewed recovery targets.

Confidence: high. Cheapest confirmation: unit-test `sanitizedSettings({ spaceSubFolder: "custom" })` and the `move-space-folder` command path.

### [SEV-medium] Basics/Flow editor subsystem is compiled and default-on

Evidence: `src/core/schemas/settings.ts:86-87`

```ts
basics: true,
basicsSettings: BasicDefaultSettings,
```

Evidence: `src/basics/schemas/settings.ts:4-13`

```ts
flowMenuEnabled: true,
inlineStyler: true,
editorFlow: true,
internalLinkClickFlow: false,
```

Evidence: `src/main.ts:669-672`

```ts
if (this.superstate.settings.basics) {
  this.basics = new MakeBasicsPlugin(this);
  this.basics.loadBasics();
}
```

Evidence: `src/basics/basics.tsx:105-139`

```ts
registerEditorMenus(this);
if (this.settings.editorFlow) {
  patchWorkspaceForFlow(this);
  patchWorkspaceLeafForFlow(this);
...
  loadFlowCommands(this);
}
this.reloadExtensions(true);
```

Why it matters: this is reachable on fresh settings and modifies editor behavior outside the Notidian database engine. Direct inspected footprint is about 7k LOC across `src/basics`, `FlowEditor`, and Flow/action CSS. Removal risk is medium-high because it is active by default.

Suggested fix direction: decide whether Basics/Flow is in scope. If not, disable by default first, then remove editor patches, commands, CSS, and settings in a staged cleanup.

Confidence: high. Cheapest confirmation: launch with fresh settings and check that Flow body classes/extensions are registered before any user opt-in.

### [SEV-medium] MKit/SpaceKit installer remains reachable and can import context MDB content

Evidence: `src/main.ts:248-267`

```ts
if (this.superstate.settings.contextEnabled) {
...
  this.registerView(MKIT_FILE_VIEWER_TYPE, (leaf) => {
    return new MKitFileViewer(leaf, this);
  });
}
```

Evidence: `src/main.ts:429-435`

```ts
this.registerExtensions(["mdb"], MDB_FILE_VIEWER_TYPE);
...
this.registerExtensions(["mkit"], MKIT_FILE_VIEWER_TYPE);
```

Evidence: `src/adapters/obsidian/ui/editors/MKitFileViewer.tsx:171-174`

```ts
const mkitString = await this.plugin.app.vault.read(file);
this.spaceKit = safelyParseJSON(mkitString) as SpaceKit;
```

Evidence: `src/adapters/obsidian/ui/editors/MKitFileViewer.tsx:52-62`

```ts
const handleInstall = async () => {
...
  await installSpaceKit(plugin, plugin.superstate, spaceKit, parentPath);
```

Evidence: `src/adapters/obsidian/ui/kit/kits.ts:134-143`

```ts
if (kit.context)
{
  const dbPath = (newSpace.space as FilesystemSpaceInfo).dbPath;
  plugin.mdbFileAdapter.newContent(..., 'tables', '', mdbToDBTables(kit.context), {});
```

Why it matters: `.mkit` is a Make.md-era kit/template pathway, not a core Notidian personal database workflow. It can create spaces and import context MDB tables directly. Direct viewer/installer/MKit context code is roughly 1.7k LOC, plus cross-cutting preview branches in `SpaceManagerContext`.

Suggested fix direction: remove the `.mkit` extension registration or make it a migration-only importer with explicit warnings and frontmatter-safe conversion.

Confidence: high. Cheapest confirmation: open a `.mkit` file in a scratch vault, click install, and inspect the created `.notidian` context files.

### [SEV-medium] Static HTML export/publishing surface is still reachable

Evidence: `src/core/react/components/SpaceView/SpaceHeaderBar.tsx:243-250`

```ts
menuOptions.push(
...
{
  name: i18n.labels.exportToHTML,
...
  onClick: (e) => {
    setExpandedSection(4);
```

Evidence: `src/core/react/components/SpaceView/SpaceHeader.tsx:119-123`

```tsx
) : expandedSection == 4 ? (
  <SpaceExport
    superstate={props.superstate}
```

Evidence: `src/core/react/components/SpaceEditor/SpaceExport.tsx:64-68`

```ts
if (pathState.type == "space") {
  htmlPath = path + "/index.html";
  output = await spaceToHtml(props.superstate, path, {
```

Evidence: `src/core/react/components/SpaceEditor/SpaceExport.tsx:91-98`

```ts
} else if (pathState.subtype == "md") {
...
  htmlPath = path.replace(new RegExp(".md$"), ".html");
  output = await noteToHtml(props.superstate, path, {
```

Evidence: `src/core/react/components/SpaceEditor/SpaceExport.tsx:125-128`

```ts
return props.superstate.spaceManager
  .writeToPath(htmlPath, output)
```

Why it matters: this is a reachable publishing/export subsystem that writes generated HTML into the vault next to spaces/notes. It is not a Notidian database guarantee violation, but it is substantial off-core fork debt and can litter or collide with user files.

Suggested fix direction: hide/remove export if out of scope, or force an explicit export directory outside ordinary note paths.

Confidence: high. Cheapest confirmation: use the space action menu in a scratch vault and observe generated `index.html` or sibling `.html`.

### [SEV-medium] Bundle is a large all-in-one artifact with eager legacy surfaces

Evidence: `esbuild.config.mjs:155-178`

```js
entryPoints: ['main.ts'],
bundle: true,
...
treeShaking: true,
minify: true,
outfile: outputDir+'/main.js',
```

Evidence: `src/main.ts:103-142`

```ts
import "css/Editor/Flow/FlowEditor.css";
import "css/Editor/Frames/Insert.css";
...
import "css/Editor/MKitViewer.css";
...
import "css/SpaceViewer/TableView.css";
```

Evidence: `src/adapters/obsidian/assets/ObsidianAssetManager.ts:5-6`

```ts
import { emojis } from 'shared/assets/emoji';
import { normalizePluginStoragePath, pluginStorageRoot } from 'shared/pluginIdentity';
```

Evidence: `src/adapters/obsidian/assets/ObsidianAssetManager.ts:536-600`

```ts
const lucideIconMetadata: IconMetadata[] = lucideIcons.map(...)
...
Object.keys(emojis).forEach(category => {
  emojis[category].forEach((emoji: any) => {
```

Evidence: `src/adapters/image/imageAdapter.ts:6-16`

```ts
import pica from "pica";
...
this.picaInstance = pica();
```

Read-only size check: committed `main.js` is 5,738,143 bytes; `styles.css` is 156,931 bytes; `emoji.ts` is 174,072 bytes; `icons.ts` is 99,605 bytes; `sql-wasm.wasm` is 613,426 bytes.

Why it matters: startup and shipped size are dominated by one bundled entry that eagerly includes editor/Flow, frames, MKit CSS, asset catalogs, image thumbnail code, SQL/MDB support, and visualization infrastructure. Some of these serve off-core or optional features.

Suggested fix direction: run a central esbuild metafile analysis, then gate or remove MKit, export, Flow, image thumbnail, asset catalog, and visualization chunks according to product scope.

Confidence: medium. Cheapest confirmation: run the central build with esbuild metafile/visualizer and compare retained modules before and after disabling these entry points.

### [SEV-low] Package manifest has stale dependencies and undeclared direct imports

Evidence: `package.json:90-98`

```json
"@codemirror/highlight": "^0.19.8",
...
"@dnd-kit/modifiers": "^6.0.1",
...
"@lezer/highlight": "^1.2.0",
```

Evidence: `package.json:110-123`

```json
"common-tags": "^1.8.2",
...
"mdast-util-to-markdown": "^2.1.2",
```

Evidence: `package.json:141`

```json
"use-long-press": "^3.2.0",
```

Evidence: `src/core/react/components/Navigator/SpaceTree/SpaceTreeVirtualized.tsx:1-2`

```ts
import { UniqueIdentifier } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
```

Evidence: `src/core/react/components/Visualization/D3VisualizationEngine.tsx:24-26`

```ts
import * as d3Selection from "d3-selection";
import * as d3Scale from "d3-scale";
import * as d3Array from "d3-array";
```

Why it matters: the listed stale packages had no source imports in the audited paths, while `@dnd-kit/utilities` and D3 subpackages are imported directly but not declared as runtime dependencies. This is mostly hygiene, but it weakens reproducible installs and dependency audits.

Suggested fix direction: run depcheck or equivalent, remove unused packages, and add explicit runtime deps for direct imports or rewrite imports to declared packages.

Confidence: high. Cheapest confirmation: remove the listed unused deps and run the central build; run `npm ls @dnd-kit/utilities d3-selection d3-scale d3-array`.

## Swept clean

- No active native Obsidian Bases or `.base` runtime surface found in the inspected runtime paths.
- No active `makemd.com`, Make.md web-market, collaboration, or AI provider integration found in `src/`, `package.json`, `manifest.json`, or `esbuild.config.mjs`.
- Internal names like `MakeMDPlugin`, `makemd-core`, and `mk-*` are mostly lineage/cosmetic in this dimension; I found correctness risk only where they tie to storage root mutation or MKit preview/import behavior.
- Legacy `saveAllContextToFrontmatter` and `syncFormulaToFrontmatter` settings are actively stripped in `src/main.ts:175-176`.
- The fonts filetype adapter appears source-dead rather than bundle-reachable: I found no active registration path comparable to the image/icon adapters.

## Improvement paths

1. First harden architecture guarantees: remove frontmatter-to-context value persistence and lock runtime storage to `.notidian`.
2. Decide scope for the three reachable fork-debt surfaces: Basics/Flow, MKit/SpaceKit, and HTML export. Disable-by-default is the lowest-risk intermediate step.
3. Run a dedicated bundle/dependency pass with an esbuild metafile, then trim unused packages and lazy-load or remove optional heavy modules. Recommended next step: file beads for findings 1 and 2 before any broad cleanup.