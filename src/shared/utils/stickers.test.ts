import {
  emojiFromString,
  nativeToUnified,
  parseStickerString,
  unifiedToNative,
} from "./stickers";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — adversarial + characterization tests for
// src/shared/utils/stickers.ts (Notidian-8fwj). This module had ZERO coverage
// yet sits on a user/import-controlled, persisted data path: sticker strings
// come from frontmatter / context MDB / imported make.md state and are parsed
// into Unicode code points and (in the obsidian adapter) interpolated into an
// SVG `foreignObject` that renders HTML.
//
// Real callers:
//   - parseStickerString  splits "<type>//<value>" for every sticker render
//     (PathSticker.tsx, IconNodeView.tsx, sticker.ts, modifyTabSticker.ts,
//     treeToHast.ts export).
//   - emojiFromString     converts a unified code to its native glyph for the
//     emoji branch (StickerMenu.tsx, StickerModal.tsx, sticker.ts).
//   - unifiedToNative     the underlying String.fromCodePoint conversion.
//   - nativeToUnified     the inverse (codePointAt(0).toString(16)).
//
// Everything here is pure / offline — no vault, no DOM, no jsdom, no I/O.
//
// IMPORTANT — CHARACTERIZATION, not correction. We LOCK the current observable
// behavior (including the throws and the security-relevant raw-input fallback)
// so any future change is a conscious, reviewed decision. Where a genuine
// latent hazard is pinned, it is called out and a follow-up bead is filed — it
// is NOT blind-fixed in this bead.
//
// SECURITY NOTE (Notidian-ebz): emojiFromString returns its RAW INPUT verbatim
// when unifiedToNative throws (e.g. a non-hex / out-of-range "code"). The
// obsidian sink (src/adapters/obsidian/ui/sticker.ts:22) therefore MUST wrap
// the result in escapeHtml before interpolating it into the foreignObject HTML.
// The fallback-returns-original-string test below pins exactly that contract:
// if it ever changes (e.g. to return ""), the sink's escaping assumption and
// the menu/preview UX both shift, and reviewers must re-bless it.
// ---------------------------------------------------------------------------

describe("unifiedToNative", () => {
  it("converts a single hex code point to its native glyph", () => {
    expect(unifiedToNative("1f600")).toBe("\u{1f600}"); // 😀
    expect([...unifiedToNative("1f600")]).toHaveLength(1);
  });

  it("converts an ASCII code point ('41' -> 'A')", () => {
    expect(unifiedToNative("41")).toBe("A");
  });

  it("converts NUL ('0' -> U+0000)", () => {
    expect(unifiedToNative("0")).toBe("\u0000");
  });

  it("is case-insensitive on the hex digits ('1F600' === '1f600')", () => {
    // Number('0x1F600') parses uppercase hex, so an imported uppercase code
    // resolves to the same glyph.
    expect(unifiedToNative("1F600")).toBe(unifiedToNative("1f600"));
  });

  it("joins multiple hyphen-separated parts (flag emoji '1f1ee-1f1f1')", () => {
    // Regional-indicator pair -> 🇮🇱 (two code points, two-element spread).
    const native = unifiedToNative("1f1ee-1f1f1");
    expect(native).toBe("\u{1f1ee}\u{1f1f1}");
    expect([...native]).toHaveLength(2);
  });

  it("accepts lone surrogate-range values WITHOUT throwing (String.fromCodePoint allows them)", () => {
    // CHARACTERIZATION: a surrogate code point is NOT rejected here (unlike the
    // > 0x10FFFF range guard). It produces a lone-surrogate string.
    const native = unifiedToNative("d800");
    expect(native).toBe("\ud800");
    expect(native).toHaveLength(1);
  });

  it("returns '' for empty input (narrow boundary guard, ADR 0042)", () => {
    // RE-BLESSED (ADR 0042, Notidian-ywcf): the prior locked characterization
    // pinned a RangeError here ('' -> [''] -> '0x' -> NaN). Option A's
    // SAME-FAMILY sub-decision adds a narrow empty guard so the forward half is
    // total on its boundary value too, keeping the empty round-trip clean:
    // nativeToUnified(unifiedToNative("")) === "". The guard is deliberately
    // limited to the empty case — non-hex / out-of-range input STILL throws
    // RangeError (pinned below), the load-bearing behavior emojiFromString's
    // catch relies on for the Notidian-ebz security contract.
    expect(unifiedToNative("")).toBe("");
  });

  it("THROWS RangeError on non-hex junk ('zzz' -> '0xzzz' -> NaN)", () => {
    expect(() => unifiedToNative("zzz")).toThrow(RangeError);
    expect(() => unifiedToNative("zzz")).toThrow(/Invalid code point NaN/);
  });

  it("THROWS RangeError on a value above the Unicode max (> 0x10FFFF)", () => {
    // 0x110000 === 1114112 === 0x10FFFF + 1.
    expect(() => unifiedToNative("110000")).toThrow(RangeError);
    expect(() => unifiedToNative("110000")).toThrow(/Invalid code point 1114112/);
  });

  it("THROWS RangeError when ANY hyphen-part is invalid ('1f600-zzz')", () => {
    // The whole spread fails if a single part is NaN / out of range.
    expect(() => unifiedToNative("1f600-zzz")).toThrow(RangeError);
    expect(() => unifiedToNative("1f600-110000")).toThrow(RangeError);
  });
});

