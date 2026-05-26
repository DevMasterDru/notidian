import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  buildBaseExportPreview,
  defaultBaseExportPathForFolder,
  uniqueBaseExportPathForFolder,
  writeBaseExportFile,
} from "./baseExportWorkflow";

const table = (): SpaceTable => ({
  schema: {
    id: "files",
    name: "Relays & Devices",
    type: "db",
  },
  cols: [
    {
      name: PathPropertyName,
      type: "file",
      primary: "true",
    },
    {
      name: "status",
      type: "text",
      source: frontmatterPropertySource,
    },
    {
      name: "scratch",
      type: "text",
    },
  ],
  rows: [],
});

describe("base export workflow", () => {
  it("uses a sibling .base file path for a folder", () => {
    expect(defaultBaseExportPathForFolder("Relays & Devices")).toBe(
      "Relays & Devices.base"
    );
    expect(defaultBaseExportPathForFolder("Areas/Relays & Devices")).toBe(
      "Areas/Relays & Devices.base"
    );
  });

  it("chooses a numbered export path instead of overwriting", async () => {
    const existing = new Set([
      "Areas/Relays & Devices.base",
      "Areas/Relays & Devices 1.base",
    ]);

    await expect(
      uniqueBaseExportPathForFolder("Areas/Relays & Devices", (path) =>
        Promise.resolve(existing.has(path))
      )
    ).resolves.toBe("Areas/Relays & Devices 2.base");
  });

  it("builds a preview with YAML and unsupported feature warnings", () => {
    const preview = buildBaseExportPreview({
      folderPath: "Relays & Devices",
      outputPath: "Relays & Devices.base",
      table: table(),
      viewName: "Devices",
    });

    expect(preview.outputPath).toBe("Relays & Devices.base");
    expect(preview.yaml).toContain('file.inFolder(\\"Relays & Devices\\")');
    expect(preview.yaml).toContain('name: "Devices"');
    expect(preview.unsupported).toEqual([
      {
        column: "scratch",
        reason:
          "Notidian-owned column has no Bases representation unless it is migrated to frontmatter or kept as explicit Notidian state.",
      },
    ]);
  });

  it("writes the preview YAML to the selected output path", async () => {
    const writes: { path: string; content: string }[] = [];

    const result = await writeBaseExportFile({
      folderPath: "Relays & Devices",
      table: table(),
      pathExists: async () => false,
      writeText: async (path, content) => {
        writes.push({ path, content });
      },
    });

    expect(result.outputPath).toBe("Relays & Devices.base");
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("Relays & Devices.base");
    expect(writes[0].content).toBe(result.yaml);
  });
});
