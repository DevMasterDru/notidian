import {
  movePath,
  parseURI,
  renamePathWithExtension,
  renamePathWithoutExtension,
  uriForFolder,
} from "shared/utils/uri";

/**
 * uri.ts owns path manipulation, which is row identity in Notidian: markdown
 * file paths and basenames own row identity and default titles (ADR 0014/0016).
 * A wrong reparent or rename here silently corrupts which row a file *is*, so
 * this surface earns dedicated property + adversarial coverage.
 *
 * These functions are pure string transforms (no I/O, no normalization), so the
 * suite is fully offline-verifiable (Q1). Where the current implementation has a
 * genuine bug, the test is labelled CHARACTERIZATION: it pins today's behavior so
 * a future fix is a deliberate, reviewed change — never a silent regression — and
 * the bug is captured in a follow-up bead rather than patched blindly here.
 */

describe("parseURI", () => {
  describe("plain vault paths", () => {
    it("parses a bare folder/file path as a vault-scheme path with no authority", () => {
      const uri = parseURI("Folder/Note.md");
      expect(uri.scheme).toBe("vault");
      expect(uri.authority).toBeNull();
      expect(uri.path).toBe("Folder/Note.md");
      expect(uri.basePath).toBe("Folder/Note.md");
      expect(uri.fullPath).toBe("Folder/Note.md");
      expect(uri.ref).toBeNull();
      expect(uri.refType).toBeNull();
      expect(uri.query).toBeNull();
      expect(uri.trailSlash).toBe(false);
    });

    it("preserves fullPath verbatim while stripping decorations from path", () => {
      const uri = parseURI("Folder/Note.md#^block|Alias?k=v");
      expect(uri.fullPath).toBe("Folder/Note.md#^block|Alias?k=v");
      expect(uri.path).toBe("Folder/Note.md");
    });
  });

  describe("scheme + authority (spaces://)", () => {
    it("splits scheme, authority, and relative path on a spaces:// URI", () => {
      const uri = parseURI("vault://Space/Note.md");
      expect(uri.scheme).toBe("vault");
      expect(uri.authority).toBe("Space");
      expect(uri.path).toBe("Note.md");
      expect(uri.basePath).toBe("vault://Space/Note.md");
    });

    it("keeps spaces in an authority name (spaces://My Space/...)", () => {
      const uri = parseURI("spaces://My Space/#*rowItem");
      expect(uri.scheme).toBe("spaces");
      expect(uri.authority).toBe("My Space");
      expect(uri.ref).toBe("rowItem");
      expect(uri.refType).toBe("frame");
      expect(uri.basePath).toBe("spaces://My Space");
    });

    it("treats a $-prefixed authority as a space token ($kit)", () => {
      const uri = parseURI("spaces://$kit/#*rowItem");
      expect(uri.authority).toBe("$kit");
      expect(uri.refType).toBe("frame");
      expect(uri.refStr).toBe("*rowItem");
    });

    it("retains a trailing relative path under a #-prefixed authority", () => {
      const uri = parseURI("spaces://#tag/path");
      expect(uri.authority).toBe("#tag");
      expect(uri.path).toBe("path");
      expect(uri.trailSlash).toBe(false);
    });

    it("normalizes a bare $-space authority to a root '/' path", () => {
      const uri = parseURI("spaces://$tag");
      expect(uri.authority).toBe("$tag");
      expect(uri.path).toBe("/");
      expect(uri.trailSlash).toBe(true);
      expect(uri.basePath).toBe("spaces://$tag");
    });
  });

  describe("reference (#) parsing inside a space", () => {
    it("maps '^' to a context reference inside a space", () => {
      const uri = parseURI("spaces://$kit/#^foo");
      expect(uri.refType).toBe("context");
      expect(uri.ref).toBe("foo");
      expect(uri.refStr).toBe("^foo");
    });

    it("maps '*' to a frame reference inside a space", () => {
      const uri = parseURI("spaces://$kit/#*rowItem");
      expect(uri.refType).toBe("frame");
      expect(uri.ref).toBe("rowItem");
    });

    it("maps ';' to an action reference inside a space", () => {
      const uri = parseURI("spaces://$kit/#;act");
      expect(uri.refType).toBe("action");
      expect(uri.ref).toBe("act");
      expect(uri.refStr).toBe(";act");
    });
  });

  describe("reference (#) parsing on a plain path", () => {
    it("maps '^' to a block reference", () => {
      const uri = parseURI("Folder/Note.md#^block");
      expect(uri.refType).toBe("block");
      expect(uri.ref).toBe("block");
      expect(uri.refStr).toBe("^block");
      expect(uri.path).toBe("Folder/Note.md");
    });

    /**
     * FIXED (Notidian-6ok): a heading ref's first char is real content, not a
     * consumed sigil, so it must survive into `ref`. parseURI now only slices a
     * leading char when it is a recognized sigil (^,*,;). refStr correspondingly
     * no longer re-prepends a phantom sigil.
     */
    it("keeps the full heading text in ref (no leading-char drop)", () => {
      const uri = parseURI("Note.md#heading");
      expect(uri.refType).toBe("heading");
      expect(uri.ref).toBe("heading");
      expect(uri.refStr).toBe("heading");
    });

    /**
     * '*' is only a recognized refType *inside* a space; on a plain path it falls
     * through to 'heading'. It is still a sigil character, so it is consumed from
     * ref but reconstructed into refStr — no real content char is lost here.
     */
    it("treats a leading '*' on a plain path as a consumed sigil (heading refType)", () => {
      const uri = parseURI("Note.md#*frame");
      expect(uri.refType).toBe("heading");
      expect(uri.ref).toBe("frame"); // '*' is a sigil, correctly consumed
      expect(uri.refStr).toBe("*frame");
    });
  });

  describe("alias (|) parsing", () => {
    it("extracts an alias after '|' and removes it from path", () => {
      const uri = parseURI("Note.md|Alias");
      expect(uri.alias).toBe("Alias");
      expect(uri.path).toBe("Note.md");
    });

    it("parses alias-before-ref order (Note.md|al#h)", () => {
      const uri = parseURI("Note.md|al#h");
      expect(uri.alias).toBe("al");
      expect(uri.path).toBe("Note.md");
      expect(uri.refType).toBe("heading");
    });
  });

  describe("query (?) parsing", () => {
    it("parses a single-key query into an object", () => {
      const uri = parseURI("Note.md?key=val");
      expect(uri.query).toEqual({ key: "val" });
      expect(uri.path).toBe("Note.md");
    });

    it("parses a multi-key query", () => {
      const uri = parseURI("Note.md?key=val&k2=v2");
      expect(uri.query).toEqual({ key: "val", k2: "v2" });
    });

    it("URI-decodes percent-encoded spaces in query values", () => {
      const uri = parseURI("Note.md?k=a%20b");
      expect(uri.query).toEqual({ k: "a b" });
    });
  });

  describe("malformed / adversarial input", () => {
    it("returns an empty vault path for the empty string", () => {
      const uri = parseURI("");
      expect(uri.scheme).toBe("vault");
      expect(uri.path).toBe("");
      expect(uri.authority).toBeNull();
      expect(uri.trailSlash).toBe(false);
    });

    it("treats a bare '/' as a root path with a trailing slash", () => {
      const uri = parseURI("/");
      expect(uri.path).toBe("/");
      expect(uri.trailSlash).toBe(true);
    });

    it("strips a trailing slash from path but flags trailSlash", () => {
      const uri = parseURI("Folder/");
      expect(uri.path).toBe("Folder");
      expect(uri.trailSlash).toBe(true);
    });

    it("parses an empty scheme and empty authority from a lone '://'", () => {
      const uri = parseURI("://");
      expect(uri.scheme).toBe("");
      expect(uri.authority).toBe("");
      expect(uri.path).toBe("");
    });

    it("parses a scheme-only 'vault://' into an empty authority and path", () => {
      const uri = parseURI("vault://");
      expect(uri.scheme).toBe("vault");
      expect(uri.authority).toBe("");
      expect(uri.path).toBe("");
    });

    it("keeps a Unicode authority name byte-for-byte (no normalization)", () => {
      // Ties to Notidian-p3j: path manipulation is byte-preserving; NFC/NFD
      // normalization (if any) is the validator's job, not uri.ts's.
      const uri = parseURI("spaces://Café/Note.md");
      expect(uri.authority).toBe("Café");
      expect(uri.path).toBe("Note.md");
    });
  });

  describe("Unicode NFC vs NFD (byte-preserving)", () => {
    it("does not normalize NFC vs NFD basenames (they remain distinct)", () => {
      const nfc = "café.md"; // precomposed é
      const nfd = "café.md"; // e + combining acute accent
      expect(nfc).not.toBe(nfd);
      expect(parseURI(nfc).path).toBe(nfc);
      expect(parseURI(nfd).path).toBe(nfd);
      expect(parseURI(nfc).path).not.toBe(parseURI(nfd).path);
    });
  });
});

