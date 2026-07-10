// Offline (node) unit tests for the space-note-body collapse model (Notidian-8sl).
//
// This is the Q1 (offline-verifiable) half of a flag-gated bead. The CSS/layout
// shrink-to-fit and the React render are the live-verify part (see
// docs/AUTONOMOUS-REVIEW-QUEUE.md); the collapse *decision logic* and the
// persisted-state contract are proven here, DOM-free.
import { DEFAULT_SETTINGS } from "core/schemas/settings";
import { spaceDefinitionFrontmatter } from "core/types/space";
import { parseSpaceMetadata } from "core/superstate/utils/spaces";
import { MakeMDSettings } from "shared/types/settings";
import { SpaceDefinition } from "shared/types/spaceDef";
import {
  isCollapsibleNoteBodyEnabled,
  isNoteBodyHidden,
  nextNoteBodyCollapsed,
  resolveNoteBodyCollapsed,
  resolveNoteBodyFullCollapse,
  shouldRenderNoteContent,
} from "./spaceNoteBodyCollapse";

describe("isCollapsibleNoteBodyEnabled — feature is active only when ON + a space exists", () => {
  it("is active when the setting is on and there is a space", () => {
    expect(isCollapsibleNoteBodyEnabled(true, true)).toBe(true);
  });

  it("is inactive when the setting is off (default — legacy rendering)", () => {
    expect(isCollapsibleNoteBodyEnabled(false, true)).toBe(false);
  });

  it("is inactive with no space to carry per-space view state", () => {
    expect(isCollapsibleNoteBodyEnabled(true, false)).toBe(false);
  });

  it("treats undefined setting (e.g. pre-upgrade data.json) as off", () => {
    expect(isCollapsibleNoteBodyEnabled(undefined, true)).toBe(false);
  });

  it("always returns a strict boolean", () => {
    expect(isCollapsibleNoteBodyEnabled(undefined, false)).toBe(false);
    expect(typeof isCollapsibleNoteBodyEnabled(true, true)).toBe("boolean");
  });
});

describe("resolveNoteBodyCollapsed — persisted view state defaults to expanded", () => {
  it("defaults to expanded (false) for missing metadata", () => {
    expect(resolveNoteBodyCollapsed(undefined)).toBe(false);
    expect(resolveNoteBodyCollapsed(null)).toBe(false);
  });

  it("defaults to expanded for a space that never toggled the body", () => {
    expect(resolveNoteBodyCollapsed({} as SpaceDefinition)).toBe(false);
    expect(
      resolveNoteBodyCollapsed({ noteBodyCollapsed: undefined })
    ).toBe(false);
  });

  it("reads a persisted collapsed state", () => {
    expect(resolveNoteBodyCollapsed({ noteBodyCollapsed: true })).toBe(true);
    expect(resolveNoteBodyCollapsed({ noteBodyCollapsed: false })).toBe(false);
  });

  it("does not collapse just because other space metadata is present", () => {
    const meta: SpaceDefinition = { fullWidth: true, readMode: true };
    expect(resolveNoteBodyCollapsed(meta)).toBe(false);
  });
});

describe("nextNoteBodyCollapsed — value persisted on toggle is a strict boolean", () => {
  it("normalizes to a boolean", () => {
    expect(nextNoteBodyCollapsed(true)).toBe(true);
    expect(nextNoteBodyCollapsed(false)).toBe(false);
    expect(typeof nextNoteBodyCollapsed(true)).toBe("boolean");
  });
});

describe("shouldRenderNoteContent — content mounts unless actively collapsed", () => {
  it("always renders when the feature is inactive (legacy behavior)", () => {
    expect(shouldRenderNoteContent(false, false)).toBe(true);
    // Even a stale collapsed flag does not hide content while the feature is off.
    expect(shouldRenderNoteContent(false, true)).toBe(true);
  });

  it("renders when active and expanded", () => {
    expect(shouldRenderNoteContent(true, false)).toBe(true);
  });

  it("does NOT render when active and collapsed (genuine unmount)", () => {
    expect(shouldRenderNoteContent(true, true)).toBe(false);
  });

  it("defaults fullCollapse=true so a 2-arg call is the full-collapse contract", () => {
    // Existing call sites pass 2 args; the added 3rd param must default to the
    // owner-directed full-collapse (unmount) so nothing changes for them.
    expect(shouldRenderNoteContent(true, true)).toBe(false);
    expect(shouldRenderNoteContent(true, true, undefined)).toBe(false);
  });
});

