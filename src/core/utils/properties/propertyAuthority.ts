import { PathPropertyName } from "shared/types/context";
import { SpaceProperty } from "shared/types/mdb";

export type PropertyAuthority =
  | "file"
  | "frontmatter"
  | "notidian"
  | "computed";

// Kept private to avoid a duplicate public export of the constant that
// allProperties.ts already owns (importing it here would create a cycle).
const frontmatterSource = "frontmatter";
export const notidianPropertySource = "notidian";

// Computed/read-only column types: their value is derived at render time and
// must never be persisted from a paste/undo into the context table. rollup
// (8pl) and backlink (ahk) are computed like fileprop/aggregate.
// IMPORTANT: any NEW computed/read-only column type MUST be added here, or the
// write pipeline treats it as durable data and a paste/undo persists a fake
// value into the context MDB (bd memory: any-new-computed-read-only-column-type).
const computedTypes = new Set(["fileprop", "aggregate", "rollup", "backlink"]);

// Types that have a native file-backed (frontmatter) representation. An
// authority-ambiguous column (no `source` marker) of one of these types
// defaults to the durable FILE layer rather than silently becoming MDB-owned.
// Context-only types (context / object / flex / super / ...) have no frontmatter
// form, so a source-less column of those types stays Notidian-owned — the MDB is
// its only durable home. Keep aligned with propertyTypeMenu.frontmatterTableTypes
// (the UI picker's frontmatter-compatible set); this set additionally includes
// `password`, which is always stored as plain frontmatter (see current-state.md).
const frontmatterStorableTypes = new Set([
  "text",
  "password",
  "number",
  "boolean",
  "date",
  "option",
  "option-multi",
  "link",
  "image",
  "tags-multi",
]);

// Resolve which storage layer durably owns a column's row VALUE.
//
// The fork's core promise (ADR 0001) is that file-backed data must never
// silently become governed by the hidden context MDB: Notidian-ownership of a
// row value MUST be explicit. This function therefore never falls back to
// "notidian" for ordinary, file-backed-compatible metadata. A missing/lost
// `source` marker on such a column resolves to "frontmatter" (the visible,
// portable default) — it cannot leak into the hidden store. Durable MDB
// ownership is granted only when it is explicit (`source: "notidian"`, the
// "Notidian-owned field" choice) or when the type is context-only and has no
// frontmatter representation at all. See ADR 0017 and bd Notidian-2j3.
export const propertyAuthorityForColumn = (
  property?: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): PropertyAuthority => {
  if (property?.name === PathPropertyName) return "file";
  if (property?.source === frontmatterSource) return "frontmatter";
  if (property?.type && computedTypes.has(property.type)) return "computed";
  // Explicit Notidian ownership.
  if (property?.source === notidianPropertySource) return "notidian";
  // Ambiguous (no source marker): ordinary file-backed metadata is frontmatter
  // by default and must never silently flip into the hidden store. Only
  // context-only types (no frontmatter representation) remain Notidian-owned.
  if (property?.type && frontmatterStorableTypes.has(property.type))
    return "frontmatter";
  return "notidian";
};

export const shouldWriteAuthorityValueToFrontmatter = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): boolean => {
  const authority = propertyAuthorityForColumn(property);
  return authority === "frontmatter";
};

export const shouldPersistAuthorityValueToContext = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): boolean => {
  const authority = propertyAuthorityForColumn(property);
  return authority === "file" || authority === "notidian";
};
