import { defaultContextSchemaID } from "shared/schemas/context";
import { frontmatterPropertySource } from "./allProperties";

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
