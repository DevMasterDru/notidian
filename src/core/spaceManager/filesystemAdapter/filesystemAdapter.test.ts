import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextDBSchema } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { FilesystemSpaceAdapter } from "./filesystemAdapter";

describe("FilesystemSpaceAdapter.saveTable", () => {
  it("strips frontmatter-backed row values before saving context tables", async () => {
    const savedTables: SpaceTable[] = [];
    const fileSystem = {
      eventDispatch: {
        addListener: jest.fn(),
      },
      getFile: jest.fn(async () => ({ path: "Relays & Devices/.space/context.mdb" })),
      saveFileFragment: jest.fn(async (_file, _type, _id, content) => {
        savedTables.push(content({}));
        return true;
      }),
    };
    const adapter = new FilesystemSpaceAdapter(fileSystem as any, ".notidian");
    jest.spyOn(adapter, "spaceInfoForPath").mockReturnValue({
      dbPath: "Relays & Devices/.space/context.mdb",
    } as any);

    await adapter.saveTable(
      "Relays & Devices",
      {
        schema: defaultContextDBSchema,
        cols: [
          ...(defaultContextFields.rows as any),
          {
            name: "status",
            schemaId: "files",
            type: "text",
            value: "",
            source: frontmatterPropertySource,
          },
          {
            name: "manual",
            schemaId: "files",
            type: "text",
            value: "",
          },
        ],
        rows: [
          {
            [PathPropertyName]: "Relays & Devices/a.md",
            status: "active",
            manual: "context-only",
          },
        ],
      },
      false
    );

    expect(savedTables[0].rows).toEqual([
      {
        [PathPropertyName]: "Relays & Devices/a.md",
        manual: "context-only",
      },
    ]);
  });
});
