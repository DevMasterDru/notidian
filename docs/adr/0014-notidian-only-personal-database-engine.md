# ADR 0014: Notidian-Only Personal Database Engine

## Status

Accepted.

Supersedes ADR 0013 as the current strategic architecture. ADR 0013 remains useful for the canonical file/frontmatter authority model, but its optional Bases compatibility pillar is no longer part of the target system.

## Date

2026-05-27

## Context

Notidian is a personal tool for Atlas Vault, not a general product. The primary user does not want native Obsidian Bases as a database UI or compatibility target.

The earlier Bases work was useful research. It proved that file rows, frontmatter-backed properties, `file.name` rename semantics, conflict handling, and authority-aware writes were the right direction. It also showed the cost of continuing to design around native Bases:

- extra runtime registration;
- extra commands and smoke harness flags;
- a second database vocabulary in the docs;
- AI skill ambiguity about when to use Notidian versus Bases;
- roadmap items for `.base` import, mirroring, and custom-view parity that do not serve the personal workflow.

For this tool, simplicity and Notidian quality outrank native Bases interoperability.

## Decision

Adopt a Notidian-only personal database engine.

The governing contract is:

- Notidian is the only intended database engine and interface.
- Markdown files are rows.
- File paths and basenames own page identity.
- Markdown frontmatter owns ordinary editable properties.
- Notidian context MDB stores view state, UI preferences, legacy Make.md state, explicit Notidian-owned fields, and advanced Notidian behavior.
- Native Bases is not a runtime dependency, product surface, compatibility pillar, or roadmap target.
- `.base` import, mirroring, export, and custom Bases view parity are removed from the active roadmap.
- AI agents should not use Bases for Atlas Vault databases unless the user explicitly asks to inspect or convert a `.base` file.

This is not a return to a hidden Make.md-style parallel database. It is a return to the pre-Bases architectural direction with the later safety lessons preserved.

## What Carries Forward

Keep the work that directly improves Notidian:

- frontmatter-backed folder tables;
- editable page titles through file rename transactions;
- range copy, cut, paste, fill, and clear;
- authority-aware value transactions;
- stale frontmatter conflict detection;
- inline edit feedback;
- undo/redo through canonical write paths;
- legacy Make.md context audit and migration planning;
- real-vault smoke tests for Notidian table behavior.

## What Is Removed Or Retired

Remove active Bases surfaces:

- custom Bases view registration;
- `.base` export command;
- `.base` adapter source and tests;
- custom Bases view source and tests;
- real-vault harness `--base-export` and `--base-view` flags;
- active docs that present Bases compatibility as part of the Notidian system.

Keep historical ADRs for context, but mark them superseded or amended by this ADR.

## Why This Is Better For A Personal Tool

Product interoperability is valuable when shipping to many users. It is less valuable when the tool has one primary workflow and one primary vault.

For Atlas Vault, Bases compatibility creates more cost than benefit:

- it does not improve daily table editing;
- it can confuse source-of-truth decisions;
- it consumes implementation time that should go into Notidian's own table engine;
- it keeps another database UI concept alive even though the user does not want to use it.

The simpler system is easier to reason about:

```text
Notidian table UX
  -> Notidian transaction planner
  -> Markdown file path or frontmatter write
  -> Obsidian metadata refresh
  -> Notidian projection refresh
```

There is no native Bases branch in that path.

## Consequences

Positive consequences:

- The codebase has less active runtime surface.
- The documentation has one database architecture.
- AI agents default to Notidian for database work in Atlas Vault.
- Future effort goes to Notidian quality: schema operations, row creation/deletion/move, conflict merge, performance, and legacy migration.
- The native Bases plugin can remain disabled in the vault.

Tradeoffs:

- Notidian no longer offers `.base` export/import as a built-in escape hatch.
- If the user later wants native Bases compatibility, it should be implemented as a new explicit feature, not as a dormant pillar.
- Historical Bases tests and code are removed, so reintroducing compatibility later will require fresh design and verification.

## Invariants

Future work must preserve these rules:

- No ordinary Notidian database feature may depend on native Bases.
- No active Notidian command should create `.base` files by default.
- No startup path should register a custom Bases view.
- Notidian docs and skills should not pair Notidian with Bases automatically.
- Ordinary data remains canonical in Markdown files, file paths, and frontmatter.
- Context MDB must not silently own ordinary frontmatter-backed values.
- Legacy Make.md values must still be audited before migration or cleanup.

## Relationship To Other ADRs

- ADR 0001 remains the source-of-truth model.
- ADR 0002 remains the frontmatter-backed column rule.
- ADR 0003 remains the page-title rename transaction record.
- ADR 0010 remains the legacy context audit and migration rule.
- ADR 0011 is historical Bases-first context and is superseded.
- ADR 0012 is retired as an implementation path; custom Bases view registration is removed.
- ADR 0013 is superseded as the strategy but remains useful for the canonical file authority reasoning.
