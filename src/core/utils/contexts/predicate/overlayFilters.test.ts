import { resolveOverlayFilters } from "core/utils/contexts/predicate/overlayFilters";
import {
  makeRowMatchesFilters,
  RowMatchesSpaceManager,
} from "core/utils/contexts/predicate/rowMatchesFilters";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { Filter } from "shared/types/predicate";

// ADR-0066 / Notidian-ioxi — read-path overlay merge semantics + kill-switch.

const base: Filter[] = [
  { field: "status", fn: "isNot", value: "Done", fType: "text" },
];
const overlay: Filter[] = [
  { field: "repo", fn: "is", value: "Gidi", fType: "text" },
];

describe("resolveOverlayFilters", () => {
  it("appends overlay AFTER base (conjunctive order) when enabled", () => {
    const merged = resolveOverlayFilters({ base, overlay, enabled: true });
    expect(merged).toEqual([...base, ...overlay]);
  });

  it("returns the base reference UNCHANGED when the flag is off (legacy)", () => {
    const merged = resolveOverlayFilters({ base, overlay, enabled: false });
    expect(merged).toBe(base); // same reference — no merge happened
  });

  it("returns the base reference UNCHANGED when there is no overlay", () => {
    expect(resolveOverlayFilters({ base, overlay: undefined, enabled: true })).toBe(
      base
    );
    expect(resolveOverlayFilters({ base, overlay: null, enabled: true })).toBe(base);
    expect(resolveOverlayFilters({ base, overlay: [], enabled: true })).toBe(base);
  });

  it("passes through null/undefined base unchanged when nothing to merge", () => {
    expect(
      resolveOverlayFilters({ base: undefined, overlay: [], enabled: true })
    ).toBeUndefined();
    expect(
      resolveOverlayFilters({ base: null, overlay: undefined, enabled: false })
    ).toBeNull();
  });

  it("yields the overlay when base is nullish and overlay present", () => {
    expect(
      resolveOverlayFilters({ base: null, overlay, enabled: true })
    ).toEqual([...overlay]);
  });

  it("never mutates either input array", () => {
    const b = [...base];
    const o = [...overlay];
    resolveOverlayFilters({ base: b, overlay: o, enabled: true });
    expect(b).toEqual(base);
    expect(o).toEqual(overlay);
  });
});

// The merged list must behave as a logical AND once fed to the row matcher —
// this proves "base + overlay filters combine" end-to-end at the read seam.
describe("overlay merge is conjunctive at the row matcher", () => {
  const col = (over: Partial<SpaceTableColumn>): SpaceTableColumn => ({
    name: "title",
    schemaId: "files",
    type: "text",
    table: "",
    ...over,
  });
  const cols = [
    col({ name: "status", table: "" }),
    col({ name: "repo", table: "" }),
  ];
  const spaceManager: RowMatchesSpaceManager = {
    getPathState: () => undefined,
  };

  const matcher = (filters: Filter[] | undefined | null) =>
    makeRowMatchesFilters({ filters, cols, spaceManager, properties: null });

  const rowGidiOpen: DBRow = {
    [PathPropertyName]: "a.md",
    status: "Open",
    repo: "Gidi",
  };
  const rowOtherOpen: DBRow = {
    [PathPropertyName]: "b.md",
    status: "Open",
    repo: "Other",
  };
  const rowGidiDone: DBRow = {
    [PathPropertyName]: "c.md",
    status: "Done",
    repo: "Gidi",
  };

  it("base AND overlay: only rows passing BOTH survive", () => {
    const merged = resolveOverlayFilters({ base, overlay, enabled: true });
    const match = matcher(merged);
    expect(match(rowGidiOpen)).toBe(true); // status!=Done AND repo=Gidi
    expect(match(rowOtherOpen)).toBe(false); // overlay excludes non-Gidi
    expect(match(rowGidiDone)).toBe(false); // base excludes Done
  });

  it("flag-off drops the overlay: the non-Gidi row is no longer filtered", () => {
    const merged = resolveOverlayFilters({ base, overlay, enabled: false });
    const match = matcher(merged);
    // Only the base filter (status != Done) applies; repo is not constrained.
    expect(match(rowOtherOpen)).toBe(true);
    expect(match(rowGidiOpen)).toBe(true);
    expect(match(rowGidiDone)).toBe(false);
  });
});
