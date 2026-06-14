import { defaultContextSchemaID } from "shared/schemas/context";
import { frontmatterPropertySource } from "./allProperties";
import {
  defaultPropertySourceForContext,
  persistedSourceForPropertyChoice,
} from "./newPropertyDefaults";
import { notidianPropertySource } from "./propertyAuthority";

describe("defaultPropertySourceForContext", () => {
  it("defaults a folder context's new properties to frontmatter", () => {
    expect(
      defaultPropertySourceForContext({
        schemaId: defaultContextSchemaID,
        contextPath: "Reviews",
      })
    ).toBe(frontmatterPropertySource);
  });

  it("leaves file-metadata, space, virtual, and non-default-schema contexts unsourced", () => {
    expect(
      defaultPropertySourceForContext({
        schemaId: defaultContextSchemaID,
        contextPath: "Reviews",
        fileMetadata: true,
      })
    ).toBeUndefined();
    expect(
      defaultPropertySourceForContext({
        schemaId: defaultContextSchemaID,
        contextPath: "Reviews",
        isSpace: true,
      })
    ).toBeUndefined();
    expect(
      defaultPropertySourceForContext({
        schemaId: defaultContextSchemaID,
        contextPath: "spaces://abc",
      })
    ).toBeUndefined();
    expect(
      defaultPropertySourceForContext({
        schemaId: "other",
        contextPath: "Reviews",
      })
    ).toBeUndefined();
  });
});

describe("persistedSourceForPropertyChoice", () => {
  it("persists the Frontmatter choice as an explicit frontmatter source", () => {
    expect(persistedSourceForPropertyChoice(frontmatterPropertySource)).toBe(
      frontmatterPropertySource
    );
  });

  it("persists the Notidian-owned choice as an explicit notidian source (never source-less)", () => {
    // The "Notidian-owned field" picker value used to be normalized to undefined,
    // which made durable MDB ownership indistinguishable from a lost source
    // marker. Both choices are now explicit (bd Notidian-2j3 / ADR 0017).
    expect(persistedSourceForPropertyChoice(notidianPropertySource)).toBe(
      notidianPropertySource
    );
    expect(persistedSourceForPropertyChoice(undefined)).toBe(
      notidianPropertySource
    );
  });
});