describe("emojiFromString", () => {
  it("converts a valid unified code to its native glyph", () => {
    expect(emojiFromString("1f600")).toBe("\u{1f600}");
    expect(emojiFromString("1f1ee-1f1f1")).toBe("\u{1f1ee}\u{1f1f1}");
  });

  it("FALLS BACK to the ORIGINAL string when unifiedToNative throws (RangeError input)", () => {
    // The try/catch returns the raw input on any conversion failure. This is
    // the security-relevant contract pinned by Notidian-ebz — the caller
    // (obsidian sticker.ts) escapes the result precisely because a non-emoji
    // payload survives unchanged. The non-hex / out-of-range cases below STILL
    // throw RangeError inside unifiedToNative, so the catch still fires.
    expect(emojiFromString("zzz")).toBe("zzz");
    expect(emojiFromString("110000")).toBe("110000"); // out-of-range -> raw
    expect(emojiFromString("1f600-zzz")).toBe("1f600-zzz"); // mixed -> raw
  });

  it("returns '' for empty input (now via the SUCCESS path, ADR 0042)", () => {
    // RE-BLESSED (ADR 0042, Notidian-ywcf): emojiFromString("") still === "",
    // but the route changed. Previously unifiedToNative("") threw RangeError and
    // the catch returned the raw "". With the narrow empty guard, unifiedToNative
    // now RETURNS "" directly (no throw), so the success path yields the same "".
    // The observable contract is unchanged — only the internal path differs.
    expect(emojiFromString("")).toBe("");
  });

  it("returns an HTML-significant payload VERBATIM (why the sink must escapeHtml)", () => {
    // CHARACTERIZATION + SECURITY: a markup payload that is not a valid unified
    // code is returned byte-for-byte. unifiedToNative throws on it (no '-' so
    // one part, Number('0x<img...>') is NaN), so the catch returns the input.
    const payload = "<img src=x onerror=alert(1)>";
    expect(emojiFromString(payload)).toBe(payload);
  });
});

describe("parseStickerString", () => {
  it("returns ['', ''] for falsy input (empty / null / undefined)", () => {
    expect(parseStickerString("")).toEqual(["", ""]);
    // Defensive: real callers can pass null/undefined (e.g. missing label).
    expect(parseStickerString(null as unknown as string)).toEqual(["", ""]);
    expect(parseStickerString(undefined as unknown as string)).toEqual(["", ""]);
  });

  it("splits '<type>//<value>' on the separator", () => {
    expect(parseStickerString("lucide//heart")).toEqual(["lucide", "heart"]);
    expect(parseStickerString("emoji//1f600")).toEqual(["emoji", "1f600"]);
  });

  it("returns ['', input] when there is NO '//' separator", () => {
    expect(parseStickerString("noslash")).toEqual(["", "noslash"]);
    expect(parseStickerString("1f600")).toEqual(["", "1f600"]);
  });

  it("trims ONLY the whitespace adjacent to '//' (\\s*//\\s*), not the outer edges", () => {
    // CHARACTERIZATION: the regex is /^(.*?)\s*\/\/\s*(.*)$/. Whitespace
    // immediately around '//' is consumed, but leading whitespace before the
    // type and trailing whitespace after the value are PRESERVED.
    expect(parseStickerString("lucide // heart")).toEqual(["lucide", "heart"]);
    expect(parseStickerString("  lucide  //  heart  ")).toEqual([
      "  lucide",
      "heart  ",
    ]);
  });

  it("splits on the FIRST '//' only (non-greedy first group) when MULTIPLE exist", () => {
    // CHARACTERIZATION: (.*?) is non-greedy, so 'a//b//c' -> ['a', 'b//c'];
    // the trailing '//' stays inside the value.
    expect(parseStickerString("a//b//c")).toEqual(["a", "b//c"]);
    expect(parseStickerString("lucide//path//to//icon")).toEqual([
      "lucide",
      "path//to//icon",
    ]);
  });

  it("handles a LEADING '//' (empty type)", () => {
    expect(parseStickerString("//heart")).toEqual(["", "heart"]);
  });

  it("handles a TRAILING '//' (empty value)", () => {
    expect(parseStickerString("lucide//")).toEqual(["lucide", ""]);
  });

  it("handles a bare '//' (and '  //  ') as ['', '']", () => {
    expect(parseStickerString("//")).toEqual(["", ""]);
    expect(parseStickerString("  //  ")).toEqual(["", ""]);
  });
});

