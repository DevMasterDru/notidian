// Tabbed hub view primitive — declaration parsing (ADR 0065 / Atlas ADR-0096
// H1, bd Notidian-pb7p.1). A hub folder note's frontmatter `tabs:` list
// declares the hub's ordered tab set. Pure functions only: classification,
// validation, active-tab resolution, and label/path derivation. The render
// seam (SpaceInner/HubTabsView) owns index lookups and persistence.

export type HubTabDeclaration = {
  id: string;
  page: string;
  name?: string;
};

// Single non-discriminated kinds (project compiles with strictNullChecks OFF —
// see notidianEmbed.ts for the precedent): `tabs` is set iff kind == "ok",
// `errors` iff kind == "error".
export type HubTabsParseResult = {
  kind: "none" | "ok" | "error";
  tabs?: HubTabDeclaration[];
  errors?: string[];
};

// Machine identity: stable lowercase slug, never derived from display names.
const HUB_TAB_ID = /^[a-z0-9-]+$/u;
const KNOWN_KEYS = new Set(["id", "page", "name"]);

const isMapping = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == "object" && !Array.isArray(value);

// Classification (ADR 0065 §2): only a non-empty array containing at least one
// mapping is a declaration ATTEMPT. Anything else — scalar, list of strings,
// empty list — is ordinary user frontmatter and renders the legacy space page
// with no banner. Within an attempt, validation is strict and fail-closed
// (ADR 0062 §6 posture): every violation is collected, nothing partial-applies.
export const parseHubTabsDeclaration = (
  value: unknown
): HubTabsParseResult => {
  if (!Array.isArray(value) || value.length == 0) return { kind: "none" };
  if (!value.some(isMapping)) return { kind: "none" };

  const errors: string[] = [];
  const tabs: HubTabDeclaration[] = [];
  const seenIds = new Set<string>();

  value.forEach((entry, index) => {
    if (!isMapping(entry)) {
      errors.push(`tab ${index + 1}: entry must be a mapping with id and page`);
      return;
    }

    for (const key of Object.keys(entry)) {
      if (!KNOWN_KEYS.has(key)) {
        errors.push(`tab ${index + 1}: unknown key "${key}"`);
      }
    }

    const rawId = entry.id;
    const id = typeof rawId == "string" ? rawId.trim() : null;
    if (id == null || id.length == 0) {
      errors.push(`tab ${index + 1}: id is required`);
    } else if (!HUB_TAB_ID.test(id)) {
      errors.push(
        `tab ${index + 1}: id "${id}" must be a lowercase slug (a-z, 0-9, -)`
      );
    } else if (seenIds.has(id)) {
      errors.push(`tab ${index + 1}: duplicate id "${id}"`);
    } else {
      seenIds.add(id);
    }

    const rawPage = entry.page;
    const page = typeof rawPage == "string" ? rawPage.trim() : null;
    if (page == null || page.length == 0) {
      errors.push(`tab ${index + 1}: page is required`);
    }

    const rawName = entry.name;
    let name: string | undefined;
    if (rawName != null) {
      if (typeof rawName != "string") {
        errors.push(`tab ${index + 1}: name must be text`);
      } else if (rawName.trim().length > 0) {
        name = rawName.trim();
      }
    }

    if (id != null && HUB_TAB_ID.test(id) && page != null) {
      const tab: HubTabDeclaration = { id, page };
      if (name != null) tab.name = name;
      tabs.push(tab);
    }
  });

  if (errors.length > 0) return { kind: "error", errors };
  return { kind: "ok", tabs };
};

// The persisted id survives only while it is still declared; otherwise the
// first declared tab is the default (ADR 0065 §6).
export const resolveActiveHubTab = (
  tabs: HubTabDeclaration[],
  persistedId: unknown
): string | null => {
  if (!tabs || tabs.length == 0) return null;
  if (
    typeof persistedId == "string" &&
    tabs.some((tab) => tab.id == persistedId)
  ) {
    return persistedId;
  }
  return tabs[0].id;
};

export const hubTabLabel = (tab: HubTabDeclaration): string => {
  if (tab.name != null && tab.name.length > 0) return tab.name;
  const basename = tab.page.split("/").pop() ?? "";
  const withoutExtension = basename.replace(/\.[^./]+$/u, "");
  return withoutExtension.length > 0 ? withoutExtension : tab.id;
};

// Page resolution candidates in priority order: hub-folder-relative first,
// then vault-absolute (ADR 0065 §1). The caller checks each against the live
// path index; no filesystem access here.
export const hubTabPageCandidates = (
  page: string,
  spacePath: string
): string[] => {
  const normalized = page.trim().replace(/^\.\//u, "").replace(/^\/+/u, "");
  const candidates: string[] = [];
  if (spacePath && spacePath.length > 0) {
    candidates.push(`${spacePath.replace(/\/+$/u, "")}/${normalized}`);
  }
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
  return candidates;
};
