import {
  movePath,
  parseURI,
  renamePathWithExtension,
  renamePathWithoutExtension,
  uriForFolder,
} from "shared/utils/uri";
import type { URI, PathRefTypes } from "shared/types/path";

/**
 * TOTALITY + INVARIANT NET for the pure path-URI primitives in uri.ts
 * (Notidian-c3y3). These functions ARE row identity: markdown file paths and
 * basenames own row identity and default titles (ADR 0014/0016), and
 * resolvePath / rename / move all build on them. A crash or a silent reparent
 * here corrupts *which row a file is*, so this surface earns a dedicated
 * totality net (never-throws + always-well-formed output) on top of the
 * example-based cases in uri.test.ts.
 *
 * Everything here is a pure string transform (no I/O, no normalization), so the
 * suite is fully offline-verifiable (Q1). Where the current implementation has a
 * genuine defect, the test is labelled CHARACTERIZATION: it pins today's behavior
 * so a future fix is a deliberate, reviewed change — never a silent regression —
 * and the defect is tracked in a follow-up bead rather than patched blindly here
 * (the same discipline uri.test.ts applied to Notidian-6ok).
 *
 * KNOWN TOTALITY BOUNDARY (tracked as Notidian-4ncs): parseURI is total on
 * every input below EXCEPT a malformed percent-escape inside a query string,
 * where parseQuery's decodeURIComponent raises URIError. That single gap is
 * pinned as a CHARACTERIZATION block; the broad never-throws corpus deliberately
 * excludes malformed '%' so it asserts the totality that actually holds. When
 * Notidian-4ncs is fixed, flip that block to never-throws assertions and fold
 * the malformed-'%' inputs into the broad corpus.
 */

// The full PathRefTypes union — parseURI only ever emits a subset at runtime,
// but a well-formed refType must be one of these (or null), never undefined or
// some other leak.
const ALL_REF_TYPES: ReadonlySet<PathRefTypes> = new Set<PathRefTypes>([
  "context",
  "frame",
  "action",
  "vis",
  "block",
  "heading",
  "unknown",
]);

/**
 * Asserts the invariant that parseURI's output is ALWAYS a well-formed URI
 * object regardless of input: every field is present (never `undefined`),
 * correctly typed, and fullPath is the input byte-for-byte. This is the core
 * "typed output, no undefined leaks" totality guarantee.
 */
const assertWellFormedURI = (uri: URI, input: string): void => {
  // fullPath is the verbatim input — the one field callers rely on to recover
  // the original address after decorations are stripped.
  expect(uri.fullPath).toBe(input);

  // Always-string fields.
  expect(typeof uri.basePath).toBe("string");
  expect(typeof uri.scheme).toBe("string");
  expect(typeof uri.path).toBe("string");
  expect(typeof uri.fullPath).toBe("string");

  // Always-boolean.
  expect(typeof uri.trailSlash).toBe("boolean");

  // Nullable-but-never-undefined fields: absence is encoded as null, so a leaked
  // `undefined` (which would slip past `== null` checks differently than null and
  // JSON-serialize to nothing) is a defect.
  const nullableStringFields: Array<keyof URI> = [
    "authority",
    "alias",
    "ref",
    "refStr",
  ];
  for (const field of nullableStringFields) {
    const value = uri[field];
    expect(value === null || typeof value === "string").toBe(true);
    expect(value).not.toBeUndefined();
  }

  // refType: null or a member of the PathRefTypes union — never undefined, never
  // an arbitrary string.
  expect(uri.refType === null || ALL_REF_TYPES.has(uri.refType as PathRefTypes)).toBe(true);
  expect(uri.refType).not.toBeUndefined();

  // query: null or a flat string->string map (values may be the literal string
  // "undefined" from decodeURIComponent(undefined), which is still a string).
  expect(uri.query === null || typeof uri.query === "object").toBe(true);
  expect(uri.query).not.toBeUndefined();
  if (uri.query) {
    for (const [k, v] of Object.entries(uri.query)) {
      expect(typeof k).toBe("string");
      expect(typeof v).toBe("string");
    }
  }

  // No field may be undefined at all (defends against future fields too).
  for (const value of Object.values(uri)) {
    expect(value).not.toBeUndefined();
  }
};

/**
 * A broad, hand-picked adversarial corpus. Deliberately excludes a malformed
 * percent-escape inside a query (the one known non-total input, characterized
 * separately). Well-formed percent-escapes (%20) are included.
 */