describe("movePath", () => {
  it("preserves the basename when reparenting under a new folder", () => {
    expect(movePath("Folder/Note.md", "New")).toBe("New/Note.md");
  });

  it("reparents a root-level file under a folder", () => {
    expect(movePath("Note.md", "New")).toBe("New/Note.md");
  });

  it("preserves the basename across deeply nested parents", () => {
    expect(movePath("a/b/c.md", "x/y")).toBe("x/y/c.md");
  });

  /**
   * FIXED (Notidian-6ok): an empty (or "/") parent means "root" and now yields
   * the bare basename instead of a leading-slash path. This also aligns
   * movePathToNewSpaceAtIndex, whose pre-existence check already computes the
   * bare name for a "/" parent.
   */
  it("treats an empty parent as root (bare basename, no leading slash)", () => {
    expect(movePath("Note.md", "")).toBe("Note.md");
  });

  it("treats a '/' parent as root (bare basename)", () => {
    expect(movePath("Folder/Note.md", "/")).toBe("Note.md");
  });

  /**
   * FIXED (Notidian-6ok): a trailing slash on newParent is now collapsed, so the
   * result no longer contains a double slash.
   */
  it("collapses a trailing-slash parent (no double slash)", () => {
    expect(movePath("Folder/Note.md", "New/")).toBe("New/Note.md");
  });

  /**
   * CHARACTERIZATION (pinned, not normalized): a source path that itself ends in
   * a slash has an empty last segment, so the result ends in a slash. There is no
   * basename to fabricate from a malformed source, and no caller produces this
   * shape, so it is deliberately left as-is (Notidian-6ok decision).
   */
  it("CHARACTERIZATION: a trailing-slash source yields an empty basename", () => {
    expect(movePath("Folder/", "New")).toBe("New/");
    expect(movePath("", "New")).toBe("New/");
  });

  describe("property: reparenting preserves the basename", () => {
    const basenames = ["Note.md", "c.md", "café.md", ".gitignore", "no-ext"];
    const parents = ["New", "x/y", "Deeply/Nested/Folder"];
    for (const base of basenames) {
      for (const parent of parents) {
        const src = `Some/Old/${base}`;
        it(`move(${JSON.stringify(src)}, ${JSON.stringify(parent)}) keeps basename ${JSON.stringify(base)}`, () => {
          const moved = movePath(src, parent);
          expect(moved).toBe(`${parent}/${base}`);
          expect(moved.split("/").pop()).toBe(base);
        });
      }
    }
  });

  describe("property: move-then-move-back is stable for the basename", () => {
    const cases = [
      "Folder/Note.md",
      "a/b/c.md",
      "Root.md",
      "Space/café.md",
    ];
    for (const src of cases) {
      it(`${JSON.stringify(src)} round-trips its basename through a foreign parent`, () => {
        const original = src.split("/").pop();
        const originalParent = src.substring(0, src.lastIndexOf("/")) || "";
        const moved = movePath(src, "Temp/Holding");
        // Move back to the original parent; basename must survive both hops.
        const movedBack = movePath(moved, originalParent || "Root");
        expect(movedBack.split("/").pop()).toBe(original);
      });
    }
  });
});

