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
  const frontmatterLinkPayload = (type: string, newValue: string) => {
    if (type.includes("-multi")) {
      return parseMDBStringValue(type, newValue, true);
    }
    const entries = parseMultiString(newValue);
    const single = entries.length > 0 ? parseLinkString(entries[0]) : "";
    return parseMDBStringValue(type, single, true);
  }

  export const linkColumns = (cols: SpaceProperty[]) => {
    return cols.filter(f => f.type.startsWith('link') || f.type.startsWith('context'))
  }


  export const removeLinksInRow = (manager: SpaceManager, row: DBRow, link: string, cols: SpaceProperty[]) : DBRow => {
    if (cols.length == 0) {
      return row;
    }
    const deltaRow = cols.reduce((p, c) => {
      if (valueContainsLink(link, row[c.name])) {
        const newValue = removeLinkInValue(link, row[c.name]);
        // Only frontmatter-backed columns may write to the Markdown file.
        // Notidian-owned (context/relation) columns update the row delta so the
        // caller can persist them through context-table persistence instead.
        if (shouldWriteAuthorityValueToFrontmatter(c)) {
          manager.saveProperties(row[PathPropertyName], {[c.name]: frontmatterLinkPayload(c.type, newValue)})
        }

      return {...p, [c.name]: newValue}
     }
     return p
    }, {})
    return {...row, ...deltaRow}
  }

  export const renameLinksInRow = (manager: SpaceManager, row: DBRow, link: string, newLink: string, cols: SpaceProperty[]) : DBRow => {
    if (cols.length == 0) {
      return row;
    }
    const deltaRow = cols.reduce((p, c) => {
      if (valueContainsLink(link, row[c.name])) {
        const newValue = replaceLinkInValue(link,newLink, row[c.name]);
        // Only frontmatter-backed columns may write to the Markdown file.
        // Notidian-owned (context/relation) columns update the row delta so the
        // caller can persist them through context-table persistence instead.
        if (shouldWriteAuthorityValueToFrontmatter(c)) {
          manager.saveProperties(row[PathPropertyName], {[c.name]: frontmatterLinkPayload(c.type, newValue)})
        }

      return {...p, [c.name]: newValue}
     }
     return p
    }, {})
    return {...row, ...deltaRow}
  }