const ADVERSARIAL_INPUTS: readonly string[] = [
  // Empty / separators only.
  "",
  " ",
  "/",
  "//",
  "///",
  "////",
  "#",
  "##",
  "###",
  "|",
  "||",
  "?",
  "??",
  ".",
  "..",
  "...",
  "./",
  "../",
  "../../etc/passwd",
  "....//....//",

  // Plain paths.
  "Note.md",
  "Folder/Note.md",
  "a/b/c/d/e.md",
  "no-extension",
  ".gitignore",
  "Folder/.env",
  "archive.tar.gz",
  "My.Folder/Note",
  "a.b/c.d/NoExt",

  // Trailing / leading separators on plain paths.
  "Folder/",
  "Folder//",
  "/Folder",
  "//Folder//",
  "Note.md#",
  "Note.md|",
  "Note.md?",
  "#Note.md",
  "|Note.md",
  "?Note.md",

  // References (#) — recognized and unrecognized sigils.
  "Note.md#heading",
  "Note.md#^block",
  "Note.md#*frame",
  "Note.md#;action",
  "Note.md#^^caret",
  "Note.md#a#b#c",
  "Note.md###",
  "Note.md#^",
  "Note.md#*",
  "Note.md#;",

  // Aliases (|) and their ordering vs refs.
  "Note.md|Alias",
  "Note.md|a|b|c",
  "Note.md|al#h",
  "Note.md#h|a",
  "Note.md|#",
  "Note.md#|",

  // Queries (?) — well-formed and structurally odd, but never a malformed '%'.
  "Note.md?k=v",
  "Note.md?k=v&k2=v2",
  "Note.md?k",
  "Note.md?=v",
  "Note.md?k=",
  "Note.md?a=1&&b=2",
  "Note.md?k=a%20b",
  "Note.md?k=v#h|a",

  // Scheme + authority (spaces://) shapes.
  "vault://Space/Note.md",
  "spaces://My Space/#*rowItem",
  "spaces://$kit/#*rowItem",
  "spaces://$tag",
  "spaces://#tag/path",
  "spaces://#tag/path/sub#h",
  "spaces://$kit/sub/deep.md#^ctx",
  "://",
  "vault://",
  "ht!tp://x/y",
  "a://b://c",
  "scheme://",
  "://authority/path",
  "spaces://",
  "spaces://#",
  "spaces://$",

  // Unicode / control / exotic bytes (byte-preserving; validator's job to
  // normalize, not uri.ts — ties to Notidian-p3j).
  "Café/Note.md",
  "café.md",
  "café.md", // NFD form of the above; must NOT collapse to the NFC form
  "📁/note 📝.md",
  "spaces://Café/#^ctx",
  "a\tb.md",
  "a\nb.md",
  "a\u0000b.md",
  "\u200bzero-width.md",
  "Note\\with\\backslashes.md",
  "こんにちは/世界.md",
];