describe("nativeToUnified", () => {
  it("converts an ASCII glyph to its lowercase hex code ('A' -> '41')", () => {
    expect(nativeToUnified("A")).toBe("41");
  });

  it("converts a native emoji glyph back to its unified code", () => {
    expect(nativeToUnified("\u{1f600}")).toBe("1f600");
  });

  it("reads ONLY the FIRST code point of a multi-code-point string", () => {
    // codePointAt(0) — for a flag (two regional indicators) it returns just the
    // first half.
    expect(nativeToUnified("\u{1f1ee}\u{1f1f1}")).toBe("1f1ee");
  });

  it("returns '' for empty input (codec pair is total on its boundary value)", () => {
    // RE-BLESSED (ADR 0042, Notidian-ywcf): the prior locked characterization
    // pinned a TypeError here (''.codePointAt(0) === undefined -> .toString
    // threw). Option A guards nativeToUnified to `?.toString(16) ?? ""`, so the
    // empty native string now yields "" — the return type stays `string` and
    // the result mirrors the already-pinned emojiFromString("") === "" contract.
    expect(nativeToUnified("")).toBe("");
  });
});

describe("nativeToUnified <-> unifiedToNative round-trip (property, table-driven)", () => {
  // fast-check is NOT a dependency (checked package.json), so this is a
  // table-driven property test over a sampled set of valid unified codes
  // spanning ASCII, BMP, astral single, and multi-part (flag) forms.
  const samples: Array<[string, string]> = [
    // [unified input, expected first-code-point reconstruction]
    ["41", "41"], // 'A'
    ["7a", "7a"], // 'z'
    ["263a", "263a"], // ☺ (BMP symbol)
    ["2764", "2764"], // ❤ (BMP heart)
    ["1f600", "1f600"], // 😀 (astral)
    ["1f680", "1f680"], // 🚀 (astral)
    ["1f1ee-1f1f1", "1f1ee"], // flag -> first regional indicator only
    ["1f468-200d-1f4bb", "1f468"], // 👨‍💻 ZWJ sequence -> first code point only
  ];

  it.each(samples)(
    "nativeToUnified(unifiedToNative('%s')) reconstructs the FIRST code point '%s'",
    (unified, expectedFirst) => {
      const native = unifiedToNative(unified);
      expect(nativeToUnified(native)).toBe(expectedFirst);
    }
  );

  it("is a faithful identity for every SINGLE-code-point sample (full round-trip)", () => {
    const singles = samples.filter(([u]) => !u.includes("-"));
    for (const [unified] of singles) {
      // For single-code-point inputs the first code point IS the whole glyph,
      // so the round-trip reconstructs the original unified code exactly.
      expect(nativeToUnified(unifiedToNative(unified))).toBe(unified);
    }
  });

  it("round-trips the EMPTY boundary value cleanly (ADR 0042, Notidian-ywcf)", () => {
    // With both halves guarded on empty, the empty string is now part of the
    // total round-trip: "" -> unifiedToNative -> "" -> nativeToUnified -> "".
    expect(unifiedToNative("")).toBe("");
    expect(nativeToUnified("")).toBe("");
    expect(nativeToUnified(unifiedToNative(""))).toBe("");
  });
});