describe("renamePathWithoutExtension", () => {
  it("replaces only the basename, dropping any extension", () => {
    expect(renamePathWithoutExtension("Folder/Note.md", "Renamed")).toBe(
      "Folder/Renamed"
    );
  });

  it("renames a root-level file with no directory prefix", () => {
    expect(renamePathWithoutExtension("Note.md", "Renamed")).toBe("Renamed");
  });

  it("renames an extension-less item (a space/folder) in place", () => {
    expect(renamePathWithoutExtension("Folder", "Renamed")).toBe("Renamed");
  });

  it("renames a nested folder, preserving the parent path", () => {
    expect(renamePathWithoutExtension("a/b/Inner", "Renamed")).toBe(
      "a/b/Renamed"
    );
  });

  it("renames an empty path to just the new name", () => {
    expect(renamePathWithoutExtension("", "Renamed")).toBe("Renamed");
  });

  it("keeps a Unicode (NFC) new name byte-for-byte", () => {
    expect(renamePathWithoutExtension("Folder/old", "café")).toBe(
      "Folder/café"
    );
  });

  describe("property: only the basename segment changes", () => {
    const dirs = ["Folder", "a/b/c", "My Space"];
    for (const dir of dirs) {
      it(`preserves directory ${JSON.stringify(dir)} unchanged`, () => {
        const result = renamePathWithoutExtension(`${dir}/anything.md`, "Renamed");
        expect(result).toBe(`${dir}/Renamed`);
        expect(result.substring(0, result.lastIndexOf("/"))).toBe(dir);
      });
    }
  });
});

