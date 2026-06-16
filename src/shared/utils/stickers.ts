
export const emojiFromString = (emoji: string) => {
  let html;
  try {
    html = unifiedToNative(emoji);
  }
  catch {
    html = emoji;
  }
  return html;
};

export function parseStickerString(input: string): [string, string] {
  if (!input) {
    return ["", ""];
  }
  const match = input.match(/^(.*?)\s*\/\/\s*(.*)$/);
  if (match) {
    return [match[1], match[2]];
  } else {
    return ["", input];
  }
}
export const unifiedToNative = (unified: string) => {
  // ADR 0042 (Notidian-ywcf): empty input is the codec pair's one boundary
  // value. Return "" so the pair is total on empty and round-trips cleanly with
  // nativeToUnified(""). Deliberately NARROW: only the empty case is smoothed.
  // Non-hex / out-of-range input STILL throws RangeError below — that throw is
  // load-bearing for emojiFromString's catch (the Notidian-ebz security
  // contract: a malformed/hostile payload must survive verbatim so the sink can
  // escapeHtml it). Do NOT broaden this guard to swallow invalid codes.
  if (!unified) {
    return "";
  }
  const unicodes = unified.split("-");
  const codePoints = unicodes.map((u) => `0x${u}`);
  // @ts-ignore
  return String.fromCodePoint(...codePoints);
};
// ADR 0042 (Notidian-ywcf): guard the inverse half so the codec pair is total.
// "".codePointAt(0) is undefined, so the previous unconditional .toString(16)
// threw TypeError. Returning "" keeps the return type `string` (no caller has to
// null-check) and mirrors the already-pinned emojiFromString("") === ""
// production contract — empty glyph in, empty code out.
export const nativeToUnified = (native: string) =>
  native.codePointAt(0)?.toString(16) ?? "";

