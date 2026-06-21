import { emojis } from "shared/assets/emoji";
import { EmojiData } from "shared/types/emojis";
import {
  buildStickerKeywords,
  normalizeStickerToken,
  stickerMatchesQuery,
  synonymsForAliases,
} from "./stickerSearch";

// Mirror of the (Obsidian-runtime) allStickers() index build, restricted to the
// emoji set — the part that is pure data and therefore offline-testable. This is
// the exact keyword field the StickerModal filter searches.
type IndexedSticker = { type: string; name: string; value: string; keywords: string };

const emojiIndex: IndexedSticker[] = Object.keys(emojis as EmojiData).reduce(
  (acc: IndexedSticker[], category: string) => [
    ...acc,
    ...(emojis as EmojiData)[category].map((e) => ({
      type: "emoji",
      name: e.n[0],
      value: e.u,
      keywords: buildStickerKeywords(e.n),
    })),
  ],
  []
);

const search = (query: string): IndexedSticker[] =>
  emojiIndex.filter((s) => stickerMatchesQuery(s, query));

describe("normalizeStickerToken", () => {
  it("lowercases and flattens separators", () => {
    expect(normalizeStickerToken("Plug-Zap")).toBe("plug zap");
    expect(normalizeStickerToken("HIGH_VOLTAGE")).toBe("high voltage");
    expect(normalizeStickerToken("  spaced   out ")).toBe("spaced out");
  });

  it("is total on nullish input", () => {
    expect(normalizeStickerToken(undefined as unknown as string)).toBe("");
    expect(normalizeStickerToken(null as unknown as string)).toBe("");
    expect(normalizeStickerToken("")).toBe("");
  });
});

describe("stickerMatchesQuery", () => {
  it("empty query matches everything (full browse)", () => {
    expect(stickerMatchesQuery({ name: "zap", keywords: "" }, "")).toBe(true);
    expect(stickerMatchesQuery({ name: "anything" }, "   ")).toBe(true);
  });

  it("matches on name", () => {
    expect(stickerMatchesQuery({ name: "zap", keywords: "" }, "zap")).toBe(true);
  });

  it("matches on the keyword index, not just name", () => {
    const sticker = { name: "zap", keywords: buildStickerKeywords(["zap"]) };
    expect(stickerMatchesQuery(sticker, "voltage")).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(
      stickerMatchesQuery({ name: "zap", keywords: "voltage bolt" }, "banana")
    ).toBe(false);
  });
});

describe("synonymsForAliases", () => {
  it("links the lightning/power group bidirectionally", () => {
    const fromZap = synonymsForAliases(["zap", "high voltage sign"]);
    expect(fromZap).toEqual(
      expect.arrayContaining(["voltage", "bolt", "lightning", "power", "electric"])
    );
  });

  it("returns nothing for unrelated glyphs", () => {
    expect(synonymsForAliases(["smile", "grinning face"])).toEqual([]);
  });

  it("is total on empty input", () => {
    expect(synonymsForAliases([])).toEqual([]);
    expect(synonymsForAliases(undefined as unknown as string[])).toEqual([]);
  });

  it("does NOT inherit a group via the reverse substring direction (Notidian-s718)", () => {
    // The reviewer-confirmed pollution mechanism: a short own-token that is a
    // SUBSTRING of a group term (`"voltage".includes("v")`,
    // `"electric`+`ity".includes("it")`, `"battery".includes("bat")`) must NOT
    // pull in the whole electricity/battery group. Match is forward-only: a
    // glyph joins a group only when ITS token contains a group term.
    expect(synonymsForAliases(["v"])).toEqual([]); // victory-hand keycap, not voltage
    expect(synonymsForAliases(["a"])).toEqual([]);
    expect(synonymsForAliases(["b"])).toEqual([]);
    expect(synonymsForAliases(["o"])).toEqual([]);
    expect(synonymsForAliases(["it"])).toEqual([]); // Italy flag, not "electricity"
    expect(synonymsForAliases(["de"])).toEqual([]); // Germany flag, not "thunder"
    expect(synonymsForAliases(["ng"])).toEqual([]); // button, not "lightning"
    expect(synonymsForAliases(["bat"])).toEqual([]); // the animal, not "battery"
  });
});

