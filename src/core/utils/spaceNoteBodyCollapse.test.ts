// Offline (node) unit tests for the space-note-body collapse model (Notidian-8sl).
//
// This is the Q1 (offline-verifiable) half of a flag-gated bead. The CSS/layout
// shrink-to-fit and the React render are the live-verify part (see
// docs/AUTONOMOUS-REVIEW-QUEUE.md); the collapse *decision logic* and the
// persisted-state contract are proven here, DOM-free.
import { SpaceDefinition } from "shared/types/spaceDef";
import {
  isCollapsibleNoteBodyEnabled,
  nextNoteBodyCollapsed,
  resolveNoteBodyCollapsed,
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
