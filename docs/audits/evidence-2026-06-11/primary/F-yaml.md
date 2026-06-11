## Verdict

Core table frontmatter writes mostly follow the intended architecture: they route through Obsidian `processFrontMatter`, gate context acceptance on confirmed writes, and strip frontmatter-backed values from MDB persistence. The weak points are fidelity and side paths: tag/link helpers bypass the authority-aware transaction model, empty typed values are coerced into concrete YAML values, and stale comparison is based on rendered strings rather than raw typed frontmatter. Overall: the main path is sound, but several reachable helpers can still mangle ordinary vault metadata.

## Findings

### [SEV-critical] Link rename/delete can corrupt frontmatter link arrays and write Notidian-owned link columns into Markdown

Evidence: `src/core/utils/contexts/links.ts:13-15`

> `return serializeMultiString(parseMultiString(value).map(f => parseLinkString(f) == link ? newLink : link))`

Evidence: `src/core/utils/contexts/links.ts:21-23`

> `return cols.filter(f => f.type.startsWith('link') || f.type.startsWith('context'))`

Evidence: `src/core/utils/contexts/links.ts:47-50`

> `const newValue = replaceLinkInValue(link,newLink, row[c.name]);`
> `manager.saveProperties(row[PathPropertyName], {[c.name]: parseMDBStringValue(c.type, newValue, true)})`

Evidence: `src/core/superstate/superstate.ts:639-645`

> `if (contextCache.outlinks.includes(oldPath)) {`
> `this.addToContextStateQueue(() => renameLinkInContexts(...))`

Why it matters: `replaceLinkInValue` maps every non-matching link to the old `link`, not the original `f`, so a multi-link value can lose unrelated links during file rename. The helper also writes every `link`/`context` column to frontmatter without checking `source: "frontmatter"`, creating hidden frontmatter authority for Notidian-owned columns.

Suggested fix direction: change the mapper to `... ? newLink : f`; filter to frontmatter-backed columns before `saveProperties`; route context-owned link updates through context table persistence only.

Confidence: high. Cheapest confirm: unit-test `replaceLinkInValue("A.md","B.md",'["A.md","C.md"]')` and a context table with a Notidian-owned link column.

### [SEV-critical] Native YAML `tags` arrays are mangled by tag helpers

Evidence: `src/adapters/obsidian/filetypes/markdownAdapter.ts:410-418`

> `const rows = fmKeys.reduce(`
> `(p, c) => ({ ...p, [c]: parseProperty(c, fm[c]) }),`
> `{}`

Evidence: `src/utils/parsers.ts:21-24`

> `case "tags-multi": {`
> `return Array.isArray(value)`
> `? serializeMultiString(value.map((f) => stringifyPropertyValue(f)))`

Evidence: `src/adapters/obsidian/utils/tags.ts:164-205`

> `const fm = await manager.readProperties(path);`
> `... value.replace(/\s/g, "").split(",") ...`
> `manager.saveProperties(path, {`
> `tags: addTag(fm["tags"]),`

Why it matters: `readProperties` returns projected strings, not raw YAML. A normal `tags: [foo, bar]` becomes the JSON string `["foo","bar"]`; the tag helper then comma-splits that string and writes bracket/quote fragments back to the real Obsidian `tags` property.

Suggested fix direction: tag helpers should read raw `metadataCache.frontmatter.tags` or parse projected values with `parseMultiString`, preserve original array-vs-string shape when possible, and await each write.

Confidence: high. Cheapest confirm: fixture with `tags: [foo, bar]`, call `addTagToProperties(..., "baz")`, inspect resulting YAML.

### [SEV-high] Frontmatter schema rename reports success before old-key deletion is actually done

Evidence: `src/core/utils/contexts/notidianSchemaApply.ts:55-73`

> `const removeResult = await deleteProperty(write.path, key);`
> `...`
> `applied++;`