describe("icon picker voltage discoverability (Notidian-s718)", () => {
  // The owner-reported gap: each of these terms must now surface at least one
  // emoji glyph in the picker's search.
  const requiredKeywords = [
    "voltage",
    "bolt",
    "lightning",
    "zap",
    "power",
    "electric",
  ];

  it.each(requiredKeywords)(
    "search %p returns at least one glyph",
    (keyword) => {
      const hits = search(keyword);
      expect(hits.length).toBeGreaterThan(0);
    }
  );

  it("every voltage-family term resolves to the high-voltage emoji (⚡, 26a1)", () => {
    for (const keyword of requiredKeywords) {
      const hits = search(keyword);
      expect(hits.some((s) => s.value === "26a1")).toBe(true);
    }
  });

  it("the high-voltage emoji's own keyword blob carries all the new aliases", () => {
    const highVoltage = emojiIndex.find((s) => s.value === "26a1");
    expect(highVoltage).toBeDefined();
    for (const keyword of requiredKeywords) {
      expect(normalizeStickerToken(highVoltage!.keywords)).toContain(keyword);
    }
  });

  it("does NOT surface letter/flag/button glyphs for electricity queries (Notidian-s718)", () => {
    // Regression for the reverse-substring pollution: these glyphs share only a
    // tiny substring with the synonym terms and must never appear for an
    // electricity/power/battery search.
    const pollutants = new Set([
      "270c-fe0f", // ✌ victory hand (was matched as "v" in "voltage")
      "2b55", // ⭕ heavy large circle (was "o" in "bolt"/"voltage")
      "1f170-fe0f", // 🅰 A button
      "1f171-fe0f", // 🅱 B button
      "1f1e9-1f1ea", // 🇩🇪 Germany flag (was "de" in "thunder")
      "1f1ee-1f1f9", // 🇮🇹 Italy flag (was "it" in "electricity")
      "1f196", // 🆖 NG button (was "ng" in "lightning")
      "1f194", // 🆔 ID button
      "24c2-fe0f", // Ⓜ circled M
      "1f51f", // 🔟 keycap ten
      "1f987", // 🦇 bat (was "bat" in "battery")
    ]);
    for (const keyword of ["voltage", "power", "charge", "energy", "bolt", "light"]) {
      const hits = search(keyword);
      const leaked = hits.filter((s) => pollutants.has(s.value));
      expect(leaked.map((s) => `${s.name}(${s.value})`)).toEqual([]);
    }
  });
});

describe("the searchable index is meaningfully broader than the bare names", () => {
  it("indexes far more distinct keyword tokens than first-name-only did", () => {
    // Old behavior: searchable surface = the set of first display names only.
    const firstNameTokens = new Set(
      emojiIndex.map((s) => normalizeStickerToken(s.name)).filter(Boolean)
    );

    // New behavior: every token across name + keyword blob is searchable.
    const allKeywordTokens = new Set<string>();
    for (const s of emojiIndex) {
      for (const token of normalizeStickerToken(s.keywords).split(" ")) {
        if (token) allKeywordTokens.add(token);
      }
    }

    // The widened index must strictly dominate the old one and add a healthy
    // margin of newly-searchable tokens (aliases + synonyms).
    expect(allKeywordTokens.size).toBeGreaterThan(firstNameTokens.size);
    expect(allKeywordTokens.size - firstNameTokens.size).toBeGreaterThan(200);
  });

  it("a multi-alias glyph is now findable by a non-first alias", () => {
    // 'satisfied' is a non-first alias of the 'laughing' emoji (1f606); the old
    // first-name-only search could not find it.
    const hits = search("satisfied");
    expect(hits.some((s) => s.value === "1f606")).toBe(true);
  });
});
