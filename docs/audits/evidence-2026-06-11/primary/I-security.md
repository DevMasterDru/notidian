## Verdict

The security/robustness surface is not yet sound for malicious/shared vault content. The largest risks are reachable runtime execution of vault-persisted JavaScript, unsandboxed raw HTML rendering, and raw SVG/HTML injection sinks. The `.space`/`.makemd` to `.notidian` storage guard and frontmatter/computed-value persistence boundary look substantially better than the executable and DOM surfaces.

### Network Calls

| Surface | Evidence | Trigger / source | Destination | Reachable today? |
|---|---|---|---|---|
| Remote markdown fetch | `src/adapters/obsidian/ui/editors/markdownView/FileLinkViewComponent.tsx:78-89` — `fetch(props.path).then((res) => res.text())` | Path not found locally | Arbitrary `props.path` | Yes |
| Remote iframe | `src/core/react/components/PathView/PathView.tsx:19-34`, `:53` — `uri?.scheme == "https" || uri?.scheme == "http"` and `<iframe src={props.path}></iframe>` | HTTP(S) path view | Arbitrary HTTP(S) URL | Yes |
| Vault HTML iframe subresources | `src/adapters/obsidian/ui/editors/HTMLFileViewer.tsx:79-86` — `iframe.srcdoc = htmlString` | Opening `.html` / `.htm` file | Any subresources/scripts inside vault HTML | Yes |
| Remote MDB loader | `src/adapters/mdb/db/db.ts:16-18`, `:70-74` — `const sqlPromise = fetch(path)` | `getDB(path, true)` | Arbitrary MDB URL | No current true call site found |
| Export image embed XHR | `src/core/export/treeToAst/treeToHast.ts:340-359` — `xhr.open("GET", url, true)` | `embedImage(url)` | Arbitrary image URL | Not reachable; only commented references found |
| sql.js wasm fallback | `src/adapters/mdb/db/sqljs/sql-wasm.js:677-700`, `:845-847`, `:2615-2617` | Vendored sql.js fallback | wasm path | Not reachable in current loader; `src/adapters/mdb/db/sqljs.js:1-7` passes `wasmBinary` |
| Other APIs | `rg` found no `requestUrl`, `WebSocket`, `axios`, `http.request`, or `https.request` runtime use | N/A | N/A | None found |

### HTML Sinks

| Sink | Evidence | Input source | Reachable today? |
|---|---|---|---|
| Raw vault HTML into iframe | `HTMLFileViewer.tsx:79-86` — `const htmlString = await this.plugin.app.vault.read(file); ... iframe.srcdoc = htmlString` | Vault `.html` / `.htm` file | Yes |
| Remote iframe | `PathView.tsx:53` — `<iframe src={props.path}></iframe>` | Vault/path-controlled HTTP(S) path | Yes |
| Markdown renderer output to `innerHTML` | `FileLinkViewComponent.tsx:24-27` — `ref.current.innerHTML = f` | Local or fetched markdown rendered through `mdToHtml` | Yes |
| Table text cell HTML | `TextCell.tsx:41-51` — `dangerouslySetInnerHTML={{ __html: initialValue }}` | Frontmatter/MDB/table cell value | Yes, edit mode |
| Frame text node HTML | `TextNodeView.tsx:43-45`, `:127-145` — `const newValue = e.target.innerHTML` and `dangerouslySetInnerHTML={{ __html: props.state.props?.value }}` | Frame MDB/text prop | Yes |
| Fragment title HTML | `SpaceFragmentWrapper.tsx:28-31`, `:86-98` — saves `innerHTML`, renders `dangerouslySetInnerHTML={{ __html: props.name }}` | Context/fragment name | Yes |
| Context title HTML | `ContextTitle.tsx:83-90` — `dangerouslySetInnerHTML={{ __html: dbSchema?.name }}` | Table/schema name | Yes |
| Custom sticker SVG/HTML | `ObsidianAssetManager.ts:803-823`, `:836-850`; sinks at `PathSticker.tsx:133-135`, `IconNodeView.tsx:75-77`, `RemoteMarkdownHeaderView.tsx:90-92`, `modifyTabSticker.ts:22-24` | `.notidian` iconset SVG plus frontmatter/frame sticker key | Yes |
| Thumbnail SVG foreignObject | `markdownAdapter.ts:151-175`, `:248-255` — `node.innerHTML = html` | Generated exporter HTML | Yes when note thumbnails run |
| Drag clone HTML | `ContextListInstance.tsx:116` — `dragEl.innerHTML = ref.current.innerHTML` | Already-rendered DOM | Yes; secondary sink |

