import {
  DEFAULT_TABLE_OVERSCAN,
  DEFAULT_TABLE_ROW_HEIGHT,
  shouldVirtualizeTable,
  tableVirtualRowSlice,
} from "./tableVirtualization";
import { computeVirtualWindow } from "./tableVirtualWindow";

// ===========================================================================
// Unit lock for the pure activation + row-windowing glue (Notidian-8h9). This is
// the offline-provable half of the default-ON virtualization flag-gate: the
// kill-switch predicate (shouldVirtualizeTable) and the rows-to-mount selection
// (tableVirtualRowSlice) are proven here so the only genuinely-unverifiable part
// of 8h9 is the React/DOM plumbing (covered separately by the jsdom wiring test).
//
// The load-bearing property is SLICE-EQUALS-SEAM: tableVirtualRowSlice mounts
// EXACTLY computeVirtualWindow's [startIndex, endIndex) of the assembled rows.
// The jsdom wiring test asserts the rendered <tr> set equals this; here we prove
// the glue itself agrees with the kernel for any geometry.
// ===========================================================================

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i, label: `row-${i}` }));

describe("shouldVirtualizeTable (kill-switch chokepoint)", () => {
  it("is OFF when the flag is OFF, regardless of grouping", () => {
    expect(shouldVirtualizeTable({ enabled: false, isGrouped: false })).toBe(
      false
    );
    expect(shouldVirtualizeTable({ enabled: false, isGrouped: true })).toBe(
      false
    );
  });

  it("is ON only for the flat (non-grouped) case when the flag is ON", () => {
    expect(shouldVirtualizeTable({ enabled: true, isGrouped: false })).toBe(
      true
    );
    // Grouped tables interleave group-header + nested rows the uniform-row window
    // kernel does not model, so they fall back to the legacy render even ON.
    expect(shouldVirtualizeTable({ enabled: true, isGrouped: true })).toBe(
      false
    );
  });

  it("coerces non-boolean enabled to a boolean result", () => {
    expect(
      shouldVirtualizeTable({ enabled: undefined as any, isGrouped: false })
    ).toBe(false);
  });

  it("is OFF when sub-item add-rows are present (non-uniform height) — Notidian-gr8t", () => {
    // The "+ New sub-item" affordance is a shorter interleaved row; fall back to
    // the legacy render so the uniform-row window math stays correct.
    expect(
      shouldVirtualizeTable({
        enabled: true,
        isGrouped: false,
        hasSubItemAddRows: true,
      })
    ).toBe(false);
    // Sub-items on but no expanded parent (no add-rows) still virtualizes.
    expect(
      shouldVirtualizeTable({
        enabled: true,
        isGrouped: false,
        hasSubItemAddRows: false,
      })
    ).toBe(true);
  });
});

describe("tableVirtualRowSlice (slice === pure-seam window)", () => {
  it("mounts exactly computeVirtualWindow's [startIndex, endIndex)", () => {
    const data = rows(1000);
    const geometry = {
      scrollTop: 4000,
      viewportHeight: 600,
      rowHeight: DEFAULT_TABLE_ROW_HEIGHT,
      overscan: DEFAULT_TABLE_OVERSCAN,
    };
    const slice = tableVirtualRowSlice({ rows: data, ...geometry });
    const window = computeVirtualWindow({
      ...geometry,
      totalRows: data.length,
    });

    expect(slice.startIndex).toBe(window.startIndex);
    expect(slice.endIndex).toBe(window.endIndex);
    expect(slice.padTop).toBe(window.padTop);
    expect(slice.padBottom).toBe(window.padBottom);
    // Membership: the mounted rows are precisely the seam's index range, in order.
    expect(slice.rows).toEqual(
      data.slice(window.startIndex, window.endIndex)
    );
    // No row is mounted twice and none outside the range leaks in.
    expect(slice.rows.length).toBe(window.endIndex - window.startIndex);
  });

  it("agrees with the seam across a sweep of scroll positions (slice === seam)", () => {
    const data = rows(500);
    const rowHeight = 40;
    const viewportHeight = 800;
    const overscan = 5;
    for (let scrollTop = 0; scrollTop <= 25000; scrollTop += 137) {
      const slice = tableVirtualRowSlice({
        rows: data,
        scrollTop,
        viewportHeight,
        rowHeight,
        overscan,
      });
      const window = computeVirtualWindow({
        scrollTop,
        viewportHeight,
        rowHeight,
        overscan,
        totalRows: data.length,
      });
      expect(slice.startIndex).toBe(window.startIndex);
      expect(slice.endIndex).toBe(window.endIndex);
      expect(slice.rows).toEqual(
        data.slice(window.startIndex, window.endIndex)
      );
      // Conservation echoes the kernel: spacers + mounted exactly span content.
      expect(
        slice.padTop + slice.rows.length * rowHeight + slice.padBottom
      ).toBe(data.length * rowHeight);
    }
  });

  it("returns an empty slice and zero spacers for an empty data set", () => {
    const slice = tableVirtualRowSlice({
      rows: [],
      scrollTop: 0,
      viewportHeight: 600,
      rowHeight: DEFAULT_TABLE_ROW_HEIGHT,
      overscan: DEFAULT_TABLE_OVERSCAN,
    });
    expect(slice.rows).toEqual([]);
    expect(slice.startIndex).toBe(0);
    expect(slice.endIndex).toBe(0);
    expect(slice.padTop).toBe(0);
    expect(slice.padBottom).toBe(0);
  });

  it("at the top of a tall list mounts a prefix window, all pad below", () => {
    const data = rows(1000);
    const slice = tableVirtualRowSlice({
      rows: data,
      scrollTop: 0,
      viewportHeight: 360,
      rowHeight: 36,
      overscan: 0,
    });
    expect(slice.startIndex).toBe(0);
    expect(slice.padTop).toBe(0);
    expect(slice.padBottom).toBeGreaterThan(0);
    // Every mounted row is from the very top of the data.
    expect(slice.rows[0]).toEqual(data[0]);
  });

  it("tolerates corrupt geometry without throwing (delegates to the total kernel)", () => {
    const data = rows(50);
    const slice = tableVirtualRowSlice({
      rows: data,
      scrollTop: NaN,
      viewportHeight: Infinity,
      rowHeight: 0,
      overscan: -5,
    });
    // Total kernel: finite, in-range, non-negative.
    expect(Number.isFinite(slice.padTop)).toBe(true);
    expect(Number.isFinite(slice.padBottom)).toBe(true);
    expect(slice.startIndex).toBeGreaterThanOrEqual(0);
    expect(slice.endIndex).toBeGreaterThanOrEqual(slice.startIndex);
    expect(slice.endIndex).toBeLessThanOrEqual(data.length);
    expect(slice.rows.length).toBe(slice.endIndex - slice.startIndex);
  });
});
