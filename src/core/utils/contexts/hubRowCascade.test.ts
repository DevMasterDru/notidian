import {
  hubRowChildFolderPath,
  isHubRowPath,
  planHubRowDeleteCascade,
  planHubRowRenameCascade,
  shouldRenderHubRowIndicator,
  typeProfileReservedFrontmatterKeys,
} from "./hubRowCascade";

// ---------------------------------------------------------------------------
// Fixture: a row-note with a same-named sibling folder (Notidian-z21a
// verify-then-build step 1) — "Knowledge/Gidi.md" is a row of the Knowledge
// database AND (adjacent mode) the hub note of "Knowledge/Gidi", matching the
// live vault's seeded root hub (Knowledge.md, rows_folder: Knowledge) and its
// ADR-0008 adjacent-mode resolution.
// ---------------------------------------------------------------------------

const HUB_ROW_PATH = "Knowledge/Gidi.md";
const HUB_ROW_FOLDER = "Knowledge/Gidi";

describe("hubRowChildFolderPath", () => {
  it("strips .md and keeps the directory for a nested row", () => {
    expect(hubRowChildFolderPath(HUB_ROW_PATH)).toBe(HUB_ROW_FOLDER);
  });

  it("handles a root-level row (no directory)", () => {
    expect(hubRowChildFolderPath("Knowledge.md")).toBe("Knowledge");
  });

  it("is case-insensitive on the .md extension", () => {
    expect(hubRowChildFolderPath("Knowledge/Gidi.MD")).toBe(HUB_ROW_FOLDER);
  });

  it("returns null for a non-markdown path", () => {
    expect(hubRowChildFolderPath("Knowledge/Gidi.canvas")).toBeNull();
    expect(hubRowChildFolderPath("Knowledge/Gidi")).toBeNull();
  });

  it("returns null for an empty/falsy path", () => {
    expect(hubRowChildFolderPath("")).toBeNull();
    expect(hubRowChildFolderPath(undefined as unknown as string)).toBeNull();
  });

  it("returns null when the basename would be empty", () => {
    expect(hubRowChildFolderPath("Knowledge/.md")).toBeNull();
    expect(hubRowChildFolderPath(".md")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isHubRowPath / the "configured hub folder" precision test — a same-named
// sibling folder is only ever a child hub when the SPACE SYSTEM already
// considers this exact file that folder's note (spaceInfo.notePath). This is
// deliberately NOT a bare name-collision guess.
// ---------------------------------------------------------------------------

describe("isHubRowPath", () => {
  it("true when the sibling folder's configured note is exactly this row", () => {
    const notePathForFolder = (folder: string) =>
      folder === HUB_ROW_FOLDER ? HUB_ROW_PATH : null;
    expect(isHubRowPath(HUB_ROW_PATH, notePathForFolder)).toBe(true);
  });

  it("false when no folder is indexed at all (plain row, current/legacy case)", () => {
    const notePathForFolder = (): string | null => null;
    expect(isHubRowPath(HUB_ROW_PATH, notePathForFolder)).toBe(false);
  });

  it("false when the folder exists but its note is a DIFFERENT file (inside-mode: the note lives inside the folder, not beside it)", () => {
    const notePathForFolder = (folder: string) =>
      folder === HUB_ROW_FOLDER ? "Knowledge/Gidi/Gidi.md" : null;
    expect(isHubRowPath(HUB_ROW_PATH, notePathForFolder)).toBe(false);
  });

  it("false for a coincidental same-named folder unrelated to this row", () => {
    // e.g. an unrelated "Gidi" folder whose real note is something else
    // entirely — must never be treated as this row's nested database.
    const notePathForFolder = (folder: string) =>
      folder === HUB_ROW_FOLDER ? "Somewhere/Else.md" : null;
    expect(isHubRowPath(HUB_ROW_PATH, notePathForFolder)).toBe(false);
  });

  it("false for a non-markdown path", () => {
    const notePathForFolder = () => HUB_ROW_PATH;
    expect(isHubRowPath("Knowledge/Gidi", notePathForFolder)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldRenderHubRowIndicator (Notidian-b0fm) — the pure render gate for the
// row-render-surface indicator. It ANDs the opt-in indicator flag, the
// underlying nested-hub feature flag, and the actual hub-row relationship, so
// the indicator can never appear on a non-hub row, with the feature off, or
// with the opt-in flag off (its default). The DEFAULT-OFF flag is what keeps
// this untested-in-the-real-vault render change dark until the owner enables
// it (docs/AUTONOMOUS-REVIEW-QUEUE.md).
// ---------------------------------------------------------------------------
describe("shouldRenderHubRowIndicator", () => {
  const isHub = () => HUB_ROW_PATH; // folder's configured note === this row
  const notAHub = (): string | null => null; // no indexed sibling folder

  it("true only when both flags are on AND the row is a configured hub row", () => {
    expect(
      shouldRenderHubRowIndicator(
        { enableHubRowIndicator: true, enableNestedHubRows: true },
        HUB_ROW_PATH,
        isHub
      )
    ).toBe(true);
  });

  it("false when the opt-in indicator flag is off (its default), even for a real hub row", () => {
    expect(
      shouldRenderHubRowIndicator(
        { enableHubRowIndicator: false, enableNestedHubRows: true },
        HUB_ROW_PATH,
        isHub
      )
    ).toBe(false);
  });

  it("false when the underlying nested-hub feature is off, even with the indicator flag on", () => {
    expect(
      shouldRenderHubRowIndicator(
        { enableHubRowIndicator: true, enableNestedHubRows: false },
        HUB_ROW_PATH,
        isHub
      )
    ).toBe(false);
  });

  it("false for an ordinary (non-hub) row even with both flags on", () => {
    expect(
      shouldRenderHubRowIndicator(
        { enableHubRowIndicator: true, enableNestedHubRows: true },
        HUB_ROW_PATH,
        notAHub
      )
    ).toBe(false);
  });

  it("false when the flags are absent/undefined (unset settings read as off)", () => {
    expect(shouldRenderHubRowIndicator({}, HUB_ROW_PATH, isHub)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// planHubRowRenameCascade — CHARACTERIZE THEN BUILD:
//   - the plan itself is the "build" half (Step 2): a correct rename/move
//     cascade plan for a genuine hub row.
//   - the "none" branches document exactly the CURRENT/legacy behavior this
//     bead's wiring must not disturb for non-hub rows (Step 1 characterize).
// ---------------------------------------------------------------------------

describe("planHubRowRenameCascade", () => {
  const notePathForFolder = (folder: string) =>
    folder === HUB_ROW_FOLDER ? HUB_ROW_PATH : null;

  it("plans a folder rename alongside a hub row's file rename", () => {
    expect(
      planHubRowRenameCascade(
        HUB_ROW_PATH,
        "Knowledge/Gidi Renamed.md",
        notePathForFolder
      )
    ).toEqual({
      kind: "rename",
      fromFolder: HUB_ROW_FOLDER,
      toFolder: "Knowledge/Gidi Renamed",
    });
  });

  it("plans a folder rename alongside a hub row's move to a new parent", () => {
    expect(
      planHubRowRenameCascade(
        HUB_ROW_PATH,
        "Archive/Gidi.md",
        notePathForFolder
      )
    ).toEqual({
      kind: "rename",
      fromFolder: HUB_ROW_FOLDER,
      toFolder: "Archive/Gidi",
    });
  });

  it("CURRENT BEHAVIOR (ordinary row, no sibling folder): no cascade plan", () => {
    const noFolder = (): string | null => null;
    expect(
      planHubRowRenameCascade(
        "Knowledge/Plain.md",
        "Knowledge/Renamed.md",
        noFolder
      )
    ).toEqual({ kind: "none" });
  });

  it("does not cascade when the sibling folder is not actually this row's configured hub (inside-mode / coincidence)", () => {
    const mismatched = () => "Somewhere/Else.md";
    expect(
      planHubRowRenameCascade(
        HUB_ROW_PATH,
        "Knowledge/Gidi Renamed.md",
        mismatched
      )
    ).toEqual({ kind: "none" });
  });

  it("no-ops when the resolved folder path is unchanged (e.g. a case-only .md extension change)", () => {
    expect(
      planHubRowRenameCascade(HUB_ROW_PATH, "Knowledge/Gidi.MD", notePathForFolder)
    ).toEqual({ kind: "none" });
  });

  it("no-ops for a non-markdown source or destination", () => {
    expect(
      planHubRowRenameCascade("Knowledge/Gidi", HUB_ROW_PATH, notePathForFolder)
    ).toEqual({ kind: "none" });
  });
});

describe("planHubRowDeleteCascade", () => {
  const notePathForFolder = (folder: string) =>
    folder === HUB_ROW_FOLDER ? HUB_ROW_PATH : null;

  it("plans a folder delete alongside a hub row's file delete", () => {
    expect(planHubRowDeleteCascade(HUB_ROW_PATH, notePathForFolder)).toEqual({
      kind: "delete",
      folder: HUB_ROW_FOLDER,
    });
  });

  it("CURRENT BEHAVIOR (ordinary row): no cascade plan, matching today's plain file delete", () => {
    const noFolder = (): string | null => null;
    expect(planHubRowDeleteCascade("Knowledge/Plain.md", noFolder)).toEqual({
      kind: "none",
    });
  });

  it("does not cascade when the folder is not this row's configured hub", () => {
    const mismatched = () => "Somewhere/Else.md";
    expect(planHubRowDeleteCascade(HUB_ROW_PATH, mismatched)).toEqual({
      kind: "none",
    });
  });
});

describe("typeProfileReservedFrontmatterKeys", () => {
  it("names exactly the structural Type Profile keys, never database/slug", () => {
    expect(typeProfileReservedFrontmatterKeys).toEqual([
      "schema_type",
      "fields",
      "kind_fields",
      "invariants",
    ]);
    expect(typeProfileReservedFrontmatterKeys).not.toContain("database");
    expect(typeProfileReservedFrontmatterKeys).not.toContain("slug");
  });
});