describe("parseURI — totality (never throws, always well-formed)", () => {
  describe("hand-picked adversarial corpus", () => {
    it.each(ADVERSARIAL_INPUTS.map((input) => [JSON.stringify(input), input] as const))(
      "does not throw and returns a well-formed URI for %s",
      (_label, input) => {
        let uri!: URI;
        expect(() => {
          uri = parseURI(input);
        }).not.toThrow();
        assertWellFormedURI(uri, input);
      }
    );
  });

  describe("combinatorial fuzz corpus (deterministic, no random)", () => {
    // Cartesian product of structural fragments. Kept free of '%' so no member
    // can accidentally hit the malformed-percent totality gap. This exercises
    // arbitrary orderings of the scheme/authority/ref/alias/query separators —
    // the exact interactions the hand-picked list can't enumerate.
    const heads = ["", "vault://", "spaces://", "://", "s://$k/", "s://#t/"];
    const bodies = ["", "a", "a/b", "Folder/Note.md", "café.md", "  ", "x.y.z"];
    const decorations = ["", "#", "#h", "#^b", "#*f", "#;a", "|al", "?q=1", "/"];
    const tails = ["", "#", "|", "?", "/", "##", "||"];

    const fuzzInputs: string[] = [];
    for (const h of heads) {
      for (const b of bodies) {
        for (const d of decorations) {
          for (const t of tails) {
            fuzzInputs.push(h + b + d + t);
          }
        }
      }
    }

    it(`covers ${fuzzInputs.length} generated inputs without throwing`, () => {
      for (const input of fuzzInputs) {
        let uri!: URI;
        expect(() => {
          uri = parseURI(input);
        }).not.toThrow();
        assertWellFormedURI(uri, input);
      }
    });
  });

  it("does not throw on a very long input and preserves it in fullPath", () => {
    const long = "Deeply/".repeat(20000) + "leaf.md#^" + "z".repeat(20000);
    let uri!: URI;
    expect(() => {
      uri = parseURI(long);
    }).not.toThrow();
    expect(uri.fullPath).toBe(long);
    expect(uri.fullPath.length).toBe(long.length);
    expect(typeof uri.path).toBe("string");
  });

  it("preserves fullPath byte-for-byte for every corpus input", () => {
    for (const input of ADVERSARIAL_INPUTS) {
      expect(parseURI(input).fullPath).toBe(input);
    }
  });

  it("never emits a leaked-sigil ref: refStr recomposes from ref for consumed sigils", () => {
    // For any input, when a sigil was consumed the sigil char must reappear in
    // refStr; when it wasn't, refStr equals ref verbatim. Either way refStr is a
    // string or null, never a `"^null"`-style leak.
    for (const input of ADVERSARIAL_INPUTS) {
      const { ref, refStr } = parseURI(input);
      if (ref === null) {
        expect(refStr).toBeNull();
      } else {
        expect(typeof refStr).toBe("string");
        // refStr is ref itself, or a single recognized sigil prepended to it.
        expect(refStr === ref || /^[\^*;]/.test(refStr as string)).toBe(true);
      }
    }
  });
});

/**
 * CHARACTERIZATION (Notidian-c3y3 discovery → fix tracked as Notidian-4ncs):
 * parseURI is NOT total on a malformed percent-escape inside a query. parseQuery
 * runs decodeURIComponent on each key/value, which raises URIError("URI
 * malformed") for a dangling or invalid '%'. This is the single documented
 * totality gap; a future fix should make parseQuery fall back to the raw
 * substring so parseURI never throws. Pinned here so that fix is deliberate.
 */
describe("parseURI — known totality boundary (malformed percent in query)", () => {
  it("CHARACTERIZATION: a dangling '%' in a query value throws URIError", () => {
    expect(() => parseURI("Note.md?k=%")).toThrow(URIError);
  });

  it("CHARACTERIZATION: an invalid '%ZZ' escape in a query value throws URIError", () => {
    expect(() => parseURI("Note.md?k=%ZZ")).toThrow(URIError);
  });

  it("CHARACTERIZATION: a malformed '%' in a query KEY also throws URIError", () => {
    expect(() => parseURI("Note.md?%=v")).toThrow(URIError);
  });

  it("a '%' OUTSIDE a query (no '?') is inert and never throws", () => {
    // The gap is confined to parseQuery: a bare '%' in the path/authority is
    // just a byte, so totality holds everywhere except after a '?'.
    expect(() => parseURI("Folder/100%done.md")).not.toThrow();
    expect(parseURI("Folder/100%done.md").path).toBe("Folder/100%done.md");
  });
});

