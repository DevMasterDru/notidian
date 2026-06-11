## Verdict

The happy-path rename architecture is mostly sound: title edits route to file renames, Obsidian’s backlink-aware rename API is used when the source file resolves, and successful table renames reconcile row order. The weak point is failure handling: adapter rename failures can be normalized to `null`, but the transaction helpers treat non-throwing calls as success, and bulk rename partial failures are not modeled precisely. Edge-case validation is also thinner than the architecture brief implies.

## Findings

### [SEV-high] Rename adapter can return `null` while transactions report success

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:415-430`
```ts
let finalPath = newPath;
try {
  if (file) {
    await this.plugin.app.fileManager.renameFile(file, newPath)
  } else {
    await this.plugin.app.vault.adapter.rename(path, newPath)
  }
} catch {
  finalPath = null;
}
return finalPath
```

Evidence: `src/core/utils/contexts/pageTitleRename.ts:455-481`
```ts
renamedPath = await superstate.spaceManager.renamePath(rename.oldPath, rename.newPath);
...
renamedPath ?? rename.newPath
...
return { ok: true, path: renamedPath ?? rename.newPath, changed: true };
```

Why it matters: a rejected filesystem/Obsidian rename can be surfaced as a successful page-title transaction. That violates “file path owns title” because the UI and undo journal can accept a path that was not actually created.

Suggested fix direction: make `renameFile` throw or return a typed `{ok:false}` result; in rename helpers, treat falsy/non-target returned paths as `rename-failed` and verify `pathExists(newPath)` before success/reconciliation.

Confidence: high. Cheapest confirmation: unit-test `renamePageTitleForRowWithResult` with `renamePath` resolving `null`.

### [SEV-high] Bulk rename partial failures leave real file changes but report zero applied writes

Evidence: `src/core/utils/contexts/pageTitleRename.ts:365-393`
```ts
for (const rename of tempRenames) {
  await superstate.spaceManager.renamePath(rename.oldPath, rename.tempPath);
  movedToTemp.push(rename);
}
for (const rename of tempRenames) {
  await superstate.spaceManager.renamePath(rename.tempPath, rename.newPath);
  movedToFinal.push(rename);
}
...
if (movedToFinal.some((moved) => moved.oldPath == rename.oldPath)) {
  continue;
}
...
failures: changedRenames.map((rename) => ({ ... reason: "rename-failed" }))
```

Evidence: `src/core/react/context/ContextEditorContext.tsx:875-885`
```ts
if (result.ok == false) {
  const failedRenameResult: TableEditTransactionResult = {
    ok: false,
    applied: 0,
    failed: fileWrites.map((write) => ({ write, reason: "file-rename-failed" })),
  };
  return failedRenameResult;
}
```

Why it matters: if the second phase fails after some files reached final names, those files are not rolled back, the table reports every rename failed, and no undo entry is pushed. A user can be left with renamed vault files and no table-level undo.

Suggested fix direction: track per-file state (`old`, `temp`, `final`), rollback final moves where possible, return partial applied/failed results, and reconcile from actual vault existence before reporting.

Confidence: high. Cheapest confirmation: mock bulk `renamePath` to throw after the first temp-to-final rename and inspect returned `applied` plus remaining file states.

### [SEV-high] Bulk reconciliation can manufacture rows for target paths not observed in the table

Evidence: `src/core/utils/contexts/pageTitleRename.ts:189-209`
```ts
const targetPath = renameMap.get(originalRow[PathPropertyName]) ?? originalRow[PathPropertyName];
const matchingIndex = table.rows.findIndex(... row[PathPropertyName] == targetPath);
...
return [
  ...nextRows,
  {
    ...originalRow,
    [PathPropertyName]: targetPath,
  },
];
```

Why it matters: after reload, if the target path is absent because the rename failed, raced with an external delete, or was not indexed, reconciliation still writes a context row with the target `File` path. That can create split-brain row identity in `.notidian` context state.

Suggested fix direction: only synthesize renamed rows after verifying the target file exists, or mark the rename as failed and preserve/reload the canonical row state.

Confidence: high. Cheapest confirmation: call `reconcileBulkContextRows` through `executeBulkPageTitleRename` with a reload table missing the target row.

### [SEV-medium] Filename validation is much narrower than available path sanitization

Evidence: `src/core/utils/contexts/pageTitle.ts:19-23`
```ts
const trimmed = title.trim();
if (trimmed.length == 0) return { ok: false, reason: "empty" };
if (trimmed.includes("/")) return { ok: false, reason: "slash" };
return { ok: true, title: trimmed };
```

Evidence: `src/shared/utils/sanitizers.ts:17-38`
```ts
const illegalRe = /[\/\?<>\\:\*\|":]/g;
const controlRe = /[\x00-\x1f\x80-\x9f]/g;
const reservedRe = /^\.+$/;
const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
```

Why it matters: backslashes, colons, control characters, dot-only names, Windows-reserved names, trailing-dot/space policy, and long-path limits are not deterministic preflight failures for table title edits. They fall through to filesystem behavior, where finding 1 can misreport failure as success.

Suggested fix direction: introduce a page-title validator that rejects rather than silently sanitizes, reusing the known illegal/reserved rules and adding explicit typed reasons.

Confidence: high. Cheapest confirmation: add unit cases for `CON`, `.`, `a:b`, `a\b`, control chars, trailing spaces/dots, and very long names.

### [SEV-medium] Unicode/case duplicate checks only lowercase, without normalization policy

Evidence: `src/core/utils/contexts/pageTitleRename.ts:149`
```ts
const normalizePathKey = (path: string): string => path.toLowerCase();
```

Evidence: `src/core/utils/contexts/pageTitleRename.ts:267-276`
```ts
const targetKey = normalizePathKey(rename.newPath);
if (targetKeys.has(targetKey)) {
  failures.push({ ... reason: "internal-duplicate" });
}
targetKeys.add(targetKey);
```

Why it matters: NFC/NFD-equivalent names and locale-sensitive case behavior are not normalized before internal duplicate detection. Hebrew/RTL and emoji names are likely fine at string level, but combining-character duplicates can pass or fail inconsistently depending on filesystem normalization.

Suggested fix direction: define a vault path comparison policy, probably NFC plus lowercase for case-insensitive mode, and test NFC/NFD, Hebrew, RTL punctuation, and emoji filenames.

Confidence: medium. Cheapest confirmation: unit-test two batch targets that differ only by composed/decomposed Unicode.

### [SEV-medium] Table feedback collapses typed rename failures to a generic reason

Evidence: `src/core/utils/contexts/pageTitleRename.ts:484-488`
```ts
const result = await renamePageTitleForRowWithResult(params);
return result.ok ? result.path : null;
```

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1048-1059`
```ts
ok: !!renamedPath,
applied: renamedPath ? 1 : 0,
failed: renamedPath ? [] : [{ write, reason: "file-rename-failed" }],
```

Evidence: `src/core/react/context/ContextEditorContext.tsx:875-885`
```ts
failed: fileWrites.map((write) => ({
  write,
  reason: "file-rename-failed",
})),
```

Why it matters: the transaction layer has typed reasons (`empty`, `slash`, `duplicate`, `rename-failed`), but direct and bulk table feedback often collapses them. Users cannot distinguish fixable duplicate/invalid names from real filesystem failure.

Suggested fix direction: have table callers consume `renamePageTitleForRowWithResult` and map bulk `failures` back to individual writes with precise reasons.

Confidence: high. Cheapest confirmation: attempt duplicate-name paste and inspect cell feedback reason.

### [SEV-low] Tests cover the main path but not the riskiest failure modes

Evidence: `src/core/utils/contexts/pageTitleRename.test.ts:78-112`
```ts
renamePath: jest.fn(async (): Promise<string> => {
  throw error;
})
```

Evidence: `src/core/utils/contexts/pageTitleRename.test.ts:403-450`
```ts
it("uses temporary paths when two files swap names", async () => { ... })
```

Why it matters: current tests cover thrown rename failures, duplicate rejection, swaps, and row-order reconciliation, but not adapter `null` returns, partial temp/final failures, case-only live behavior, Unicode normalization, or concurrent external delete/move.

Suggested fix direction: add focused unit tests for the missing failure states, then add one real-vault fixture for APFS case-only rename and batch partial failure recovery.

Confidence: high. Cheapest confirmation: compare the listed `it(...)` cases against the edge-case matrix in this brief.

## Swept clean

- Built-in `File` cells route to `PageTitleCell`; other file/link fields stay read-only link cells: `src/core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView.tsx:82-97`.
- File authority is recognized by column name, not by a frontmatter `title`: `src/core/utils/properties/propertyAuthority.ts:12-20`.
- Successful Obsidian-backed renames use `app.fileManager.renameFile` when the source resolves, so backlinks should be updated on the normal path: `src/adapters/obsidian/filesystem/filesystem.ts:417-425`.
- External Obsidian rename events flow through cache update and `onPathRename`: `src/adapters/obsidian/filesystem/filesystem.ts:293-310`, `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:845-852`.
- `onPathRename` rewrites context rows before reloading the new path, matching ADR 0003’s ordering requirement: `src/core/superstate/superstate.ts:627-638`.
- Direct and bulk successful rename tests cover row-order preservation and duplicate-row removal: `src/core/utils/contexts/pageTitleRename.test.ts:195-304`, `src/core/utils/contexts/pageTitleRename.test.ts:453-513`.
- Undo captures the expected post-rename path for immediate title undo: `src/core/utils/contexts/tableUndoJournal.ts:107-116`, tested at `src/core/utils/contexts/tableUndoJournal.test.ts:143-182`.

## Improvement paths

1. Make rename APIs typed and strict end-to-end: no swallowed `null`, post-rename existence checks, precise failure reasons in table feedback.
2. Replace bulk rename with a small state-machine transaction: preflight temp paths, track per-file state, rollback all reachable states, and return partial success accurately.
3. Add a path edge-case test matrix: APFS case-only, NFC/NFD, Hebrew/RTL, emoji, dots, Windows-reserved names, illegal characters, trailing spaces/dots, and long paths.