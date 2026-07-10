/**
 * Adversarial / safety tests for hubRowCascade.ts
 *
 * Bead: Notidian-wa8s
 *
 * hubRowCascade is the PURE planner (no I/O, no throws) that decides whether
 * renaming or deleting a database row's FILE must ALSO rename or delete the
 * sibling folder that is itself a nested child-database hub (Notidian-z21a,
 * flag `enableNestedHubRows`). Its blast radius is high: a false-positive
 * cascade plan would rename or DESTROY an unrelated / mis-identified nested
 * folder database. This suite pins three properties the existing
 * characterization tests only sample:
 *
 *   (1) SAFETY — a delete/rename plan is NEVER returned unless the space
 *       system reports EXACTLY `notePathForFolder(folder) === rowPath`. A
 *       name-collision, a case-variant, an inside-mode note, the rename
 *       DESTINATION path, `null`, `undefined`, or the empty string must all
 *       resolve to `{ kind: "none" }`. The plan, when produced, may only ever
 *       point at the folder DERIVED from the input path — never an arbitrary
 *       folder the stub named.
 *
 *   (2) TOTALITY — over WELL-BEHAVED (non-throwing) stubs, all four exports
 *       (hubRowChildFolderPath / isHubRowPath / planHubRowRenameCascade /
 *       planHubRowDeleteCascade) return a valid shape and never throw on
 *       adversarial paths (empty, ".md", "a/.md", deep slashes, no extension,
 *       ".MD", trailing slash, unicode/emoji, whitespace, backslashes, very
 *       long). The MODULE CONTRACT says the caller OWNS the notePathForFolder
 *       read, so a THROWING stub is deliberately out of contract and NOT
 *       tested here — the module must not (and does not) defensively swallow
 *       caller reads.
 *
 *   (3) rename plan is `{ kind: "none" }` when fromFolder === toFolder (nothing
 *       actually moved) or when EITHER side lacks a real basename — even when
 *       the stub affirms the hub, so a live folder DB is never renamed into an
 *       empty / nonsense target.
 *
 * All tests are pure-offline — no filesystem, no render path.
 */

import {
  hubRowChildFolderPath,
  isHubRowPath,
  planHubRowDeleteCascade,
  planHubRowRenameCascade,
} from "./hubRowCascade";
import type { HubRowCascadePlan } from "./hubRowCascade";

// ---------------------------------------------------------------------------
// Fixture + helpers
// ---------------------------------------------------------------------------

const HUB_ROW_PATH = "Knowledge/Gidi.md";
const HUB_ROW_FOLDER = "Knowledge/Gidi";
const NONE: HubRowCascadePlan = { kind: "none" };

type NotePathReader = (folderPath: string) => string | null | undefined;

/** A stub whose configured note for ANY folder is a fixed value. */
const reads = (value: string | null | undefined): NotePathReader => () => value;

/** Structural validity of a plan: exactly the fields its `kind` allows. */
const isValidPlan = (plan: HubRowCascadePlan): boolean => {
  switch (plan.kind) {
    case "none":
      return Object.keys(plan).length === 1;
    case "delete":
      return typeof plan.folder === "string" && Object.keys(plan).length === 2;
    case "rename":
      return (
        typeof plan.fromFolder === "string" &&
        typeof plan.toFolder === "string" &&
        Object.keys(plan).length === 3
      );
    default:
      return false;
  }
};

/** Readable, bounded test-name label for a possibly-huge/whitespace path. */
const label = (p: string): string =>
  p.length > 40
    ? `${JSON.stringify(p.slice(0, 32))}…(len ${p.length})`
    : JSON.stringify(p);

// Every one of these, when returned by notePathForFolder for HUB_ROW_PATH's
// sibling folder, is `!== HUB_ROW_PATH` and therefore must NEVER cascade. This
// is the exhaustive "no false positive" surface: the space system disagrees,
// reports nothing, or reports a merely-similar path.
const NON_MATCHING_NOTE_READS: Array<string | null | undefined> = [
  undefined,
  null,
  "",
  HUB_ROW_FOLDER, // the folder itself, not a note file
  "Knowledge/Gidi", // ditto (no extension)
  "knowledge/gidi.md", // whole-path case-variant
  "Knowledge/gidi.md", // basename case-variant
  "Knowledge/GIDI.md",
  "Knowledge/Gidi.MD", // extension-case variant
  " Knowledge/Gidi.md", // leading whitespace
  "Knowledge/Gidi.md ", // trailing whitespace
  "Knowledge/Gidi.md\n", // trailing newline
  "Knowledge//Gidi.md", // doubled separator
  "Knowledge/Gidi/Gidi.md", // inside-mode note (lives INSIDE the folder)
  "Somewhere/Else.md", // wholly unrelated
  "Knowledge/Gidi Renamed.md", // the rename DESTINATION — must not affirm source
  "Archive/Gidi.md", // a move destination — must not affirm source
];

