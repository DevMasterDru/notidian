# Password Field Kind (Notidian-k6e)

Date: 2026-06-12
Bead: Notidian-k6e
Status: approved by user (interactive brainstorm, this session)

## Problem

Atlas Method ADR-0009: credential values live in Notidian rows (Infrastructure
database, credential-reference kind, `secret: {kind: password}`). Notidian has
no masked field kind, so secrets render as plain text cells.

**Threat model (explicit, per ADR-0009): masking is a UI concern, not
encryption.** Values are stored as plain frontmatter in the vault; the
vault-local threat model is accepted. The kind prevents shoulder-surfing and
accidental on-screen exposure, nothing more.

## Decisions (user-approved)

1. **Reveal UX:** masked dots by default (fixed-length, no length leak); eye
   icon toggles reveal; auto-rehide when the pointer leaves the cell, on
   Escape, and when the cell unmounts/edit ends. Copy icon copies the real
   value to the clipboard without revealing it.
2. **First-class column type:** `password` appears in the property-type menu
   like text/select/date; Type Profile `kind: password` now maps to the
   `password` column type (replacing the 5qr text fallback).
3. **Range/TSV copy keeps real values** — clipboard writes are deliberate
   user actions, same trust as the per-cell copy button. Display is masked
   everywhere; the clipboard is not display.

## Design

- `PasswordCell.tsx` in `DataTypeView/`: view mode renders fixed dots (or
  empty for no value) + hover eye/copy buttons; edit mode is a real
  `<input type="password">` (typing is masked; eye toggles input type),
  Enter/blur saves, Escape cancels. No `dangerouslySetInnerHTML`.
- `fieldTypes` registry: `{ type: "password", metadata: true, primative: true,
  icon: 'ui//lock' }` + i18n label/description noting masking ≠ encryption.
- `DataTypeView` dispatch branch for `password`.
- `typeProfile.ts`: `kindToTypeMap.password = "password"`;
  `typeProfileKindForType("password") == "password"`.
- CSS: `mk-cell-password` (dots + icon buttons, icons hidden until hover).
- No-echo audit: cell never logs values; undo journal stores values (required
  for undo) but never prints them; edit feedback styles cells without
  rendering raw values.

## Testing

- Jest: typeProfile password mapping round-trip (kind→type→kind).
- Gates: full Jest, tsc, build, live health audit.
- Live: Infrastructure-style sandbox column renders dots, eye reveals,
  copy copies, edit input masked.

## Out of scope

- Encryption/keychain storage; `kind_fields` per-kind hub sub-schemas
  (credential-reference parsing) — Type Profile v2 follow-up.
