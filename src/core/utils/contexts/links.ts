import { SpaceManager } from "core/spaceManager/spaceManager";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceProperty } from "shared/types/mdb";
import { parseLinkString } from "utils/parsers";
import { parseMDBStringValue } from "utils/properties";
import { serializeMultiString } from "utils/serializers";
import { parseMultiString } from "../../../utils/parsers";
import { shouldWriteAuthorityValueToFrontmatter } from "../properties/propertyAuthority";
//helpers for link types (context and link)

export const valueContainsLink = (link: string, value: string) => {
    return parseMultiString(value).some(f => link == parseLinkString(f))
  }
  export const replaceLinkInValue = (link: string, newLink: string, value: string) => {
    return serializeMultiString(parseMultiString(value).map(f => parseLinkString(f) == link ? newLink : f))
  }

  export const removeLinkInValue = (link: string, value: string) => {
    // Compare on parsed link identity (matching valueContainsLink), so wikilink
    // forms like "[[Old.md]]" are actually removed, not just detected.
    return serializeMultiString(parseMultiString(value).filter(f => parseLinkString(f) != link))
  }

  // Build the frontmatter-shaped payload for a single (link/context) column from
  // the rewritten row value.
  //
  // The row value produced by remove/replaceLinkInValue is ALWAYS a
  // serializeMultiString JSON array (the durable multi-string form). For a
  // `-multi` column parseMDBStringValue(frontmatter=true) maps over that array
  // and wraps each entry -> a clean wikilink array, which is correct.
  //
  // For a SINGULAR link/context column, however, parseMDBStringValue does NOT
  // take the `-multi` branch: it wraps the WHOLE string in `[[...]]`. Feeding it
  // the JSON-array string yields corrupt double-wrapped YAML, e.g.
  // `[[["New.md","Other.md"]]]`. A singular column holds one link, so we must
  // collapse the rewritten array to its sole entry's bare identity and let
  // parseMDBStringValue wrap that once -> `[[New.md]]`. (Defensive: if a singular
  // column somehow holds >1 value, keep the first — a singular frontmatter link
  // cannot represent a list.)
  export const frontmatterLinkPayload = (type: string, newValue: string) => {
    if (type.includes("-multi")) {
      return parseMDBStringValue(type, newValue, true);
    }
    const entries = parseMultiString(newValue);
    const single = entries.length > 0 ? parseLinkString(entries[0]) : "";
    return parseMDBStringValue(type, single, true);
  }

  export const rewriteCanonicalLinkPayload = (
    _type: string,
    liveValue: unknown,
    oldLink: string,
    newLink?: string,
  ): unknown => {
    if (liveValue === undefined || liveValue === null || liveValue === "") return liveValue;

    const rewriteEntry = (value: unknown): { matched: boolean; value: unknown } => {
      if (typeof value !== "string") return { matched: false, value };
      const wiki = value.match(/^\[\[([\s\S]*)\]\]$/);
      const inner = wiki ? wiki[1] : value;
      const aliasIndex = wiki ? inner.indexOf("|") : -1;
      const targetWithFragment = aliasIndex >= 0 ? inner.slice(0, aliasIndex) : inner;
      const alias = aliasIndex >= 0 ? inner.slice(aliasIndex) : "";
      const headingIndex = targetWithFragment.indexOf("#");
      const blockIndex = targetWithFragment.indexOf("^");
      const fragmentIndex = [headingIndex, blockIndex]
        .filter(index => index >= 0)
        .reduce((first, index) => Math.min(first, index), Number.POSITIVE_INFINITY);
      const hasFragment = Number.isFinite(fragmentIndex);
      const fileTarget = hasFragment ? targetWithFragment.slice(0, fragmentIndex) : targetWithFragment;
      const fragment = hasFragment ? targetWithFragment.slice(fragmentIndex) : "";
      if (fileTarget !== oldLink) return { matched: false, value };
      if (newLink === undefined) return { matched: true, value: "" };
      const rewritten = `${newLink}${fragment}${alias}`;
      return { matched: true, value: wiki ? `[[${rewritten}]]` : rewritten };
    };

    if (Array.isArray(liveValue)) {
      const rewritten = liveValue.map(rewriteEntry);
      return newLink === undefined
        ? rewritten.filter(entry => !entry.matched).map(entry => entry.value)
        : rewritten.map(entry => entry.value);
    }
    return rewriteEntry(liveValue).value;
  };

  export const linkColumns = (cols: SpaceProperty[]) => {
    return cols.filter(f => f.type.startsWith('link') || f.type.startsWith('context'))
  }

  export type CanonicalLinkWrite = {
    path: string;
    property: string;
    type: string;
    previous: unknown;
    next: unknown;
  };

  export type LinkRowRewritePlan = {
    row: DBRow;
    writes: CanonicalLinkWrite[];
  };

  const planLinksInRow = (
    row: DBRow,
    cols: SpaceProperty[],
    rewrite: (value: string) => string | undefined,
  ): LinkRowRewritePlan => {
    if (cols.length === 0) return { row, writes: [] };
    const writes: CanonicalLinkWrite[] = [];
    const deltaRow = cols.reduce<DBRow>((delta, col) => {
      const nextValue = rewrite(row[col.name]);
      if (nextValue === undefined) return delta;
      if (shouldWriteAuthorityValueToFrontmatter(col)) {
        writes.push({
          path: row[PathPropertyName],
          property: col.name,
          type: col.type,
          previous: frontmatterLinkPayload(col.type, row[col.name]),
          next: frontmatterLinkPayload(col.type, nextValue),
        });
      }
      return { ...delta, [col.name]: nextValue };
    }, {} as DBRow);
    return { row: { ...row, ...deltaRow }, writes };
  };

  export const planRemoveLinksInRow = (
    row: DBRow,
    link: string,
    cols: SpaceProperty[],
  ): LinkRowRewritePlan => planLinksInRow(
    row,
    cols,
    value => valueContainsLink(link, value) ? removeLinkInValue(link, value) : undefined,
  );

  export const planRenameLinksInRow = (
    row: DBRow,
    link: string,
    newLink: string,
    cols: SpaceProperty[],
  ): LinkRowRewritePlan => planLinksInRow(
    row,
    cols,
    value => valueContainsLink(link, value) ? replaceLinkInValue(link, newLink, value) : undefined,
  );

  const persistLinkWrites = async (manager: SpaceManager, writes: CanonicalLinkWrite[]) => {
    for (const write of writes) {
      const saved = await manager.saveProperties(write.path, { [write.property]: write.next });
      if (saved === false) throw new Error(`Failed to persist canonical link ${write.property} for ${write.path}`);
    }
  };

  export const removeLinksInRow = async (manager: SpaceManager, row: DBRow, link: string, cols: SpaceProperty[]) : Promise<DBRow> => {
    const plan = planRemoveLinksInRow(row, link, cols);
    await persistLinkWrites(manager, plan.writes);
    return plan.row;
  }

  export const renameLinksInRow = async (manager: SpaceManager, row: DBRow, link: string, newLink: string, cols: SpaceProperty[]) : Promise<DBRow> => {
    const plan = planRenameLinksInRow(row, link, newLink, cols);
    await persistLinkWrites(manager, plan.writes);
    return plan.row;
  }