describe("renamePathWithExtension", () => {
  it("preserves the original extension while replacing the name", () => {
    expect(renamePathWithExtension("Folder/Note.md", "Renamed")).toBe(
      "Folder/Renamed.md"
    );
  });

  it("renames a root-level file, keeping its extension", () => {
    expect(renamePathWithExtension("Note.md", "Renamed")).toBe("Renamed.md");
  });

  it("keeps only the final extension on a multi-dot name (tar.gz -> .gz)", () => {
    expect(renamePathWithExtension("archive.tar.gz", "Renamed")).toBe(
      "Renamed.gz"
    );
  });

  it("collapses a multi-dot basename to its final extension", () => {
    expect(renamePathWithExtension("My.Note.md", "Renamed")).toBe("Renamed.md");
  });

  it("adds no extension when the source has none", () => {
    expect(renamePathWithExtension("NoExt", "Renamed")).toBe("Renamed");
    expect(renamePathWithExtension("Folder/NoExt", "Renamed")).toBe(
      "Folder/Renamed"
    );
  });

  /**
   * FIXED (Notidian-6ok): a leading-dot-only basename is a dotfile, not an
   * extension boundary. The extension scan now ignores a dot at index 0 of the
   * basename, so ".md" is the dotfile named "md" (no extension) and renaming it
   * drops the dotfile name entirely, consistent with ".gitignore" below.
   */
  it("treats a leading-dot-only basename ('.md') as a dotfile with no extension", () => {
    expect(renamePathWithExtension(".md", "X")).toBe("X");
  });

  /**
   * FIXED (Notidian-6ok): a dotfile basename like ".gitignore" has its only dot
   * at index 0, which is part of the dotfile name, not an extension boundary.
   * The scan ignores the index-0 dot, so renaming yields just the new name.
   */
  it("renames a dotfile to the bare new name (a dotfile has no extension)", () => {
    expect(renamePathWithExtension(".gitignore", "Renamed")).toBe("Renamed");
    expect(renamePathWithExtension("Folder/.env", "Renamed")).toBe(
      "Folder/Renamed"
    );
  });

  /**
   * FIXED (Notidian-6ok, serious): extension detection now scopes lastIndexOf('.')
   * to the basename (after the final '/'), never the whole path. A dotless file
   * under a folder whose name contains a dot no longer mistakes the directory dot
   * for the file extension, so it can no longer splice the directory tail
   * (including a path separator) into the new name and relocate the row identity.
   */
  it("does not let a dotted directory leak into a dotless file's extension", () => {
    expect(renamePathWithExtension("My.Folder/Note", "Renamed")).toBe(
      "My.Folder/Renamed"
    );
    expect(renamePathWithExtension("a.b/c.d/NoExt", "Renamed")).toBe(
      "a.b/c.d/Renamed"
    );
  });

  it("renames an empty path to just the new name", () => {
    expect(renamePathWithExtension("", "Renamed")).toBe("Renamed");
  });

  it("keeps a Unicode (NFC) new name and original extension", () => {
    expect(renamePathWithExtension("Folder/old.md", "café")).toBe(
      "Folder/café.md"
    );
  });

  describe("property: the directory and extension survive a name change (well-formed inputs)", () => {
    // Restricted to inputs without the dotted-directory bug: every basename here
    // carries a real, well-formed extension so the extension scan stays inside it.
    const dirs = ["Folder", "a/b/c", "My Space"];
    const exts = [".md", ".png", ".canvas"];
    for (const dir of dirs) {
      for (const ext of exts) {
        it(`dir ${JSON.stringify(dir)} + ext ${JSON.stringify(ext)} are preserved`, () => {
          const result = renamePathWithExtension(`${dir}/original${ext}`, "Renamed");
          expect(result).toBe(`${dir}/Renamed${ext}`);
          expect(result.substring(0, result.indexOf("/Renamed"))).toBe(dir);
          expect(result.endsWith(ext)).toBe(true);
        });
      }
    }
  });
});

