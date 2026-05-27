import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty } from "shared/types/mdb";
import { PathState } from "shared/types/PathState";
import { syncContextRow } from "./linkContextRow";

const pathState = (property: Record<string, unknown>): PathState =>
  ({
    path: "Folder/A.md",
    type: "path",
    metadata: { property },
  } as unknown as PathState);

const spaceState = {
  path: "Folder",
  type: "space",
} as PathState;

const frontmatterField = (
  name: string,
  type: string
): SpaceProperty =>
  ({
    name,
    type,
    value: "",
    schemaId: "files",
    source: frontmatterPropertySource,
  } as SpaceProperty);

describe("syncContextRow", () => {
  it("uses explicit frontmatter-backed column types when projecting row values", () => {
    const paths = new Map<string, PathState>([
      ["Folder", spaceState],
      [
        "Folder/A.md",
        pathState({
          refText: "[[Home]]",
          refLink: "[[Home]]",
          done: false,
        }),
      ],
    ]);

    const row = syncContextRow(
      paths,
      { [PathPropertyName]: "Folder/A.md" },
      [
        frontmatterField("refText", "text"),
        frontmatterField("refLink", "link"),
        frontmatterField("done", "boolean"),
      ],
      spaceState
    );

    expect(row.refText).toBe("[[Home]]");
    expect(row.refLink).toBe("Home");
    expect(row.done).toBe("false");
  });
});
