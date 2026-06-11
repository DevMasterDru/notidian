## Verdict

CONFIRMED

## Trace

`predicate.groupBy` is stored as `string[]`: `src/shared/types/predicate.ts:10-22`. The group picker saves string keys from `f.name + f.table`: `src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx:1095-1100`, via `saveGroupBy(... groupBy)` at `src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx:823-827`.

`ContextEditorContext` builds `cols` as `SpaceTableColumn[]` objects, adding `table`: `src/core/react/context/ContextEditorContext.tsx:499-518`, then provides `cols` and `predicate`: `src/core/react/context/ContextEditorContext.tsx:1421-1437`.

`ContextListView` resolves the string predicate key back to the full column object:

`src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx:78-81`

It uses `groupBy.name + groupBy.table` only for reading row values/grouping: `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx:101-104`, `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx:151-152`.

There is no separate `ContextListGroup` component. The group is a `ContextListInstance type="listGroup"` and receives `_groupField: groupBy` unchanged: `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx:320-332`. Each dragged item also receives `_groupField: groupBy` unchanged: `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx:371-385`.

The kit schema treats `_groupField` as an object. It uses `.name` only for new-item creation, not drag persistence: `src/schemas/kits/list.ts:1478-1485`, `src/schemas/kits/list.ts:1513-1518`; column layout repeats this at `src/schemas/kits/list.ts:1535-1542`, `src/schemas/kits/list.ts:1583-1587`.

`ContextListInstance` puts `props.props` directly into DnD data with no normalization: `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListInstance.tsx:88-97`. On drag end it calls `dropListItem`: `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListInstance.tsx:121-128`.

Primary/default-context branch:

`src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListInstance.tsx:232-245`

On group mismatch, it calls:

```ts
saveProperties(props.superstate, activePath, {
  [props.props?._groupField]: props.props?._groupValue,
});
```

Since `_groupField` is the full column object, the YAML/frontmatter key string is exactly `[object Object]`.

Non-primary branch:

`src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListInstance.tsx:255-266`

It passes the same object as `field` into `updateTableValue`. That helper uses `[field]: value`: `src/core/utils/contexts/context.ts:185-203`. The MDB/table row column written is also exactly `[object Object]`.

Persistence path for the frontmatter branch is direct and ungated: `saveProperties` delegates to `spaceManager.saveProperties`: `src/core/superstate/utils/spaces.ts:563-568`; `SpaceManager` delegates to the adapter: `src/core/spaceManager/spaceManager.ts:358-362`; filesystem adapter merges the properties object: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:759-762`; markdown adapter writes `Object.keys(newFrontmatter)` into Obsidian frontmatter: `src/adapters/obsidian/filetypes/markdownAdapter.ts:473-486`.

## Evidence

No repro test created, per the finding-specific instruction that the static trace is decisive.

Computed-key sanity check output:

```text
[object Object]
{"[object Object]":"Done"}
```

Conflict detection exists in the normal table transaction path: `src/core/utils/contexts/tableEditTransaction.ts:241-262`. This drag path does not call that helper; it calls `saveProperties` / `updateTableValue` directly.

## Severity check

Original SEV-critical holds for primary/default file-backed contexts: a normal cross-group drag can add a garbage `[object Object]` YAML key to the dragged Markdown file, with no conflict detection. The non-primary path also corrupts the context table row with `[object Object]`, but the vault-frontmatter corruption is the critical part.

## Fix sketch

Use the column’s canonical key before writing: `const groupField = props.props?._groupField?.name`.

Do not blindly write all grouped drops to frontmatter. Route by authority/table: root frontmatter-backed field through the existing authority-aware transaction helper; context-owned/linked fields through the appropriate context table update.

Add a guard that refuses group drag persistence unless `_groupField` resolves to a valid `SpaceTableColumn` and writable authority.

Next step: approve implementing the fix and a focused regression test for cross-group drag key resolution.