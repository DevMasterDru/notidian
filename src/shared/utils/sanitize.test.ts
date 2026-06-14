import { escapeHtml } from "shared/utils/sanitize";

describe("escapeHtml (Notidian-ebz)", () => {
  it("neutralises HTML-significant characters", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes & first so there is no double-escaping", () => {
    // The literal text "&lt;" must become "&amp;lt;", not "&lt;".
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("is the identity for ordinary text (lossless contentEditable round-trip)", () => {
    expect(escapeHtml("Project Notes 2026")).toBe("Project Notes 2026");
    expect(escapeHtml("café — déjà vu")).toBe("café — déjà vu");
    // emoji chars are not HTML-significant, so a real sticker emoji survives
    expect(escapeHtml("😀")).toBe("😀");
  });

  it("coerces nullish/non-string input to an empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});