describe("shouldRenderNoteContent — full-collapse vs kill-switch (Notidian-50hn)", () => {
  it("full-collapse ON + collapsed → NOT mounted (zero note nodes, database-only)", () => {
    expect(shouldRenderNoteContent(true, true, true)).toBe(false);
  });

  it("kill-switch OFF + collapsed → still mounted (kept alive, hidden via CSS)", () => {
    expect(shouldRenderNoteContent(true, true, false)).toBe(true);
  });

  it("expanded is always mounted regardless of the full-collapse flag", () => {
    expect(shouldRenderNoteContent(true, false, true)).toBe(true);
    expect(shouldRenderNoteContent(true, false, false)).toBe(true);
  });

  it("inactive feature always mounts, ignoring the full-collapse flag", () => {
    expect(shouldRenderNoteContent(false, true, true)).toBe(true);
    expect(shouldRenderNoteContent(false, true, false)).toBe(true);
  });
});

describe("isNoteBodyHidden — mounted-but-hidden only in the kill-switch collapsed state (Notidian-50hn)", () => {
  it("is true ONLY when active + collapsed + full-collapse OFF", () => {
    expect(isNoteBodyHidden(true, true, false)).toBe(true);
  });

  it("is false in the default full-collapse path (body is unmounted, not hidden)", () => {
    expect(isNoteBodyHidden(true, true, true)).toBe(false);
  });

  it("is false when expanded (nothing to hide)", () => {
    expect(isNoteBodyHidden(true, false, false)).toBe(false);
    expect(isNoteBodyHidden(true, false, true)).toBe(false);
  });

  it("is false when the feature is inactive (legacy always-visible)", () => {
    expect(isNoteBodyHidden(false, true, false)).toBe(false);
  });

  it("always returns a strict boolean", () => {
    expect(typeof isNoteBodyHidden(true, true, false)).toBe("boolean");
  });
});

describe("resolveNoteBodyFullCollapse — only explicit false disables the contract (Notidian-50hn)", () => {
  it("undefined (pre-upgrade data.json) resolves to full-collapse ON (safe default)", () => {
    expect(resolveNoteBodyFullCollapse(undefined)).toBe(true);
  });

  it("true resolves to ON", () => {
    expect(resolveNoteBodyFullCollapse(true)).toBe(true);
  });

  it("only an explicit false engages the kill-switch", () => {
    expect(resolveNoteBodyFullCollapse(false)).toBe(false);
  });

  it("always returns a strict boolean", () => {
    expect(typeof resolveNoteBodyFullCollapse(undefined)).toBe("boolean");
  });
});

describe("persistence roundtrip — toggle -> store -> resolve (Notidian-8sl)", () => {
  // Models the SpaceDefinition store the component writes through
  // saveSpaceMetadataValue(superstate, path, "noteBodyCollapsed", v). The store
  // is keyed by space path, exactly as saveSpaceMetadataValue persists it.
  type Store = Record<string, SpaceDefinition>;
  const makeStore = (): Store => ({});
  const save = (store: Store, path: string, collapsed: boolean) => {
    store[path] = {
      ...(store[path] ?? {}),
      noteBodyCollapsed: nextNoteBodyCollapsed(collapsed),
    };
  };

  it("an expanded space toggled collapsed round-trips to collapsed", () => {
    const store = makeStore();
    const path = "Projects/Atlas";
    // Initial (never toggled) resolves to expanded.
    expect(resolveNoteBodyCollapsed(store[path])).toBe(false);
    // UICollapse's onToggle hands us the NEXT collapsed state.
    save(store, path, /* next */ true);
    expect(resolveNoteBodyCollapsed(store[path])).toBe(true);
    // Toggling back round-trips to expanded.
    save(store, path, /* next */ false);
    expect(resolveNoteBodyCollapsed(store[path])).toBe(false);
  });

  it("collapsed state is per-space (one space's state does not leak to another)", () => {
    const store = makeStore();
    save(store, "A", true);
    save(store, "B", false);
    expect(resolveNoteBodyCollapsed(store["A"])).toBe(true);
    expect(resolveNoteBodyCollapsed(store["B"])).toBe(false);
  });

  it("persisting collapse preserves other space metadata (merge, not replace)", () => {
    const store: Store = { "A": { fullWidth: true, readMode: true } };
    save(store, "A", true);
    expect(store["A"]).toEqual({
      fullWidth: true,
      readMode: true,
      noteBodyCollapsed: true,
    });
  });
});