describe("renamePath family: rename then rename-back is stable (well-formed inputs)", () => {
  it("withExtension: renaming to a temp name and back preserves the full path", () => {
    const original = "Folder/Note.md";
    const renamed = renamePathWithExtension(original, "Temp");
    expect(renamed).toBe("Folder/Temp.md");
    const back = renamePathWithExtension(renamed, "Note");
    expect(back).toBe(original);
  });

  it("withoutExtension: renaming a folder to a temp name and back is stable", () => {
    const original = "a/b/Inner";
    const renamed = renamePathWithoutExtension(original, "Temp");
    expect(renamed).toBe("a/b/Temp");
    const back = renamePathWithoutExtension(renamed, "Inner");
    expect(back).toBe(original);
  });
});

describe("uriForFolder", () => {
  it("builds a vault-scheme folder URI with trailSlash set and no decorations", () => {
    const uri = uriForFolder("Folder");
    expect(uri).toEqual({
      basePath: "Folder",
      fullPath: "Folder",
      authority: null,
      path: "Folder",
      scheme: "vault",
      alias: null,
      ref: null,
      refStr: null,
      refType: null,
      query: null,
      trailSlash: true,
    });
  });

  it("does not parse references or queries embedded in the folder path", () => {
    // uriForFolder is the folder-vs-file disambiguator: it takes the path as-is
    // and never runs parseURI, so '#' and '?' stay literal in the path.
    const uri = uriForFolder("Notes/Sub#odd?weird");
    expect(uri.path).toBe("Notes/Sub#odd?weird");
    expect(uri.ref).toBeNull();
    expect(uri.query).toBeNull();
    expect(uri.trailSlash).toBe(true);
  });

  it("differs from parseURI on a folder path by forcing trailSlash and skipping ref parsing", () => {
    const folder = uriForFolder("Notes/Daily#today");
    const file = parseURI("Notes/Daily#today");
    expect(folder.trailSlash).toBe(true);
    expect(folder.ref).toBeNull();
    // parseURI would interpret the '#today' as a heading reference.
    expect(file.refType).toBe("heading");
  });
});