// The full return-value sweep including the ONE value that legitimately
// affirms the hub. Every property below is stated as an IFF against this.
const ALL_NOTE_READS: Array<string | null | undefined> = [
  ...NON_MATCHING_NOTE_READS,
  HUB_ROW_PATH,
];

// ---------------------------------------------------------------------------
// (1) SAFETY — no false-positive cascade
// ---------------------------------------------------------------------------

describe("SAFETY: planHubRowDeleteCascade only ever deletes an EXACT-match hub", () => {
  it.each(ALL_NOTE_READS)(
    "delete plan is a cascade IFF notePathForFolder returns exactly the row path (read=%p)",
    (ret) => {
      const plan = planHubRowDeleteCascade(HUB_ROW_PATH, reads(ret));
      if (ret === HUB_ROW_PATH) {
        expect(plan).toEqual({ kind: "delete", folder: HUB_ROW_FOLDER });
      } else {
        expect(plan).toEqual(NONE);
      }
    }
  );

  it("never returns a delete plan for a folder the stub merely NAMED (only the derived folder)", () => {
    // The stub claims some OTHER folder is this row's hub; the planner must
    // ignore that and refuse, never emit a delete for `Somewhere/Else`.
    const plan = planHubRowDeleteCascade(HUB_ROW_PATH, reads("Somewhere/Else.md"));
    expect(plan).toEqual(NONE);
  });

  it("a case-only name collision does not orphan/destroy a nested folder DB", () => {
    // Case-insensitive FS could surface a same-looking folder; exact `===`
    // must still refuse, because the identities differ.
    expect(planHubRowDeleteCascade(HUB_ROW_PATH, reads("knowledge/gidi.md"))).toEqual(
      NONE
    );
  });
});

describe("SAFETY: isHubRowPath is true IFF the folder's configured note is exactly this row", () => {
  it.each(ALL_NOTE_READS)("read=%p", (ret) => {
    expect(isHubRowPath(HUB_ROW_PATH, reads(ret))).toBe(ret === HUB_ROW_PATH);
  });

  it("is false whenever the derived folder is null (no basename), regardless of the read", () => {
    // Short-circuits before any read: a path with no real basename can have no
    // sibling hub folder to consult.
    expect(isHubRowPath("Knowledge/.md", reads(HUB_ROW_PATH))).toBe(false);
    expect(isHubRowPath(".md", reads(HUB_ROW_PATH))).toBe(false);
  });

  // Space-path representation (Notidian-gtqf): an extensionless row is a hub
  // row IFF the folder's configured note is the ADJACENT same-named file —
  // exact match only, same IFF discipline as the .md branch above.
  it.each(ALL_NOTE_READS)("extensionless read=%p", (ret) => {
    expect(isHubRowPath(HUB_ROW_FOLDER, reads(ret))).toBe(
      ret === HUB_ROW_FOLDER + ".md"
    );
  });
});

describe("SAFETY: planHubRowRenameCascade only cascades on an EXACT-match SOURCE hub", () => {
  const NEW_PATH = "Knowledge/Gidi Renamed.md";
  const NEW_FOLDER = "Knowledge/Gidi Renamed";

  it.each(ALL_NOTE_READS)(
    "rename plan is a cascade IFF the SOURCE folder's note is exactly the old path (read=%p)",
    (ret) => {
      const plan = planHubRowRenameCascade(HUB_ROW_PATH, NEW_PATH, reads(ret));
      if (ret === HUB_ROW_PATH) {
        expect(plan).toEqual({
          kind: "rename",
          fromFolder: HUB_ROW_FOLDER,
          toFolder: NEW_FOLDER,
        });
      } else {
        expect(plan).toEqual(NONE);
      }
    }
  );

  it("keys the cascade on the SOURCE folder, never the destination", () => {
    // Stub affirms the hub ONLY for the destination folder. The rename must
    // still refuse — the OLD file's identity is what authorizes moving its
    // folder, not a coincidental hub at the destination.
    const affirmsDestinationOnly: NotePathReader = (folder) =>
      folder === NEW_FOLDER ? HUB_ROW_PATH : null;
    expect(
      planHubRowRenameCascade(HUB_ROW_PATH, NEW_PATH, affirmsDestinationOnly)
    ).toEqual(NONE);
  });

  it("returning the DESTINATION path from the source-folder read does not affirm the source", () => {
    // A subtle false positive: the folder's note equals where we're moving TO,
    // not where we're moving FROM. Exact-match against the OLD path refuses.
    expect(planHubRowRenameCascade(HUB_ROW_PATH, NEW_PATH, reads(NEW_PATH))).toEqual(
      NONE
    );
  });

  it("a case-variant of the source path does not authorize a folder rename", () => {
    expect(
      planHubRowRenameCascade(HUB_ROW_PATH, NEW_PATH, reads("knowledge/gidi.md"))
    ).toEqual(NONE);
  });
});

