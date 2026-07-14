---
type: stream-packet
substrate: packet
context_class: truth
stream: topic-hub
title: Topic Hub Follow Ons
slug: topic-hub
status: active
pointers:
  - type: repo-doc
    key: docs/current-state.md
    resolver: read the Notidian Database Embeds section and its implementation-map entries
    why: current shipped embed and read-only overlay behavior
  - type: external-decision
    key: Atlas Method ADR 0066
    resolver: read docs/decisions/0066-topic-hub-standard.md in the Atlas Method repo
    why: owner-ratified Topic Hub contract
  - type: code-symbol
    key: src/core/utils/embeds/notidianEmbed.ts
    resolver: inspect the live parser and descriptor types
    why: canonical embed grammar boundary
load_docs:
  - path: docs/current-state.md
    section: Notidian Database Embeds
    why: shipped behavior and authority boundary
refs:
  - docs/adr/README.md
provenance:
  created: 2026-07-14
  updated: 2026-07-14
  by: Codex work graph reoptimization
---

# Topic Hub Follow Ons

## Scope

Finish the owner-ratified Topic Hub view-projection surface after the shipped
`where:` overlay. This stream owns folder-note overlay declarations, schema-aware
overlay tokens, the manual relative-date editor, the month-boundary decision, and
the outward capability summary. It does not own durable saved-view materialization;
that remains behind the Data Integrity Wave 3 write firewall.

## Key facts

- The shipped `where:` overlay is conjunctive, read-path only, and protected by the
  `renderPathViewOverlays` kill-switch — `docs/current-state.md`.
- Schema-aware sort and column restrictions require target-schema resolution; the
  pure descriptor parser cannot safely infer them — bead `Notidian-lhiq`.
- Owner-value choices remain judgment gates, not implementation assumptions — repo
  `AGENTS.md` ratify-before-record rule.

## Ruled out

- Persisting render overlays into the source view — violates the shipped write
  firewall and duplicates durable-view materialization owned by `Notidian-batd`.

## Links

- **Work graph:** epic `Notidian-uupm`; issue bodies are the binding session briefs.
- **Decisions:** [ADR index](../adr/README.md) plus Atlas Method ADR 0066.
- **Current implementation:** [current state](../current-state.md).
