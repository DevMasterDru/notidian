---
type: stream-packet
substrate: packet
context_class: truth
stream: feature-finalization
title: Feature Finalization
slug: feature-finalization
status: active
pointers:
  - type: repo-doc
    key: docs/adr/0019-select-to-comment-anchoring-and-ai-review-channel.md
    resolver: read the Status, Context, and recommended anchor and payload sections
    why: cross-repo commenting contract and prior design work
  - type: repo-doc
    key: docs/adr/0020-date-reminders-and-recurring-events.md
    resolver: read the Status, current machinery, and chosen delivery sections
    why: reminder and recurrence grounding
  - type: code-symbol
    key: src/core/superstate/utils/spaces.ts filterTreeByQuery
    resolver: inspect the live navigator filter and its synchronous index boundary
    why: bedrock for optional full-text matching
  - type: repo-doc
    key: docs/adr/0063-navigator-content-search-derived-worker-index.md
    resolver: read the Decision and S5 Implementation Brief
    why: binding content-index, freshness, fallback, and performance contract
load_docs:
  - path: docs/adr/0019-select-to-comment-anchoring-and-ai-review-channel.md
    section: Context
    why: editor and Atlasidian boundary
  - path: docs/adr/0020-date-reminders-and-recurring-events.md
    section: Context
    why: reminder and recurrence bedrock
refs:
  - docs/adr/README.md
provenance:
  created: 2026-07-14
  updated: 2026-07-17
  by: Codex work graph reoptimization
---

# Feature Finalization

## Scope

Complete the remaining owner-pulled standalone features that are too large or too
design-sensitive to execute as flat ready leaves: select-to-comment, navigator
content search, and reminders plus recurring-event authoring. Each lane starts with
a judgment session and proceeds to implementation only after its contract is
cold-startable. Topic Hub, frame trust, and Data Integrity remain separate streams.

## Key facts

- Select-to-comment crosses two repos: Notidian owns the editor affordance and
  file-canonical anchor; Atlasidian consumes AI-review comments — ADR 0019.
- Recurrence already renders from an RRule-shaped definition, while reminder
  scheduling is greenfield and must avoid repeat notifications — ADR 0020.
- Navigator name and path filtering remains synchronous. Content matching uses
  the separate ephemeral worker index accepted in ADR 0063; it supplies only an
  additional path set to the existing ancestor-revealing tree and never reads a
  note body in response to a keystroke.

## Ruled out

- One implementation session spanning all three features — unrelated working sets
  and owner judgments would exceed a safe context window and obscure acceptance.

## Links

- **Work graph:** epic `Notidian-tluq`; issue bodies are binding briefs.
- **Decisions:** [ADR index](../adr/README.md).
- **Architecture:** [current state](../current-state.md).