describe("SAFETY: a produced plan may only reference the DERIVED folder(s)", () => {
  // Across a spread of genuine hub rows, a cascade plan's folder fields are
  // ALWAYS exactly hubRowChildFolderPath(input) — never an arbitrary string
  // the stub supplied. This is the invariant that keeps a cascade from ever
  // touching a folder other than the row's own sibling.
  const hubRows: Array<[string, string]> = [
    ["A.md", "A"],
    ["Knowledge/Gidi.md", "Knowledge/Gidi"],
    ["a/b/c/Deep.md", "a/b/c/Deep"],
    ["名前/😀.md", "名前/😀"],
    ["  two spaces  .md", "  two spaces  "],
    ["weird\\back.md", "weird\\back"],
  ];

  it.each(hubRows)("delete(%s) → folder is exactly the derived folder", (row, folder) => {
    const plan = planHubRowDeleteCascade(row, reads(row));
    expect(plan).toEqual({ kind: "delete", folder });
    expect(folder).toBe(hubRowChildFolderPath(row));
  });

  it.each(hubRows)(
    "rename(%s → …/Moved.md) → fromFolder/toFolder are exactly the derived folders",
    (row, folder) => {
      const newPath = "Elsewhere/Moved.md";
      const plan = planHubRowRenameCascade(row, newPath, reads(row));
      expect(plan).toEqual({
        kind: "rename",
        fromFolder: folder,
        toFolder: "Elsewhere/Moved",
      });
      expect(plan).toMatchObject({
        fromFolder: hubRowChildFolderPath(row),
        toFolder: hubRowChildFolderPath(newPath),
      });
    }
  );
});

// ---------------------------------------------------------------------------
// (3) rename → none when nothing moved OR a side lacks a real basename
// ---------------------------------------------------------------------------

describe("rename plan is 'none' when fromFolder === toFolder (nothing actually moved)", () => {
  const affirm = reads(HUB_ROW_PATH); // stub AFFIRMS the hub, to prove it's the
  // equality guard — not a failed read — that produces the no-op.

  it("identical old and new path", () => {
    expect(planHubRowRenameCascade(HUB_ROW_PATH, HUB_ROW_PATH, affirm)).toEqual(NONE);
  });

  it("extension-case-only change resolves to the same folder", () => {
    expect(planHubRowRenameCascade(HUB_ROW_PATH, "Knowledge/Gidi.MD", affirm)).toEqual(
      NONE
    );
    expect(planHubRowRenameCascade("Knowledge/Gidi.MD", HUB_ROW_PATH, affirm)).toEqual(
      NONE
    );
  });
});

describe("rename plan is 'none' when a side lacks a real basename — even when the hub is affirmed", () => {
  const affirm = reads(HUB_ROW_PATH);

  it("SOURCE lacks a basename (never rename a folder based on a basename-less source)", () => {
    expect(planHubRowRenameCascade("Knowledge/.md", HUB_ROW_PATH, affirm)).toEqual(
      NONE
    );
    expect(planHubRowRenameCascade(".md", HUB_ROW_PATH, affirm)).toEqual(NONE);
  });

  it("DESTINATION lacks a basename (never rename a live folder DB INTO an empty target)", () => {
    expect(planHubRowRenameCascade(HUB_ROW_PATH, "Knowledge/.md", affirm)).toEqual(
      NONE
    );
    expect(planHubRowRenameCascade(HUB_ROW_PATH, ".md", affirm)).toEqual(NONE);
  });

  it("either side is non-markdown", () => {
    expect(planHubRowRenameCascade("Knowledge/Gidi", HUB_ROW_PATH, affirm)).toEqual(
      NONE
    );
    expect(planHubRowRenameCascade(HUB_ROW_PATH, "Knowledge/Gidi", affirm)).toEqual(
      NONE
    );
    expect(planHubRowRenameCascade("a", "b", affirm)).toEqual(NONE);
  });
});

