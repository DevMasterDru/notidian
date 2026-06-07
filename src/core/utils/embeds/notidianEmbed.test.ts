import {
  descriptorToFragmentPath,
  normalizeNotidianEmbedDescriptor,
  parseLegacyNotidianEmbedRef,
  parseNotidianEmbedBlock,
  serializeNotidianEmbedBlock,
} from "./notidianEmbed";
import { notidianEmbedBlockFromParts } from "shared/utils/makemd/embed";

describe("parseNotidianEmbedBlock", () => {
  it("parses a canonical notidian block body", () => {
    expect(
      parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
height: 480
title: true
editable: false
`)
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        height: 480,
        title: true,
        editable: false,
      },
    });
  });

  it("normalizes shorthand view and table fields", () => {
    expect(
      normalizeNotidianEmbedDescriptor({
        target: "Projects",
        view: "active",
      })
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
      },
    });

    expect(
      normalizeNotidianEmbedDescriptor({
        target: "Projects",
        table: "files",
      })
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "table",
        id: "files",
        title: true,
        editable: false,
      },
    });
  });

  it("reports missing target and invalid kind errors", () => {
    expect(parseNotidianEmbedBlock("view: active")).toEqual({
      ok: false,
      errors: [{ field: "target", message: "target is required" }],
    });

    expect(
      parseNotidianEmbedBlock(`
target: Projects
kind: gallery
id: active
`)
    ).toEqual({
      ok: false,
      errors: [{ field: "kind", message: "kind must be table or view" }],
    });
  });
});

describe("parseLegacyNotidianEmbedRef", () => {
  it("parses legacy table and view fragments", () => {
    expect(parseLegacyNotidianEmbedRef("Projects/#^files")).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "table",
        id: "files",
        title: true,
        editable: false,
      },
    });

    expect(parseLegacyNotidianEmbedRef("Projects/#*active")).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
      },
    });
  });
});

describe("serializeNotidianEmbedBlock", () => {
  it("serializes descriptors to canonical fenced blocks", () => {
    expect(
      serializeNotidianEmbedBlock({
        target: "Projects",
        kind: "view",
        id: "active",
        height: 480,
        title: true,
        editable: false,
      })
    ).toBe(`\`\`\`notidian
target: Projects
kind: view
id: active
height: 480
title: true
editable: false
\`\`\``);
  });
});

describe("descriptorToFragmentPath", () => {
  it("serializes descriptors to legacy-compatible fragment paths", () => {
    expect(
      descriptorToFragmentPath({
        target: "Projects",
        kind: "table",
        id: "files",
      })
    ).toBe("Projects/#^files");

    expect(
      descriptorToFragmentPath({
        target: "Projects",
        kind: "view",
        id: "active",
      })
    ).toBe("Projects/#*active");
  });
});

describe("notidianEmbedBlockFromParts", () => {
  it("builds a Notidian-native block from legacy embed helper inputs", () => {
    expect(
      notidianEmbedBlockFromParts({
        target: "Projects",
        kind: "view",
        id: "active",
      })
    ).toBe(
      [
        "```notidian",
        "target: Projects",
        "kind: view",
        "id: active",
        "title: true",
        "editable: false",
        "```",
      ].join("\n")
    );
  });
});
