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

  // H2 embed hygiene (Notidian-pb7p.2 / Atlas ADR-0096): `bar: false`
  // suppresses the view-config bar for hub-tab embeds. Absent or `bar: true`
  // keeps the legacy descriptor shape byte-identical (no `bar` key).
  it("parses bar: false into a bar-suppressed descriptor", () => {
    expect(
      parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
bar: false
`)
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
        bar: false,
      },
    });
  });

  it("omits the bar key when bar is absent or explicitly true", () => {
    const absent = parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
`);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect("bar" in absent.descriptor).toBe(false);

    const explicitTrue = parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
bar: true
`);
    expect(explicitTrue.ok).toBe(true);
    if (explicitTrue.ok) expect("bar" in explicitTrue.descriptor).toBe(false);
  });

  it("reports a non-boolean bar value as an error", () => {
    expect(
      parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
bar: maybe
`)
    ).toEqual({
      ok: false,
      errors: [{ field: "bar", message: "bar must be true or false" }],
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

  it("serializes bar: false and stays byte-identical without it", () => {
    expect(
      serializeNotidianEmbedBlock({
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
        bar: false,
      })
    ).toBe(`\`\`\`notidian
target: Projects
kind: view
id: active
bar: false
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
