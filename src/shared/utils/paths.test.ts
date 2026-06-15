import { removeTrailingSlashFromFolder } from "./paths";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — characterization tests for src/shared/utils/paths.ts
// (Notidian-h6uu). This one-line helper had ZERO direct coverage yet is
// foundational to row addressing (ADR 0014/0016: markdown file paths/basenames
// own row identity). It is the trailing-slash normaliser that uri.ts threads
// through the load-bearing seams:
//
//   - parseURI's `basePath` and `path` outputs (uri.ts:107, 112) — the canonical
//     address a row resolves to. A wrong trim here mis-addresses a row.
//   - parseURI's `space`/authority slice (uri.ts:49).
//   - movePath's destination-parent normalisation (uri.ts:132) — so
//     "New/" + basename does not become "New//basename".
//   - filesystem / spaceInfo / db adapters that normalise a folder path before
//     a filesystem or MDB lookup.
//
// It is a PURE string transform — no I/O, no DOM, no vault — so this suite is
// fully offline-verifiable (Q1).
//
// IMPORTANT — characterization, NOT correction. The implementation strips at
// most ONE trailing slash and special-cases the bare root "/":
//
//   const removeTrailingSlashFromFolder = (path) => path == "/"
//     ? path
//     : path.slice(-1) == "/"
//       ? path.substring(0, path.length - 1)
//       : path;
//
// The single observable consequence worth flagging is that it is NOT idempotent
// on inputs ending in MULTIPLE slashes (e.g. "a///" -> "a//", and a second pass
// yields "a/"): a caller that expects a fully-collapsed folder path from one
// call would be surprised. We LOCK today's behavior so any future change to a
// full collapse is a conscious, reviewed decision rather than a silent
// regression in row addressing. No live Notidian caller is currently known to
// feed a multi-slash path through this helper; if one is discovered, file a
// follow-up bead rather than "fixing" it here.
// ---------------------------------------------------------------------------

describe("removeTrailingSlashFromFolder", () => {
  // --- the root special-case: "/" is preserved, never emptied ----------------
  it('preserves the bare root "/" (does NOT empty it)', () => {
    // The `path == "/"` guard exists precisely so root does not collapse to "".
    // parseURI relies on this: an emptied root would mis-address the vault root.
    expect(removeTrailingSlashFromFolder("/")).toBe("/");
  });

  // --- the ordinary, intended case: strip a single trailing slash ------------
  it('strips a single trailing slash: "a/b/" -> "a/b"', () => {
    expect(removeTrailingSlashFromFolder("a/b/")).toBe("a/b");
  });

  it('strips the trailing slash from a single-segment folder: "x/" -> "x"', () => {
    expect(removeTrailingSlashFromFolder("x/")).toBe("x");
  });

  // --- inputs with NO trailing slash pass through untouched -------------------
  it('leaves a path without a trailing slash unchanged: "a/b" -> "a/b"', () => {
    expect(removeTrailingSlashFromFolder("a/b")).toBe("a/b");
  });

  it('leaves a bare single segment unchanged: "x" -> "x"', () => {
    expect(removeTrailingSlashFromFolder("x")).toBe("x");
  });

  // --- empty string: not "/", does not end in "/", so passes through ---------
  it('leaves the empty string unchanged: "" -> ""', () => {
    // "".slice(-1) === "" which is not "/", so the else branch returns "" as-is.
    // movePath's `parent.length == 0` root-collapse depends on this passthrough.
    expect(removeTrailingSlashFromFolder("")).toBe("");
  });

  // --- whitespace-only inputs ------------------------------------------------
  it('leaves a whitespace-only path (no trailing slash) unchanged: "   " -> "   "', () => {
    // The helper never trims whitespace; only a literal trailing "/" is touched.
    expect(removeTrailingSlashFromFolder("   ")).toBe("   ");
  });

  it('strips one trailing slash from a whitespace-then-slash path: " /" -> " "', () => {
    // Confirms the trim is purely positional (last char), independent of content.
    expect(removeTrailingSlashFromFolder(" /")).toBe(" ");
  });

  // --- MULTI-slash: only ONE slash is stripped (the observed contract) --------
  it('"//" -> "/" : strips exactly ONE trailing slash, not all of them', () => {
    // "//" is length 2 so it is NOT caught by the `== "/"` root guard; one slash
    // is stripped, leaving "/". (It just so happens that "/" is itself a fixed
    // point — see the idempotence note below.)
    expect(removeTrailingSlashFromFolder("//")).toBe("/");
  });

  it('"a///" -> "a//" : a single call removes only the LAST slash', () => {
    expect(removeTrailingSlashFromFolder("a///")).toBe("a//");
  });

  // --- IDEMPOTENCE characterization ------------------------------------------
  // For any SINGLE-trailing-slash (or no-slash) input, the helper is idempotent:
  // one application reaches a fixed point and a second application is a no-op.
  it("is idempotent for single-trailing / no-trailing inputs: f(f(x)) === f(x)", () => {
    const singleOrNone = [
      "/",
      "a/b/",
      "a/b",
      "x/",
      "x",
      "",
      "   ",
      " /",
      "//", // strips to "/", which is a fixed point -> idempotent for this input
    ];
    for (const x of singleOrNone) {
      const once = removeTrailingSlashFromFolder(x);
      const twice = removeTrailingSlashFromFolder(once);
      expect(twice).toBe(once);
    }
  });

  // …but it is explicitly NOT idempotent on MULTI-trailing-slash input: each
  // pass peels exactly one slash, so "a///" needs three passes to fully collapse.
  it('is NOT idempotent on multi-trailing slashes: "a///" needs repeated passes (locked, latent contract)', () => {
    const once = removeTrailingSlashFromFolder("a///"); // "a//"
    const twice = removeTrailingSlashFromFolder(once); // "a/"
    const thrice = removeTrailingSlashFromFolder(twice); // "a"
    expect(once).toBe("a//");
    expect(twice).toBe("a/");
    expect(thrice).toBe("a");
    // The defining non-idempotence assertion: f(f(x)) !== f(x) for "a///".
    expect(twice).not.toBe(once);
  });

  // --- guard against accidental over-stripping of interior slashes -----------
  it("never touches interior slashes, only the final character", () => {
    expect(removeTrailingSlashFromFolder("a//b")).toBe("a//b");
    expect(removeTrailingSlashFromFolder("a//b/")).toBe("a//b");
  });

  // --- purity: returns a string, never throws, no mutation of (immutable) arg -
  it("always returns a string and never throws across the documented inputs", () => {
    const inputs = ["/", "//", "a/b/", "a/b", "x/", "x", "", "   ", " /", "a///"];
    for (const x of inputs) {
      expect(typeof removeTrailingSlashFromFolder(x)).toBe("string");
    }
  });
});
