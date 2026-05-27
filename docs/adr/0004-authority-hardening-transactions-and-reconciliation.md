# ADR 0004: Authority Hardening Transactions And Reconciliation

## Status

Accepted historical context.

The hardening decisions remain valid, but later focused ADRs now own the active operational rules:

- [ADR 0003](0003-editable-page-titles-through-file-renames.md) for page-title rename transactions;
- [ADR 0006](0006-unified-table-edit-transactions.md) for shared value write transactions;
- [ADR 0009](0009-frontmatter-conflict-detection.md) for stale frontmatter detection;
- [ADR 0015](0015-canonical-schema-planning.md) for frontmatter schema planning.

Treat this record as the phase record for why the authority hardening work happened, not as the active implementation map.

## Date

2026-05-24

## Context

After introducing frontmatter-backed columns and editable page titles, the architecture still needed hardening. The main model was correct, but several edge cases could still erode the authority boundary:

- A frontmatter write could fail while a context row update still persisted.
- A computed or projected value could be stored as if it were durable context data.
- Frontmatter type inference could choose an unsafe type based on first-seen data.
- Rename metadata races could leave duplicate renamed rows.

These issues matter because the fork's core value is governance clarity. A system that mostly writes to frontmatter but occasionally saves a failed edit into MDB would still be untrustworthy.

## Decision

Add explicit authority and transaction helpers.

The hardening phase introduced:

- A property authority registry.
- A frontmatter write helper that treats `false`, `undefined`, and thrown errors as failed writes.
- Context edit paths that return early when frontmatter writes fail.
- Conservative type reconciliation for conflicting frontmatter values.
- Rename reconciliation that preserves row order and removes duplicate renamed rows.

## Authority Registry

Columns are classified as:

- `file`: file identity such as `File`.
- `frontmatter`: ordinary note properties with `source: "frontmatter"`.
- `notidian`: explicitly context-owned fields.
- `computed`: formula, aggregate, and file-property projection values.

This lets Notidian answer two critical questions consistently:

1. Should a cell edit write to frontmatter?
2. Should a row value be persisted into context MDB storage?

## Frontmatter Write Transactions

Frontmatter writes now go through `saveFrontmatterProperties`.

The helper returns success only when `spaceManager.saveProperties` confirms `true`. A returned `false`, a returned `undefined`, or an exception is treated as failure.

When the write fails, Notidian notifies the user and stops the context update. This prevents a failed canonical write from being masked by a successful context save.

## Type Reconciliation

When discovering frontmatter properties across multiple files, Notidian now observes all mapped types for a key. If the observed types conflict, the column type becomes `text`.

This is intentionally conservative. A text column can safely display mixed values; a numeric/boolean/date editor can corrupt or reject data that does not match the inferred type.

## Rename Reconciliation

The previous page-title rename implementation already preserved row order after metadata sync. The hardening phase added duplicate removal.

If metadata sync leaves multiple rows for the renamed path, Notidian keeps one row, removes the duplicates, and inserts the retained row at the original index.

## Alternatives Considered

### Rely On Existing Save Calls

Rejected.

The existing paths awaited writes, but awaiting is not enough. The caller must also know whether the write actually succeeded.

### Store Projected Values For Performance

Rejected for frontmatter and computed data as durable storage.

Projected values can exist in memory for rendering, but saving them as durable context row values weakens the authority model.

### Preserve First-Seen Type Inference

Rejected.

First-seen inference is unstable. Folder order should not decide whether a property becomes a number, date, boolean, or text.

## Consequences

Positive consequences:

- Failed frontmatter writes no longer create accepted context edits.
- Computed/projected values are less likely to become stale durable data.
- Mixed-type frontmatter is safer.
- Rename races are less likely to leave duplicate rows.

Tradeoffs:

- Some context saves now stop when canonical writes fail.
- Some inferred columns become `text` even if most values look numeric.
- The authority registry must be kept current as new column types are introduced.

## Implementation Notes

Key files:

- `src/core/utils/properties/propertyAuthority.ts`
- `src/core/utils/properties/frontmatterWrite.ts`
- `src/core/utils/properties/allProperties.ts`
- `src/core/react/context/ContextEditorContext.tsx`
- `src/core/utils/contexts/pageTitleRename.ts`

The implementation was committed in the authority-hardening phase ending at commit `0a67060`.

## Follow-Up Work

Current gaps are tracked in [Current State](../current-state.md).

Historical follow-ups from this phase have mostly moved into later focused records:

- The higher-level value transaction path is covered by [ADR 0006](0006-unified-table-edit-transactions.md).
- External edit conflict reporting is covered by [ADR 0009](0009-frontmatter-conflict-detection.md).
- Real-vault verification is covered by [Real Vault Smoke Harness](../real-vault-smoke-harness.md).