describe("movePath — invariants", () => {
  // Parents pre-normalized (non-empty, no trailing slash) so the exact-result
  // assertion needs no coupling to removeTrailingSlashFromFolder.
  const NORMAL_PARENTS = ["New", "x/y", "Deeply/Nested/Folder", "My Space", "a.b"];
  const SOURCES = [
    "Folder/Note.md",
    "Note.md",
    "a/b/c.md",
    "Space/café.md",
    ".gitignore",
    "Folder/archive.tar.gz",
    "no-ext",
    "A/B/C/D/E/leaf.canvas",
  ];

  it("preserves the basename for every source × parent (universal pop invariant)", () => {
    // The basename is the last '/'-segment; a correct reparent never alters it.
    // This holds even for root ('' / '/') parents, whose bare-basename result
    // still pops to the same basename.
    const parentsIncludingRoot = [...NORMAL_PARENTS, "", "/"];
    for (const src of SOURCES) {
      const expectedBase = src.split("/").pop();
      for (const parent of parentsIncludingRoot) {
        const moved = movePath(src, parent);
        expect(moved.split("/").pop()).toBe(expectedBase);
      }
    }
  });

  it("swaps ONLY the parent: result === parent + '/' + basename (normalized parents)", () => {
    for (const src of SOURCES) {
      const base = src.split("/").pop();
      for (const parent of NORMAL_PARENTS) {
        expect(movePath(src, parent)).toBe(`${parent}/${base}`);
      }
    }
  });

  it("is idempotent in newParent: move(move(p, q), q) === move(p, q)", () => {
    // Applying the same destination twice must equal applying it once — the
    // second move re-reads the (unchanged) basename under the same parent.
    const parents = [...NORMAL_PARENTS, "", "/", "New/"];
    for (const src of SOURCES) {
      for (const parent of parents) {
        const once = movePath(src, parent);
        expect(movePath(once, parent)).toBe(once);
      }
    }
  });

  it("moving a file into its own current parent dir is the identity", () => {
    for (const src of SOURCES) {
      const slash = src.lastIndexOf("/");
      if (slash <= 0) continue; // only meaningful for nested sources
      const ownParent = src.substring(0, slash);
      expect(movePath(src, ownParent)).toBe(src);
    }
  });

  it("never throws and always returns a string across the adversarial corpus", () => {
    const parents = [...NORMAL_PARENTS, "", "/", "New/", "a//", "spaces://$k"];
    for (const src of [...SOURCES, ...ADVERSARIAL_INPUTS]) {
      for (const parent of parents) {
        let out!: string;
        expect(() => {
          out = movePath(src, parent);
        }).not.toThrow();
        expect(typeof out).toBe("string");
      }
    }
  });

  /**
   * CHARACTERIZATION: a trailing-slash SOURCE has an empty final segment, so the
   * basename is '' and the result ends in a slash. There is no basename to
   * fabricate from a malformed source and no caller produces this shape, so it
   * is deliberately pinned (Notidian-6ok decision), not normalized.
   */
  it("CHARACTERIZATION: a trailing-slash source yields an empty basename", () => {
    expect(movePath("Folder/", "New")).toBe("New/");
    expect(movePath("", "New")).toBe("New/");
  });
});

describe("renamePathWithExtension — invariants", () => {
  const WELL_FORMED_DIRS = ["Folder", "a/b/c", "My Space", "My.Folder", "a.b/c.d"];
  const WELL_FORMED_EXTS = [".md", ".png", ".canvas", ".tar.gz"];

  it("preserves the extension and only swaps the name (incl. dotted directories)", () => {
    // The extension scan is basename-scoped (post-final-'/'), so a dot in a
    // parent folder name is never mistaken for the file extension — the
    // previously-serious identity hazard (Notidian-6ok) stays fixed.
    for (const dir of WELL_FORMED_DIRS) {
      for (const ext of WELL_FORMED_EXTS) {
        // For a multi-dot ext like ".tar.gz" the primitive keeps only the FINAL
        // dot-suffix (".gz"), which is its documented contract.
        const finalExt = ext.substring(ext.lastIndexOf("."));
        const result = renamePathWithExtension(`${dir}/original${ext}`, "Renamed");
        expect(result).toBe(`${dir}/Renamed${finalExt}`);
        expect(result.endsWith(finalExt)).toBe(true);
        expect(result.startsWith(`${dir}/`)).toBe(true);
      }
    }
  });

  it("keeps the original directory prefix — a rename cannot escape upward or sideways", () => {
    // SAFETY INVARIANT: whatever newName is (even '..', '/', or an absolute-
    // looking string), the result is always rooted at the ORIGINAL parent dir.
    // The primitive is byte-preserving and does NOT sanitize; upstream
    // sanitizeFolderName (sanitizers.ts) strips '/' before it ever reaches here,
    // but the primitive itself still guarantees the row can only nest deeper,
    // never jump to a different parent.
    const dir = "Folder/Sub";
    const adversarialNames = ["Renamed", "", "a/b", "../escape", "/abs", ".", ".."];
    for (const name of adversarialNames) {
      const result = renamePathWithExtension(`${dir}/Note.md`, name);
      expect(result.startsWith(`${dir}/`)).toBe(true);
    }
  });

  it("CHARACTERIZATION: a '/' in the new name nests within the dir (no sanitization)", () => {
    // Pins the verbatim-splice behavior: sanitization is the caller's job.
    expect(renamePathWithExtension("Folder/Note.md", "a/b")).toBe("Folder/a/b.md");
    expect(renamePathWithoutExtension("Folder/Note.md", "a/b")).toBe("Folder/a/b");
  });

  it("CHARACTERIZATION: an empty new name yields a bare dotfile-shaped result, still rooted", () => {
    expect(renamePathWithExtension("Folder/Note.md", "")).toBe("Folder/.md");
    expect(renamePathWithExtension("Note.md", "")).toBe(".md");
  });

  it("CHARACTERIZATION: a trailing-dot basename treats '.' as an empty extension", () => {
    // "Note." -> basename lastIndexOf('.') > 0 -> ext is just "." -> "X.".
    expect(renamePathWithExtension("Note.", "X")).toBe("X.");
  });

  it("never throws and always returns a string across the adversarial corpus", () => {
    for (const path of ADVERSARIAL_INPUTS) {
      let out!: string;
      expect(() => {
        out = renamePathWithExtension(path, "Renamed");
      }).not.toThrow();
      expect(typeof out).toBe("string");
    }
  });
});

