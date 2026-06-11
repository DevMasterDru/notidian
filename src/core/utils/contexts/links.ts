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
          manager.saveProperties(row[PathPropertyName], {[c.name]: parseMDBStringValue(c.type, newValue, true)})
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
          manager.saveProperties(row[PathPropertyName], {[c.name]: parseMDBStringValue(c.type, newValue, true)})
        }

      return {...p, [c.name]: newValue}
     }
     return p
    }, {})
    return {...row, ...deltaRow}
  }
  