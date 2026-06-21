// Sticker / icon picker search index (Notidian-s718).
//
// The picker (StickerModal) previously searched ONLY the first display name of
// each glyph (`Sticker.name`), so an owner hunting for a "voltage" symbol could
// not find the high-voltage emoji (⚡, named "zap") or the Lucide `zap` icon.
// This module is the single, pure, offline-testable source of:
//
//   1. a curated synonym table mapping common search terms (voltage, bolt,
//      lightning, power, electric, …) onto the canonical glyph tokens they
//      should surface, and
//   2. the helpers that build a sticker's searchable keyword blob and match a
//      query against name + keywords.
//
// Keeping this logic data-only and side-effect-free lets a unit test assert
// keyword coverage without booting Obsidian's icon runtime.

/**
 * Synonym groups. Each group lists ALL interchangeable search terms for one
 * concept; any term in a group should surface a glyph whose own name/aliases
 * contain ANY term in the same group. This is intentionally bidirectional:
 * searching "voltage" finds the "zap" emoji, and searching "zap" finds a glyph
 * aliased only as "high voltage".
 *
 * Title Case is avoided here on purpose — these are lowercase search tokens, not
 * user-facing names.
 */
export const STICKER_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // Electricity / power — the owner-reported gap (voltage symbol).
  [
    "voltage",
    "high voltage",
    "zap",
    "bolt",
    "lightning",
    "lightning bolt",
    "thunder",
    "thunderbolt",
    "power",
    "electric",
    "electricity",
    "electrical",
    "energy",
    "charge",
    "spark",
    "flash",
    "shock",
  ],
  // Battery / charge.
  ["battery", "charge", "charging", "power", "energy", "low battery"],
  // Plug / socket / outlet.
  ["plug", "socket", "outlet", "electric plug", "power", "electric"],
  // Light / bulb.
  ["bulb", "light bulb", "lightbulb", "light", "lamp", "idea"],
  // Fastener bolt (distinct sense of "bolt"), so a nuts-and-bolts search still
  // works without hijacking the lightning sense above.
  ["nut and bolt", "screw", "fastener", "hardware"],
] as const;

/**
 * Normalise a token for matching: lowercase + collapse separators to spaces.
 * Hyphens and underscores in glyph ids (e.g. Lucide "plug-zap") become spaces
 * so multi-word synonyms line up with id segments.
 */
export const normalizeStickerToken = (s: string): string =>
  (s ?? "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Given a glyph's own names/aliases, return the extra synonym terms that should
 * be searchable for it. A synonym group contributes ALL of its terms when any
 * of the glyph's own tokens contains (or is contained by) any term in the group.
 */
export const synonymsForAliases = (aliases: string[]): string[] => {
  const ownTokens = (aliases ?? [])
    .map(normalizeStickerToken)
    .filter((t) => t.length > 0);
  if (ownTokens.length === 0) return [];

  const extra = new Set<string>();
  for (const group of STICKER_SYNONYM_GROUPS) {
    const groupHit = group.some((term) => {
      const t = normalizeStickerToken(term);
      return ownTokens.some((own) => own.includes(t) || t.includes(own));
    });
    if (groupHit) {
      for (const term of group) extra.add(normalizeStickerToken(term));
    }
  }
  // Don't re-list the glyph's own tokens; only the new synonym terms.
  for (const own of ownTokens) extra.delete(own);
  return [...extra];
};

/**
 * Build the lowercase, space-joined keyword blob that the picker filters on.
 * Combines every alias with the synonyms they unlock, deduplicated.
 */
export const buildStickerKeywords = (aliases: string[]): string => {
  const ownTokens = (aliases ?? [])
    .map(normalizeStickerToken)
    .filter((t) => t.length > 0);
  const all = new Set<string>([...ownTokens, ...synonymsForAliases(aliases)]);
  return [...all].join(" ");
};

/**
 * Picker match predicate: query matches if it is a substring of the glyph's
 * display name OR of its keyword blob. Empty query matches everything (so the
 * full set still browses).
 */
export const stickerMatchesQuery = (
  sticker: { name?: string; keywords?: string },
  query: string
): boolean => {
  const q = normalizeStickerToken(query);
  if (q.length === 0) return true;
  const name = normalizeStickerToken(sticker?.name ?? "");
  const keywords = normalizeStickerToken(sticker?.keywords ?? "");
  return name.includes(q) || keywords.includes(q);
};