describe("renamePathWithoutExtension — invariants", () => {
  const DIRS = ["Folder", "a/b/c", "My Space", "My.Folder"];
  const BASENAMES = ["note.md", "archive.tar.gz", "no-ext", ".gitignore", "a.b.c.d"];

  it("replaces the WHOLE basename (dots and all) and preserves the directory", () => {
    // Unlike the with-extension variant this drops any extension: a multi-dot
    // basename is replaced wholesale, never partially spliced — no corruption.
    for (const dir of DIRS) {
      for (const base of BASENAMES) {
        const result = renamePathWithoutExtension(`${dir}/${base}`, "Renamed");
        expect(result).toBe(`${dir}/Renamed`);
        expect(result.startsWith(`${dir}/`)).toBe(true);
      }
    }
  });

  it("keeps the original directory prefix — cannot escape upward or sideways", () => {
    const dir = "Folder/Sub";
    for (const name of ["Renamed", "", "a/b", "../escape", "."]) {
      expect(renamePathWithoutExtension(`${dir}/note.md`, name).startsWith(`${dir}/`)).toBe(true);
    }
  });

  it("renames a root-level (no-slash) item to just the new name", () => {
    expect(renamePathWithoutExtension("note.md", "Renamed")).toBe("Renamed");
    expect(renamePathWithoutExtension("archive.tar.gz", "Renamed")).toBe("Renamed");
  });

  it("never throws and always returns a string across the adversarial corpus", () => {
    for (const path of ADVERSARIAL_INPUTS) {
      let out!: string;
      expect(() => {
        out = renamePathWithoutExtension(path, "Renamed");
      }).not.toThrow();
      expect(typeof out).toBe("string");
    }
  });
});

describe("round-trip stability (parse ∘ produce is a fixed point on clean paths)", () => {
  // A "clean" path carries no scheme/ref/alias/query and no trailing slash, so
  // parseURI().path recovers it exactly. move/rename/uriForFolder outputs on
  // clean inputs stay clean, which is what makes them safe to re-parse.
  const CLEAN_PATHS = [
    "Folder/Note.md",
    "a/b/c.md",
    "Root.md",
    "Space/café.md",
    "Deeply/Nested/Folder/leaf.canvas",
    "My Space/note.md",
  ];

  it("parseURI recovers a clean path unchanged", () => {
    for (const p of CLEAN_PATHS) {
      expect(parseURI(p).path).toBe(p);
    }
  });

  it("parseURI(movePath(clean, cleanParent)).path === movePath(...)", () => {
    for (const p of CLEAN_PATHS) {
      const moved = movePath(p, "Dest/Folder");
      expect(parseURI(moved).path).toBe(moved);
    }
  });

  it("parseURI(renamePathWithExtension(clean, name)).path === that result", () => {
    for (const p of CLEAN_PATHS) {
      const renamed = renamePathWithExtension(p, "Renamed");
      expect(parseURI(renamed).path).toBe(renamed);
    }
  });

  it("uriForFolder(p).path round-trips through parseURI for clean folder paths", () => {
    for (const p of CLEAN_PATHS) {
      const folderPath = uriForFolder(p).path;
      expect(folderPath).toBe(p);
      expect(parseURI(folderPath).path).toBe(p);
    }
  });

  it("move-then-move-back restores a clean path exactly", () => {
    for (const p of CLEAN_PATHS) {
      const originalParent = p.substring(0, p.lastIndexOf("/"));
      if (!originalParent) continue;
      const away = movePath(p, "Temp/Holding");
      const back = movePath(away, originalParent);
      expect(back).toBe(p);
    }
  });
});
