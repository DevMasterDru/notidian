import { parseURI } from "shared/utils/uri";
import {
  expandableRowNotePath,
  listItemSupportsRowExpansion,
  toggleRowExpansion,
} from "./rowExpansion";

describe("listItemSupportsRowExpansion", () => {
  it("matches the default list view rowItem kit", () => {
    expect(
      listItemSupportsRowExpansion(parseURI("spaces://$kit/#*rowItem"))
    ).toBe(true);
  });

  it("rejects other list item kits so non-list layouts stay unchanged", () => {
    expect(
      listItemSupportsRowExpansion(parseURI("spaces://$kit/#*cardListItem"))
    ).toBe(false);
    expect(
      listItemSupportsRowExpansion(parseURI("spaces://$kit/#*flowListItem"))
    ).toBe(false);
    expect(
      listItemSupportsRowExpansion(parseURI("spaces://$kit/#*detailItem"))
    ).toBe(false);
  });

  it("rejects non-kit frames and missing uris", () => {
    expect(
      listItemSupportsRowExpansion(parseURI("spaces://My Space/#*rowItem"))
    ).toBe(false);
    expect(listItemSupportsRowExpansion(null)).toBe(false);
    expect(listItemSupportsRowExpansion(undefined)).toBe(false);
  });
});

describe("expandableRowNotePath", () => {
  const notes: Record<string, { type: string; subtype: string }> = {
    "Beads Portfolio/Atlasidian-0c4.md": { type: "file", subtype: "md" },
    "Attachments/diagram.png": { type: "file", subtype: "png" },
    "Beads Portfolio": { type: "space", subtype: "folder" },
  };
  const getPathState = (path: string) => notes[path];

  it("returns the note path for file-backed markdown rows", () => {
    expect(
      expandableRowNotePath(
        { File: "Beads Portfolio/Atlasidian-0c4.md" },
        "File",
        getPathState
      )
    ).toBe("Beads Portfolio/Atlasidian-0c4.md");
  });

  it("returns null for rows that do not resolve to a markdown note", () => {
    expect(
      expandableRowNotePath(
        { File: "Attachments/diagram.png" },
        "File",
        getPathState
      )
    ).toBeNull();
    expect(
      expandableRowNotePath({ File: "Beads Portfolio" }, "File", getPathState)
    ).toBeNull();
    expect(
      expandableRowNotePath({ File: "Missing/Note.md" }, "File", getPathState)
    ).toBeNull();
  });

  it("returns null for missing rows, keys, or empty paths", () => {
    expect(expandableRowNotePath(null, "File", getPathState)).toBeNull();
    expect(
      expandableRowNotePath({ File: "Note.md" }, null, getPathState)
    ).toBeNull();
    expect(expandableRowNotePath({ File: "" }, "File", getPathState)).toBeNull();
    expect(
      expandableRowNotePath({ File: "   " }, "File", getPathState)
    ).toBeNull();
    expect(expandableRowNotePath({}, "File", getPathState)).toBeNull();
  });
});

describe("toggleRowExpansion", () => {
  it("expands a collapsed row", () => {
    expect(toggleRowExpansion({}, "a.md")).toEqual({ "a.md": true });
  });

  it("collapses an expanded row", () => {
    expect(toggleRowExpansion({ "a.md": true }, "a.md")).toEqual({
      "a.md": false,
    });
  });

  it("keeps other open rows open so multiple rows expand independently", () => {
    let expanded: Record<string, boolean> = {};
    expanded = toggleRowExpansion(expanded, "a.md");
    expanded = toggleRowExpansion(expanded, "b.md");
    expect(expanded).toEqual({ "a.md": true, "b.md": true });

    expanded = toggleRowExpansion(expanded, "a.md");
    expect(expanded).toEqual({ "a.md": false, "b.md": true });
  });

  it("does not mutate the previous state", () => {
    const before = { "a.md": true };
    toggleRowExpansion(before, "a.md");
    expect(before).toEqual({ "a.md": true });
  });
});
