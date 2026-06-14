import { defaultContextSchemaID } from "shared/schemas/context";
import { frontmatterPropertySource } from "./allProperties";
import { notidianPropertySource } from "./propertyAuthority";

export type DefaultPropertySourceContext = {
  schemaId?: string;
  contextPath?: string;
  fileMetadata?: boolean;
  isSpace?: boolean;
};

export const defaultPropertySourceForContext = ({
  schemaId,
  contextPath,
  fileMetadata,
  isSpace,
}: DefaultPropertySourceContext = {}): string | undefined => {
  if (fileMetadata || isSpace) return undefined;
  if (schemaId !== defaultContextSchemaID) return undefined;
  if (!contextPath || contextPath === "$fm") return undefined;
  if (contextPath.startsWith("spaces://")) return undefined;

  return frontmatterPropertySource;
};

// Maps the property-storage picker selection ("Frontmatter" vs "Notidian-owned
// field") to the explicit `source` marker persisted on the new column. Both
// choices are now explicit: a column is never intentionally created source-less,
// so a missing/lost marker can never be mistaken for a deliberate Notidian-owned
// field. This is what makes the propertyAuthority fallback safe to remove (bd
// Notidian-2j3 / ADR 0017).
export const persistedSourceForPropertyChoice = (
  choice: string | undefined
): string =>
  choice === frontmatterPropertySource
    ? frontmatterPropertySource
    : notidianPropertySource;