// ---------------------------------------------------------------------------
// (2) TOTALITY — no throws over well-behaved stubs on adversarial paths
// ---------------------------------------------------------------------------

const ADVERSARIAL_PATHS: string[] = [
  "",
  ".md",
  ".MD",
  "a/.md",
  "a/b/.md",
  "////.md",
  "a///b.md",
  "a/b/c/d/e/f/g.md",
  "foo", // no extension
  "foo/bar", // no extension, nested
  "no-extension-at-all",
  "Foo.MD",
  "MixedCase/File.Md",
  "foo/", // trailing slash, not .md
  "foo.md/", // trailing slash AFTER .md — not a .md path
  "trailing/slash/.md",
  "名前/😀.md", // unicode + emoji (surrogate pair)
  "café.md",
  "🎉🎊/🥳.md",
  "  .md", // whitespace-only basename
  " .md",
  "\t.md",
  "\n.md",
  "   /   .md",
  "a\\b.md", // backslash is NOT a path separator here
  "a\\.md",
  "C:\\Users\\note.md",
  ".hidden.md",
  "..md",
  "...md",
  "a. md", // space before "md" → not a .md path
  "a".repeat(5000) + ".md", // very long basename
  "deep/" + "x/".repeat(500) + "leaf.md", // very deep
];

describe("TOTALITY: all four exports never throw on adversarial paths (well-behaved stubs)", () => {
  // The caller OWNS the notePathForFolder read (module contract), so every
  // stub here is non-throwing. A throwing stub is out of contract and MUST NOT
  // be defended against inside the module — it is intentionally absent.
  const wellBehavedStubs = (p: string): NotePathReader[] => [
    reads(null),
    reads(undefined),
    reads(""),
    reads(p), // affirms whatever path is asked about
    (folder) => folder, // echoes the folder
    (folder) => `${folder}/note.md`, // derives a plausible note
    reads("unrelated/note.md"),
  ];

  it.each(ADVERSARIAL_PATHS.map((p): [string, string] => [label(p), p]))(
    "%s",
    (_name, p) => {
      const derivedFolder = hubRowChildFolderPath(p); // null or string, no throw
      expect(derivedFolder === null || typeof derivedFolder === "string").toBe(true);

      for (const stub of wellBehavedStubs(p)) {
        // No export throws on any adversarial path with a well-behaved stub.
        expect(() => hubRowChildFolderPath(p)).not.toThrow();
        expect(() => isHubRowPath(p, stub)).not.toThrow();
        expect(() => planHubRowDeleteCascade(p, stub)).not.toThrow();
        expect(() => planHubRowRenameCascade(p, HUB_ROW_PATH, stub)).not.toThrow();
        expect(() => planHubRowRenameCascade(HUB_ROW_PATH, p, stub)).not.toThrow();
        expect(() => planHubRowRenameCascade(p, p, stub)).not.toThrow();

        expect(typeof isHubRowPath(p, stub)).toBe("boolean");

        // Shape + folder-derivation invariants hold for every produced plan.
        const del = planHubRowDeleteCascade(p, stub);
        expect(isValidPlan(del)).toBe(true);
        if (del.kind === "delete") expect(del.folder).toBe(derivedFolder);

        for (const other of [HUB_ROW_PATH, "", p]) {
          const forward = planHubRowRenameCascade(p, other, stub);
          expect(isValidPlan(forward)).toBe(true);
          if (forward.kind === "rename") {
            expect(forward.fromFolder).toBe(hubRowChildFolderPath(p));
            expect(forward.toFolder).toBe(hubRowChildFolderPath(other));
            // A produced rename plan always genuinely moves the folder.
            expect(forward.fromFolder).not.toBe(forward.toFolder);
          }

          const backward = planHubRowRenameCascade(other, p, stub);
          expect(isValidPlan(backward)).toBe(true);
          if (backward.kind === "rename") {
            expect(backward.fromFolder).toBe(hubRowChildFolderPath(other));
            expect(backward.toFolder).toBe(hubRowChildFolderPath(p));
            expect(backward.fromFolder).not.toBe(backward.toFolder);
          }
        }
      }
    }
  );
});
