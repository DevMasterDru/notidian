// Offline (node) unit tests for the space-note-body resize/scroll model
// (Notidian-egoh). The pixel math, the persisted-height contract, and the
// auto-vs-fixed decision are the offline-verifiable half; the actual drag
// gesture + scrolling is the live-verify part. Mirrors the spaceNoteBodyCollapse
// test's real serialize -> parse round-trip so the height field can't be
// silently dropped from the write allowlist or the parser the way collapse once
// was.
import { spaceDefinitionFrontmatter } from "core/types/space";
import { parseSpaceMetadata } from "core/superstate/utils/spaces";
import { ensureNumber } from "core/utils/strings";
import { MakeMDSettings } from "shared/types/settings";
import { SpaceDefinition } from "shared/types/spaceDef";
import {
  MAX_NOTE_BODY_HEIGHT,
  MIN_NOTE_BODY_HEIGHT,
  clampNoteBodyHeight,
  nextNoteBodyHeightFromDrag,
  resolveNoteBodyHeight,
} from "./spaceNoteBodyResize";

describe("clampNoteBodyHeight — bounds + integer-rounding", () => {
  it("clamps below MIN up to MIN", () => {
    expect(clampNoteBodyHeight(0)).toBe(MIN_NOTE_BODY_HEIGHT);
    expect(clampNoteBodyHeight(-500)).toBe(MIN_NOTE_BODY_HEIGHT);
    expect(clampNoteBodyHeight(MIN_NOTE_BODY_HEIGHT - 1)).toBe(
      MIN_NOTE_BODY_HEIGHT
    );
  });

  it("clamps above MAX down to MAX", () => {
    expect(clampNoteBodyHeight(MAX_NOTE_BODY_HEIGHT + 1000)).toBe(
      MAX_NOTE_BODY_HEIGHT
    );
  });

  it("passes an in-range value through, rounded to an integer", () => {
    expect(clampNoteBodyHeight(321.6)).toBe(322);
    expect(clampNoteBodyHeight(200)).toBe(200);
  });

  it("falls back to MIN for non-finite input (never emits an invalid height)", () => {
    // Contract: any non-finite value (NaN, ±Infinity) is treated as invalid and
    // resolves to the safe MIN rather than a broken or unbounded height.
    expect(clampNoteBodyHeight(NaN)).toBe(MIN_NOTE_BODY_HEIGHT);
    expect(clampNoteBodyHeight(Infinity)).toBe(MIN_NOTE_BODY_HEIGHT);
    expect(clampNoteBodyHeight(-Infinity)).toBe(MIN_NOTE_BODY_HEIGHT);
  });
});

describe("resolveNoteBodyHeight — persisted height, null means shrink-to-fit", () => {
  it("returns null when there is no metadata or no persisted height", () => {
    expect(resolveNoteBodyHeight(null)).toBeNull();
    expect(resolveNoteBodyHeight(undefined)).toBeNull();
    expect(resolveNoteBodyHeight({})).toBeNull();
  });

  it("returns the clamped height when one is persisted", () => {
    expect(resolveNoteBodyHeight({ noteBodyHeight: 300 })).toBe(300);
    expect(resolveNoteBodyHeight({ noteBodyHeight: 10 })).toBe(
      MIN_NOTE_BODY_HEIGHT
    );
    expect(resolveNoteBodyHeight({ noteBodyHeight: 99999 })).toBe(
      MAX_NOTE_BODY_HEIGHT
    );
  });

  it("treats a non-finite stored value as unset (auto)", () => {
    expect(
      resolveNoteBodyHeight({ noteBodyHeight: NaN as unknown as number })
    ).toBeNull();
  });
});

describe("nextNoteBodyHeightFromDrag — delta math, clamped", () => {
  it("adds the pointer delta to the start height", () => {
    expect(nextNoteBodyHeightFromDrag(200, 50)).toBe(250);
    expect(nextNoteBodyHeightFromDrag(200, -50)).toBe(150);
  });

  it("never drags below MIN or above MAX", () => {
    expect(nextNoteBodyHeightFromDrag(MIN_NOTE_BODY_HEIGHT, -1000)).toBe(
      MIN_NOTE_BODY_HEIGHT
    );
    expect(nextNoteBodyHeightFromDrag(MAX_NOTE_BODY_HEIGHT, 1000)).toBe(
      MAX_NOTE_BODY_HEIGHT
    );
  });
});

describe("ensureNumber — optional numeric coercion (absent stays absent)", () => {
  it("passes a finite number through, including 0", () => {
    expect(ensureNumber(240)).toBe(240);
    expect(ensureNumber(0)).toBe(0);
  });

  it("coerces a numeric string", () => {
    expect(ensureNumber("240")).toBe(240);
  });

  it("returns undefined for missing/blank/non-numeric (NOT 0)", () => {
    expect(ensureNumber(undefined)).toBeUndefined();
    expect(ensureNumber(null)).toBeUndefined();
    expect(ensureNumber("")).toBeUndefined();
    expect(ensureNumber("abc")).toBeUndefined();
    expect(ensureNumber(NaN)).toBeUndefined();
  });
});

describe("definition disk round-trip — noteBodyHeight over the REAL write/read path", () => {
  const settings = {} as MakeMDSettings;
  const roundTrip = (def: SpaceDefinition): SpaceDefinition =>
    parseSpaceMetadata(spaceDefinitionFrontmatter(def), settings);

  it("a resized space survives serialize -> frontmatter -> parse", () => {
    expect(resolveNoteBodyHeight(roundTrip({ noteBodyHeight: 360 }))).toBe(360);
  });

  it("a never-resized space round-trips as auto (null)", () => {
    expect(resolveNoteBodyHeight(roundTrip({}))).toBeNull();
  });

  it("noteBodyHeight is in the write allowlist (regression guard)", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        spaceDefinitionFrontmatter({ noteBodyHeight: 360 }),
        "noteBodyHeight"
      )
    ).toBe(true);
  });

  it("round-trips height alongside collapse + other durable view-state", () => {
    const parsed = roundTrip({
      fullWidth: true,
      noteBodyCollapsed: true,
      noteBodyHeight: 420,
    });
    expect(parsed.fullWidth).toBe(true);
    expect(parsed.noteBodyCollapsed).toBe(true);
    expect(parsed.noteBodyHeight).toBe(420);
  });
});