describe("definition disk round-trip — serialize -> parse over the REAL write/read path (Notidian-8sl)", () => {
  // Exercises the actual on-disk allowlist (spaceDefinitionFrontmatter, the
  // serializer saveSpace writes to the def frontmatter) paired with the actual
  // read parser (parseSpaceMetadata). The earlier in-memory Store test could
  // not catch the original defect: noteBodyCollapsed was missing from BOTH the
  // write allowlist and the parser, so it was silently dropped on disk and
  // never reloaded. This test fails if either side drops the field again.
  const settings = {} as MakeMDSettings;
  const roundTrip = (def: SpaceDefinition): SpaceDefinition =>
    parseSpaceMetadata(spaceDefinitionFrontmatter(def), settings);

  it("a collapsed space survives serialize -> frontmatter -> parse", () => {
    expect(
      resolveNoteBodyCollapsed(roundTrip({ noteBodyCollapsed: true }))
    ).toBe(true);
  });

  it("an expanded space survives the round-trip as expanded", () => {
    expect(
      resolveNoteBodyCollapsed(roundTrip({ noteBodyCollapsed: false }))
    ).toBe(false);
    // A space that never toggled (no key) also resolves to expanded.
    expect(resolveNoteBodyCollapsed(roundTrip({}))).toBe(false);
  });

  it("noteBodyCollapsed is in the write allowlist (regression guard)", () => {
    // The exact gap the reviewer flagged: the key must be a serialized property,
    // not silently dropped. Object.keys proves it is emitted, not just falsy.
    expect(
      Object.prototype.hasOwnProperty.call(
        spaceDefinitionFrontmatter({ noteBodyCollapsed: true }),
        "noteBodyCollapsed"
      )
    ).toBe(true);
  });

  it("round-trips collapse alongside other durable view-state fields", () => {
    const parsed = roundTrip({
      fullWidth: true,
      readMode: true,
      noteBodyCollapsed: true,
    });
    expect(parsed.fullWidth).toBe(true);
    expect(parsed.readMode).toBe(true);
    expect(parsed.noteBodyCollapsed).toBe(true);
  });
});

describe("flag gating (default-ON, kill-switch retained) — Notidian-8sl", () => {
  it("collapsibleNoteBody now defaults to true (owner-requested feature is live)", () => {
    // The owner explicitly asked for the collapsible + shrink-to-fit space note
    // body, so it ships enabled and the owner verifies it by USE. The flag is
    // retained purely as a kill-switch.
    expect(DEFAULT_SETTINGS.collapsibleNoteBody).toBe(true);
  });

  it("spaceNoteBodyFullCollapse defaults to true (owner directive — Notidian-50hn)", () => {
    // Owner directive 2026-07-10: collapsing the folder note must hide ALL its
    // text for a database-only view. The default UNMOUNTS the note on collapse;
    // the flag is retained as a non-destructive kill-switch (keep-mounted-hidden).
    expect(DEFAULT_SETTINGS.spaceNoteBodyFullCollapse).toBe(true);
    // The default value drives the full-collapse contract end to end.
    const active = isCollapsibleNoteBodyEnabled(
      DEFAULT_SETTINGS.collapsibleNoteBody,
      /* hasSpace */ true
    );
    const full = resolveNoteBodyFullCollapse(
      DEFAULT_SETTINGS.spaceNoteBodyFullCollapse
    );
    // Active + collapsed + default full-collapse → note is NOT mounted.
    expect(shouldRenderNoteContent(active, /* collapsed */ true, full)).toBe(
      false
    );
    expect(isNoteBodyHidden(active, /* collapsed */ true, full)).toBe(false);
  });

  it("the kill-switch (OFF) fully disables the feature — legacy rendering", () => {
    // With the flag OFF the feature is inactive even when a space exists, so
    // SpaceNoteBody takes the legacy branch (no header/chevron/collapsible class)
    // and ALWAYS renders the note content regardless of any stored collapsed
    // state — byte-identical to the pre-feature region.
    const killSwitchOff = false;
    const active = isCollapsibleNoteBodyEnabled(killSwitchOff, /* hasSpace */ true);
    expect(active).toBe(false);

    // Inactive → content always renders, even with a stale collapsed flag.
    expect(shouldRenderNoteContent(active, /* collapsed */ false)).toBe(true);
    expect(shouldRenderNoteContent(active, /* collapsed */ true)).toBe(true);
  });

  it("the default (ON) keeps the feature active when a space exists", () => {
    const active = isCollapsibleNoteBodyEnabled(
      DEFAULT_SETTINGS.collapsibleNoteBody,
      /* hasSpace */ true
    );
    expect(active).toBe(true);
    // Active + expanded renders; active + collapsed unmounts the body.
    expect(shouldRenderNoteContent(active, /* collapsed */ false)).toBe(true);
    expect(shouldRenderNoteContent(active, /* collapsed */ true)).toBe(false);
  });
});