## Findings

### [SEV-critical] Persisted frame and command code executes arbitrary JavaScript with vault-write APIs

Evidence:

- `src/core/utils/frames/executable.ts:7-20`:
  > `new Function(\`with(this) { ${codeBlock} }\`)`
- `src/core/utils/frames/executable.ts:40-42`:
  > `treeNode.execProps = ... generateCodeForProp(...)`
  > `treeNode.execActions = ... generateCodeForProp(e, true)`
- `src/core/react/context/FrameRootContext.tsx:49-55`:
  > `const frame = await props.superstate.spaceManager.readFrame(...)`
  > `buildRootFromMDBFrame(... frame ...)`
- `src/core/utils/frames/runner.ts:224-248`:
  > `environment.$api = api`
  > `result = codeBlockStore[key]?.call(environment);`
- `src/core/superstate/api.ts:98-118`:
  > `path.create: (...) => newPathInSpace(... content)`
  > `path.setProperty: (...) => saveProperties(...)`

Why it matters: Vault-persisted frame properties/actions can become executable JavaScript and receive `$api` methods that create files, set frontmatter, and mutate tables. Under the stated threat model, a malicious shared vault can plausibly corrupt vault file data.

Suggested fix direction: Disable or permission-gate executable frame/script content by default. Replace `new Function` with a constrained expression interpreter, and make `$api` read-only unless the user explicitly trusts the vault/script.

Confidence: high. Cheapest confirmation is a throwaway vault frame/command that calls `$api.path.setProperty(...)` and verifies whether opening the frame mutates a note.

### [SEV-critical] Vault HTML files render in an unsandboxed `srcdoc` iframe

Evidence:

- `src/adapters/obsidian/ui/editors/HTMLFileViewer.tsx:79-86`:
  > `const htmlString = await this.plugin.app.vault.read(file);`
  > `const iframe = document.createElement("iframe");`
  > `iframe.srcdoc = htmlString;`
- `src/main.ts:431`:
  > `this.registerExtensions(["html", "htm"], HTML_FILE_VIEWER_TYPE);`

Why it matters: A malicious `.html` file in a vault is rendered as raw iframe HTML without a `sandbox` attribute. In an Electron/Obsidian plugin context, that is a high-risk code execution surface and can load external subresources.

Suggested fix direction: Add a restrictive iframe sandbox, remove script permission by default, and consider opening raw HTML externally or behind a trust prompt.

Confidence: high. Cheapest confirmation is a throwaway `.html` file with a benign script attempting to mutate `parent.document.body.dataset`.

### [SEV-high] Custom sticker/icon SVG is injected as raw HTML

Evidence:

- `src/adapters/obsidian/assets/ObsidianAssetManager.ts:803-823`:
  > `const content = await this.readPath(path);`
  > `this.cacheIconFromPath(path, content);`
  > `return content;`
- `src/adapters/obsidian/assets/ObsidianAssetManager.ts:836-850`:
  > `this.iconsCache.set(path, content);`
  > `this.iconsCache.set(nameWithoutExt, content);`
- `src/adapters/obsidian/ui/sticker.ts:62-73`:
  > `const icon = assetManager.getIconSync(...)`
  > `if (icon) { return icon; }`
- `src/shared/components/PathSticker.tsx:133-135`:
  > `dangerouslySetInnerHTML={{ __html: props.superstate.ui.getSticker(sticker) }}`
- `src/adapters/obsidian/utils/modifyTabSticker.ts:22-24`:
  > `leaf.tabHeaderInnerIconEl.innerHTML = icon;`

Why it matters: Vault-controlled custom SVG can be selected by frontmatter or frame metadata and inserted into plugin DOM. SVG event handlers, scripts, `foreignObject`, or external references can cross the React escaping boundary.