Evidence: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:821-823`

> `public async deleteProperty (path: string, property: string) {`
> `const file = await this.fileSystem.getFile(path)`
> `this.fileSystem.deleteFileFragment(file, 'property', property)`

Evidence: `src/adapters/obsidian/filetypes/markdownAdapter.ts:495-501`

> `return this.app.fileManager.processFrontMatter(afile, (frontmatter: any) => {`
> `delete frontmatter[fragmentId]`
> `});`

Why it matters: the schema apply path awaits `deleteProperty`, but `FilesystemSpaceAdapter.deleteProperty` neither returns nor awaits the `processFrontMatter` promise. A rename can set the new key, notify success, reload, and leave the old duplicate key behind if deletion is delayed or fails.

Suggested fix direction: return/await `deleteFileFragment` through `FilesystemSpaceAdapter.deleteProperty` and `SpaceManager.deleteProperty`; add a delayed-failure test for schema rename.

Confidence: high. Cheapest confirm: mock `deleteFileFragment` with a delayed rejection and assert `applyFrontmatterSchemaWritePlans` currently reports success.

### [SEV-high] Stale-frontmatter detection compares rendered strings, allowing false skips and false conflicts

Evidence: `src/core/react/context/ContextEditorContext.tsx:787-795`

> `return parseProperty(`
> `column.name,`
> `pathState.metadata?.property?.[column.name],`
> `column.type`
> `);`

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:248-252`

> `const baseValue = rowValueForWrite(row, write);`
> `...`
> `canonicalValue != baseValue`

Evidence: `src/utils/parsers.ts:50-60`

> `if (value instanceof Date) {`
> `const dateString = format(value, "yyyy-MM-dd")`
> `...`
> `return value;`

Why it matters: ADR 0009 promises stale canonical values are skipped before overwrite. Because comparison uses display strings, two different Date values on the same day can compare equal after `yyyy-MM-dd` projection, while equivalent arrays/objects with different ordering/formatting can compare unequal.

Suggested fix direction: store the raw rendered-base frontmatter snapshot per row and compare with type-aware equality before writing; preserve Date time/timezone in the compare path.

Confidence: high for mechanics, medium for exact UI frequency. Cheapest confirm: unit-test a Date object changing from `09:00` to `17:00` on the same day.

### [SEV-high] Clearing typed cells writes coerced YAML values instead of empty/absent values

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:776-778`

> `const clearCell = () => {`
> `pasteSelection("", "Clear cells");`
> `};`

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:264-268`

> `[write.columnName]: parseValue(column, write.value),`

Evidence: `src/utils/properties.ts:134-146`

> `if (type == "number") {`
> `return parseFloat(value);`
> `} else if (type == "boolean") {`
> `return value == "true";`
> `... type.includes("-multi")`

Why it matters: clearing a number writes `NaN`, clearing a boolean writes `false`, and clearing a multi-value writes `[]`. That is not the same as absent, `null`, or empty string, and it can permanently change the semantics of existing frontmatter.

Suggested fix direction: define explicit empty semantics per frontmatter type; for clear/delete, prefer deleting the key or writing `null` only after an intentional schema choice.

Confidence: high. Cheapest confirm: table clear on number/boolean/multi-select frontmatter fixture.

### [SEV-medium] Direct frontmatter key rename skips falsey values

Evidence: `src/core/react/components/Explorer/PropertiesView.tsx:210-215`

> `const renameFMKey = (key: string, name: string) => {`
> `...`
> `renameProperty(props.superstate, pathState.path, key, name);`

Evidence: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:808-815`

> `const { [property]: value, ...properties} =  prev;`
> `if (!value) return prev;`
> `return {...properties, [newProperty]: value}`

Why it matters: YAML values `false`, `0`, `""`, and `null` are legitimate frontmatter values. This helper refuses to rename them, so a UI/schema rename can leave the canonical file key unchanged.

Suggested fix direction: use `hasOwnProperty` rather than truthiness, preserve the extracted value exactly, and return/await the write promise.

Confidence: high. Cheapest confirm: rename a frontmatter key whose value is `false` or `0`.

### [SEV-medium] Date round-trips do not preserve datetime/timezone fidelity

Evidence: `src/core/utils/date.ts:10`

> `export const isoDateFormat = \`yyyy-MM-dd'T'HH:mm:ss\`;`

Evidence: `src/core/react/components/SpaceView/Contexts/DataTypeView/DateCell.tsx:38-45`

> `hasTime ? isoDateFormat : "yyyy-MM-dd"`
> `props.saveValue(newValue);`

Evidence: `src/utils/properties.ts:138-143`

> `const date = new Date(value);`
> `return !isNaN(date.getTime()) ? date : value;`

Why it matters: time-bearing dates are written without timezone, then converted to JavaScript `Date` objects for YAML serialization. Combined with the date-only projection above, this can shift or drop the original timezone/time representation.

Suggested fix direction: distinguish `date` from `datetime`; store date-only values as strings and datetime values as explicit ISO strings with timezone, unless the user chooses Date-object YAML.

Confidence: medium. Cheapest confirm: fixture with `2026-06-11T23:30:00Z`, edit in DateCell, inspect serialized YAML.

### [SEV-medium] Multi-select edits normalize scalar/string frontmatter into arrays

Evidence: `src/core/react/components/SpaceView/Contexts/DataTypeView/OptionCell.tsx:151-157`

> `newValues.length == 0`
> `? props.saveValue("")`
> `: props.saveValue(serializeMultiString(newValues));`

Evidence: `src/utils/parsers.ts:8-10`

> `ensureString(str).startsWith("[") ? ensureArray(safelyParseJSON(str)) : parseMultiDisplayString(str)`

Evidence: `src/utils/properties.ts:144-146`

> `return parseMultiString(value).map((f) => parseMDBStringValue(type.replace("-multi", ""), f, frontmatter))`

Why it matters: once a property is treated as multi-select, scalar YAML and comma-display strings round-trip through Notidian as arrays. That may be acceptable as a product decision, but today it is implicit and can surprise users expecting frontmatter shape preservation.

Suggested fix direction: document and test shape normalization, or carry the original scalar/list shape in the row snapshot and preserve it for no-op or single-value edits.

Confidence: high for current behavior. Cheapest confirm: frontmatter `areas: kitchen` as `option-multi`, add/remove an option, inspect YAML.

### [SEV-low] Formatting, comments, duplicate keys, and malformed YAML behavior are delegated to Obsidian without Notidian fixtures

Evidence: `src/adapters/obsidian/filetypes/frontmatter/fm.ts:25-30`

> `if (file instanceof TFile && app.metadataCache.getFileCache(file) !== null) {`
> `currentCache = app.metadataCache.getFileCache(file);`
> `}`
> `return currentCache?.frontmatter;`

Evidence: `src/adapters/obsidian/filetypes/markdownAdapter.ts:477-484`

> `const newFrontmatter = content(frontmatter);`
> `const newKeys = Object.keys(newFrontmatter);`
> `...`
> `Object.keys(frontmatter).filter(f => !newKeys.includes(f)).forEach(f => delete frontmatter[f]);`

Why it matters: Notidian manipulates Obsidian’s parsed frontmatter object. It does not see comments, duplicate keys, original quoting, BOM/CRLF/trailing-newline style, or non-byte-0 frontmatter. The observed behavior for those cases is therefore inherited from Obsidian and not asserted in this codebase.

Suggested fix direction: add a fixture harness around `processFrontMatter` for comments, duplicate keys, invalid YAML, BOM, CRLF, missing trailing newline, and frontmatter not at byte 0.

Confidence: medium. Cheapest confirm: real-vault or mocked Obsidian fixtures for each listed file shape.

## Swept clean

- Main table edit path: `executeTableValueWrites` resolves row path, compares current frontmatter, writes frontmatter first, and only then saves accepted table/context changes.
- Main frontmatter write helper: `saveFrontmatterProperties` treats `false`/`undefined`/throwing writes as failure and prevents table acceptance.
- Frontmatter-backed MDB hygiene: `stripFrontmatterBackedRowValues` removes frontmatter/computed columns before context table persistence.
- Frontmatter discovery: existing YAML keys are discovered from `pathsIndex` metadata, mixed observed types fall back conservatively, and real `tags` is excluded from ordinary discovery.
- Tags UI split: non-`tags` columns with `tags-multi` render as `OptionCell`, while real `tags` uses `TagCell`.
- Schema planning: rename planning classifies `old-only`, `new-only`, `both-same`, `both-conflict`, and revalidates before apply; the apply plumbing has the async issue above.
- I did not inspect `.worktrees/`, did not modify files, and did not run builds or the full test suite.

## Improvement paths

1. Build a frontmatter fixture suite for typed round-trips: numbers, numeric strings, booleans, null/empty/absent, dates/datetimes/timezones, lists/scalars, objects, multiline strings, colons, `#`, quotes, and `[[wikilinks]]`.

2. Centralize a typed frontmatter codec that separates display strings from raw YAML values, defines empty semantics, and provides type-aware stale comparison.

3. Remove direct `saveProperties` calls from tag/link/schema side helpers; route them through authority-aware helpers that check `source`, await writes, and preserve raw frontmatter shape.