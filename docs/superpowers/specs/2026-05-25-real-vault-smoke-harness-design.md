# Real Vault Smoke Harness Design

## Goal

Add an opt-in smoke harness that runs against a live Obsidian vault and verifies the real APIs Notidian depends on for source-of-truth table behavior.

The harness is not a replacement for unit tests. It covers the gap unit tests cannot cover well: Obsidian plugin reloads, metadata-cache timing, frontmatter persistence, file rename behavior, and developer error capture inside a real vault.

## Non-Goals

- Do not mutate a user's vault unless explicitly allowed.
- Do not run the live-vault harness as part of default `npm test`.
- Do not require a particular personal vault.
- Do not implement browser-level table UI automation in this phase.
- Do not create a hidden Notidian data authority layer for test fixtures.

## Safety Model

The harness requires a target vault and an explicit write flag before it creates files.

It writes only under a namespaced fixture folder:

```text
Notidian Integration Fixtures/<run-id>
```

The run id includes a timestamp so concurrent or failed runs do not collide.

The harness should clean up fixture files by default. A `--keep-fixture` option keeps the folder for manual inspection after a failure.

## Scenario

The first scenario is a source-of-truth smoke test:

1. Verify the Obsidian CLI can target the selected vault.
2. Reload the `notidian` plugin.
3. Clear captured developer errors.
4. Create two Markdown fixture notes with frontmatter.
5. Read Obsidian's metadata cache for one fixture until the expected frontmatter value is visible.
6. Set a property through Obsidian's property API.
7. Verify the updated value through both `property:read` and metadata cache polling.
8. Rename one fixture file.
9. Verify the renamed file still carries the updated frontmatter value.
10. Check captured developer errors.
11. Delete fixture files unless `--keep-fixture` is set.

This scenario proves the live vault can support the same primitive operations Notidian's table transaction layer depends on: frontmatter writes become canonical metadata, renames settle, and plugin reloads do not produce captured errors.

## Command Shape

Package script:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```

Supported options:

```text
vault=<vault name>             Required unless NOTIDIAN_REAL_VAULT is set.
--allow-write                  Required before creating fixtures.
--keep-fixture                 Leave fixtures in the vault for inspection.
--plugin-id=<id>               Defaults to notidian.
--fixture-root=<folder>        Defaults to Notidian Integration Fixtures.
--timeout-ms=<milliseconds>    Defaults to 10000.
```

Environment fallback:

```bash
NOTIDIAN_REAL_VAULT="Atlas Vault" npm run test:real-vault -- --allow-write
```

## Test Strategy

Unit tests cover the harness without requiring Obsidian:

- Argument parsing.
- Safety gating when vault or write approval is missing.
- Fixture path construction.
- Obsidian command construction.
- Metadata polling retry behavior.
- Cleanup behavior for normal and keep-fixture runs.

The live scenario is opt-in and is verified manually through the package script.

## Future Extension Points

After this phase, add scenarios for:

- Notidian table view opening and DOM-level checks.
- Frontmatter conflict detection against live metadata-cache timing.
- Paste, rename, and undo through the table UI.
- Legacy Make.md context migration dry runs.