Suggested fix direction: Sanitize custom SVG with a strict SVG profile before caching; strip scripts, event attributes, `foreignObject`, and external hrefs. Prefer rendering custom icons as image resources where possible.

Confidence: high. Cheapest confirmation is a custom iconset SVG with a harmless `onload` marker in a throwaway vault.

### [SEV-high] Plain text and schema names are rendered with `dangerouslySetInnerHTML`

Evidence:

- `src/core/react/components/SpaceView/Contexts/DataTypeView/TextCell.tsx:41-51`:
  > `dangerouslySetInnerHTML={{ __html: initialValue }}`
- `src/core/react/components/SpaceView/Frames/EditorNodes/TextNodeView.tsx:43-45`:
  > `const newValue = e.target.innerHTML;`
- `src/core/react/components/SpaceView/Frames/EditorNodes/TextNodeView.tsx:127-145`:
  > `dangerouslySetInnerHTML={{ __html: props.state.props?.value }}`
- `src/core/react/components/SpaceView/Editor/EmbedView/SpaceFragmentWrapper.tsx:28-31`, `:86-98`:
  > `const newValue = e.target.innerHTML;`
  > `dangerouslySetInnerHTML={{ __html: props.name }}`
- `src/core/react/components/SpaceView/Contexts/FilterBar/ContextTitle.tsx:83-90`:
  > `dangerouslySetInnerHTML={{ __html: dbSchema?.name }}`

Why it matters: Values that should be ordinary frontmatter/table/schema text can become raw HTML. A malicious pasted value or shared vault field can execute in edit/read surfaces instead of remaining inert text.

Suggested fix direction: Render plain text as React text children or `textContent`. Where rich text is intentional, sanitize before storage and before render.

Confidence: high. Cheapest confirmation is a throwaway text value like an `img onerror` payload in a text cell or frame title.

### [SEV-high] MDB SQL helpers interpolate identifiers and raw clauses

Evidence:

- `src/adapters/mdb/db/db.ts:170-179`:
  > `SELECT ${fieldsStr} FROM "${table}" WHERE ${condition};`
  > `SELECT ${fieldsStr} FROM ${table};`
- `src/adapters/mdb/db/db.ts:221-229`:
  > `` `${c}='${sanitizeSQLStatement(curr?.[c]) ?? ""}'` ``
  > `WHERE ${updateCol}=...`
- `src/adapters/mdb/db/db.ts:277-290`:
  > `` `CREATE TABLE IF NOT EXISTS "${t}" (${fieldQuery});` ``
  > `` `ON "${t}"(${c});` ``
- `src/shared/utils/sanitizers.ts:2-15`:
  > `sanitizeSQLStatement` only replaces `'`
  > `sanitizeColumnName` removes `"` instead of quoting

Why it matters: Table names, field names, unique-index expressions, and `condition` clauses can originate from context/schema data and are interpolated into sql.js strings. A malformed or malicious `.notidian` MDB can break persistence, corrupt context state, or execute unintended SQL against the context database.

Suggested fix direction: Add one identifier-quoting helper that doubles `"` and use it for every table/index/column identifier. Replace raw conditions with structured query builders or prepared statements.

Confidence: high. Cheapest confirmation is a unit test around `replaceDB` with table/column names containing quotes and SQL metacharacters.

### [SEV-medium] Remote paths fetch or embed arbitrary network content without consent

Evidence:

- `src/adapters/obsidian/ui/editors/markdownView/FileLinkViewComponent.tsx:65-89`:
  > `if (f) { ... readPath ... } else { fetch(props.path) ... }`
- `src/core/react/components/PathView/PathView.tsx:19-34`:
  > `uri?.scheme == "https" || uri?.scheme == "http"`
- `src/core/react/components/PathView/PathView.tsx:41-54`:
  > `<iframe src={props.path}></iframe>`

Why it matters: A vault-controlled path can trigger network requests or remote iframe embeds. For a personal local plugin this is mainly privacy, tracking, and robustness risk, but the remote iframe is also unsandboxed.

Suggested fix direction: Prompt before first remote load, add allow/deny controls, set iframe `sandbox` and `referrerPolicy`, and make remote fetch failures visible.

