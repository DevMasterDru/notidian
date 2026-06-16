# Notidian Roadmap (pull when wanted)

These are speculative product features the owner has **not** requested. Nothing
here is built on a schedule or "because it's queued" — each item is built **only
when the owner asks for it**. The linked ADR is the grounding (context, options,
and a recommendation already worked out) so that, when pulled, the build starts
from a settled design rather than a blank page.

## Parked — build when the owner asks

- **Select-to-comment + AI-review channel** — anchor a vault comment to a selection (block-id `^block`) and store AI-directed comments as a frontmatter `review.comments` list; cross-repo contract with Atlasidian. — ([ADR 0019](adr/0019-select-to-comment-anchoring-and-ai-review-channel.md))
- **Date reminders + recurring events** — in-app Notice reminders for due dates and rrule-shaped `repeat` recurrence expanded at render time (no external plugin, no generated rows). — ([ADR 0020](adr/0020-date-reminders-and-recurring-events.md))
- **Frame-execution settings toggle + trusted-frame allowlist** — a UI toggle for `hardenFrameExecution` plus a non-persisted, user-blessed way to re-trust a custom frame's `$api`; only relevant once frame-hardening is kept ON. — ([ADR 0022](adr/0022-frame-execution-settings-toggle-and-trusted-frame-allowlist.md))
- **Type Profile hub-deletion notice** — surface when a folder DB's Type Profile hub note is deleted out from under it (ADR's own recommendation is to decline; low-value P3). — ([ADR 0023](adr/0023-type-profile-hub-deletion-notice.md))
- **Sub-items + back-relations creation UX** — a row-context "Add sub-item" action and the one-way-vs-two-way link-write contract for nesting rows (engine already shipped; this is the creation gesture). — ([ADR 0024](adr/0024-sub-items-back-relations-ux.md))
- **Per-database row-create templates in the table** — honor a database's default `.md` template when adding a row from the table/context (not just the sidebar `+`), seeding frontmatter + body. — ([ADR 0028](adr/0028-per-database-row-create-templates.md))
- **Frontmatter-link relations + rollups UX polish** — a passive "N of M counted / K unresolved" indicator on rollup cells so a partial aggregate is honest (engine + cell + config already shipped). — ([ADR 0029](adr/0029-frontmatter-relations-rollups-authority-ux.md))
- **Control-byte source guard** — CI/lint regression insurance that blocks raw NUL/C0 control bytes from re-entering tracked source (repo is currently clean; this is prevention, not a fix). — ([ADR 0039](adr/0039-control-byte-source-guard.md))
