import { defaultContextSchemaID } from "shared/schemas/context";
import { frontmatterPropertySource } from "../allProperties";
import { defaultPropertySourceForContext } from "../newPropertyDefaults";
import { isFrontmatterCompatibleType } from "core/utils/contexts/propertyTypeMenu";

describe("defaultPropertySourceForContext", () => {
  it("defaults ordinary properties in default folder contexts to frontmatter", () => {
    expect(
      defaultPropertySourceForContext({
        schemaId: defaultContextSchemaID,
        contextPath: "Relays & Devices",
      })
    ).toBe(frontmatterPropertySource);
  });

  it("does not mark single-file frontmatter metadata properties with a discovery source", () => {
    expect(
      defaultPropertySourceForContext({
        schemaId: defaultContextSchemaID,
        contextPath: "$fm",
        fileMetadata: true,
      })
    ).toBeUndefined();
  });

  it("leaves tag spaces and non-primary schemas unchanged", () => {
    expect(
      defaultPropertySourceForContext({
        schemaId: defaultContextSchemaID,
        contextPath: "spaces://garden",
      })
    ).toBeUndefined();
    expect(
      defaultPropertySourceForContext({
        schemaId: "custom",
        contextPath: "Relays & Devices",
      })
    ).toBeUndefined();
  });

  it("returns undefined for a missing context argument instead of throwing", () => {
    expect(defaultPropertySourceForContext()).toBeUndefined();
  });
});

describe("isFrontmatterCompatibleType", () => {
  it("accepts file-backed types and rejects context-only types", () => {
    for (const t of ["text", "number", "boolean", "date", "option", "option-multi", "link", "image"]) {
      expect(isFrontmatterCompatibleType(t)).toBe(true);
    }
    for (const t of ["aggregate", "context", "object", "fileprop", undefined as any]) {
      expect(isFrontmatterCompatibleType(t)).toBe(false);
    }
  });
});