Confidence: high. Cheapest confirmation is opening a path view pointing to a controlled HTTP endpoint and observing the request.

### [SEV-medium] Object field JSON parsing can throw through generic conversion paths

Evidence:

- `src/utils/properties.ts:121-133`:
  > `if (type == "object") { return JSON.parse(value); }`
  > `else if (type == 'object-multi') { return JSON.parse(value); }`
- `src/core/react/context/ContextEditorContext.tsx:772-787`:
  > `parseMDBStringValue(fieldTypeForField(column), value, true)`
- `src/core/react/components/Visualization/Visualization.tsx:391-414`:
  > `parsedRow[key] = parseMDBStringValue(column.type, String(value || ""))`
- Safer contrast, `src/utils/parsers.ts:126-130`:
  > `safelyParseJSON(value) ?? {}`

Why it matters: Malformed object JSON from a vault file, MDB row, or pasted value can throw during write or visualization conversion. This is robustness debt rather than a direct corruption vector.

Suggested fix direction: Route object parsing through `safelyParseJSON` / `parseObject`, and return typed parse errors where the UI can show skipped values.

Confidence: medium. Cheapest confirmation is an object field value of `{bad` in a throwaway context and opening visualization or paste/write flow.

### [SEV-medium] Runtime catches suppress executable and SQL failures

Evidence:

- `src/core/utils/frames/executable.ts:21-24`:
  > `catch (e) { console.log(e, codeBlock) }`
- `src/core/utils/frames/runner.ts:266-267`:
  > `} catch (error) { }`
- `src/adapters/mdb/db/db.ts:208-211`:
  > `try { db.exec(`${sqlstr}`); } catch (e) { }`
- `src/adapters/mdb/db/db.ts:309-315`:
  > `catch (e) { return false; }`

Why it matters: Malformed vault content or SQL/schema edge cases can fail silently, leaving partial UI state or missing context writes with little diagnostic signal. That makes corruption and import failures harder to detect.

Suggested fix direction: Return typed errors from execution and MDB helpers, log structured diagnostics once, and surface user-visible notices for skipped writes or disabled executable content.

Confidence: high. Cheapest confirmation is a malformed frame expression or invalid schema identifier and checking whether the UI reports the failure.

## Swept clean

- Legacy storage normalization is segment-based and wraps the active Obsidian vault adapter methods. `src/shared/pluginIdentity.ts:4-21` maps exact `.space` / `.makemd` path segments to `.notidian`, and `src/adapters/obsidian/legacyStorageGuard.ts:27-40` wraps `exists`, `read`, `write`, `mkdir`, `remove`, `rename`, `copy`, and related methods.
- Frontmatter-backed and computed values are stripped before context MDB persistence. `src/core/utils/properties/propertyAuthority.ts:12-35` classifies authority, and `src/core/utils/properties/allProperties.ts:275-303` removes nonpersistent columns before `filesystemAdapter.ts:530-545` saves tables.
- Formula evaluation uses mathjs rather than raw JavaScript execution. `src/core/utils/formula/parser.ts:306-321` evaluates in a mathjs scope; I found no formula write API comparable to `$api`.
- No reachable `requestUrl`, `WebSocket`, `axios`, `http.request`, or `https.request` use was found in `src/` or `scripts/`.
- External `postMessage` handling was not found. The message traffic located is internal worker messaging in `src/core/superstate/workers/indexer/`.
- The legacy audit script SQL path is stronger than runtime MDB helpers: `scripts/notidianLegacyContextAudit.js:189-195` quotes identifiers and `:235-256` uses prepared statements.

## Improvement paths

1. Define a vault trust model for executable content: disabled by default, explicit trust prompt for frames/scripts, read-only `$api` unless elevated, and a migration path from JavaScript snippets to a constrained DSL.
2. Create one DOM safety boundary: sanitize custom SVG, sandbox all iframes, remove `dangerouslySetInnerHTML` from plain text fields, and require a named sanitizer for every remaining HTML sink.
3. Harden persistence plumbing: central SQL identifier quoting, prepared values, safe JSON parsing with typed errors, and visible diagnostics for skipped/corrupt context writes.