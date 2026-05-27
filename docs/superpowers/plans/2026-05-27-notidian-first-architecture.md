# Notidian-First Architecture Implementation Plan

> **Superseded:** Do not execute this plan for current work.
> [ADR 0014](../../adr/0014-notidian-only-personal-database-engine.md)
> now governs Notidian as a personal Notidian-only database engine. Use
> [Notidian-only personal core plan](2026-05-27-notidian-only-personal-core.md)
> instead.

## Historical Summary

This plan captured the intermediate strategy between Bases-first convergence and
the current Notidian-only architecture. It kept the correct canonical data
lessons:

- Markdown files are rows.
- File paths and basenames own page identity.
- Ordinary properties are frontmatter-backed.
- Table edits must use authority-aware transactions.
- Legacy Make.md context values need audit-first migration.

The plan also kept native Bases compatibility as an optional pillar. That part
is no longer valid for the personal Notidian system. ADR 0014 removed native
Bases from the active architecture, retired the runtime experiment, and directs
future effort toward Notidian's own table engine.

## What To Preserve

Preserve the work that directly serves Notidian:

- canonical frontmatter-backed folder tables;
- file-title rename transactions;
- range copy, cut, paste, fill, and clear;
- stale-frontmatter conflict handling;
- table-local undo through authority-aware write paths;
- read-only legacy context audit and migration planning;
- real-vault smoke testing for Notidian table behavior.

## What Not To Reuse

Do not use this plan to reintroduce native Bases compatibility, native Bases
commands, native Bases runtime registration, or deleted runtime source paths.

Any future native Bases work must start as a new explicit feature proposal and
must not be treated as dormant Notidian architecture.

## Current Execution Path

Follow the active Notidian-only roadmap:

1. Complete context-backed table redo.
2. Add authority-aware schema create, rename, and delete flows.
3. Add row create, delete, and move transactions.
4. Add richer conflict merge UI.
5. Add opt-in legacy Make.md write migration.
6. Profile Atlas Vault folder performance.

The detailed executable plan is
[2026-05-27-notidian-only-personal-core.md](2026-05-27-notidian-only-personal-core.md).
