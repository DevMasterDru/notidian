import {
  computeVirtualWindow,
  DEFAULT_VIRTUAL_ROW_HEIGHT,
  VirtualWindowInput,
} from "./tableVirtualWindow";

// ===========================================================================
// ADVERSARIAL + PROPERTY LOCK for the pure row-virtualization window kernel
// (Notidian-mnuk, built AHEAD of the Notidian-8h9 default-ON virtualization
// flag-gate). computeVirtualWindow (tableVirtualWindow.ts) is the PURE, DOM-free
// seam the 8h9 render path will consume to decide which rows to mount and how
// tall the top/bottom scroll spacers are. Building + locking it offline FIRST
// means the render-path wiring sits on a proven kernel: every structural
// invariant the live virtualizer depends on is proven here with no jsdom and no
// @tanstack/react-virtual.
//
// The inputs are corruption- and runtime-reachable: a ResizeObserver firing
// mid-layout, a fling-scroll past the end of content, a 0-height collapsed pane,
// a NaN row height from an unmeasured row, an overscan larger than the data set.
// The kernel is therefore TOTAL — it must never throw, never emit NaN/Infinity,
// and always satisfy IN-RANGE / CONSERVATION / NON-NEGATIVE / MONOTONIC. This
// file is the lock; it changes no production code.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency, matching tableRowOrder.property.test.ts / tableRollup.property.test.ts
// / propertyColumnWrap.adversarial.test.ts.
//
// THE CONTRACT PINNED:
//   IN-RANGE      0 <= startIndex <= endIndex <= safeTotalRows; the slice is empty
//                 (start === end === 0) IFF there are no rows.
//   CONSERVATION  padTop + visibleHeight + padBottom === safeTotalRows * rowHeight
//                 EXACTLY (the scrollbar never drifts from true content height).
//   NON-NEGATIVE  padTop >= 0, padBottom >= 0, every field finite.
//   MONOTONIC     startIndex and endIndex are non-decreasing in scrollTop.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: fast, well-distributed, fully deterministic 32-bit generator so
// the property runs are reproducible across machines/CI without a fixture file.
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));

const PROPERTY_RUNS = 5000;

// The effective row height the kernel uses: the caller's value when it is a
// finite positive number, otherwise the documented fallback. The test mirrors
// this so CONSERVATION can be checked against the height the kernel actually
// used, not the (possibly junk) input height.
const effectiveRowHeight = (rowHeight: number): number =>
  Number.isFinite(rowHeight) && rowHeight > 0
    ? rowHeight
    : DEFAULT_VIRTUAL_ROW_HEIGHT;
const effectiveTotalRows = (totalRows: number): number =>
  Number.isFinite(totalRows) && totalRows > 0
    ? Math.min(Math.floor(totalRows), 10_000_000)
    : 0;

// Assert all four structural invariants against the SAME sanitized geometry the
// kernel uses internally. Reused by every example and every property run.
const expectValidWindow = (input: VirtualWindowInput) => {
  const win = computeVirtualWindow(input);
  const rows = effectiveTotalRows(input.totalRows);
  const rh = effectiveRowHeight(input.rowHeight);

  // finite + integer indices
  expect(Number.isInteger(win.startIndex)).toBe(true);
  expect(Number.isInteger(win.endIndex)).toBe(true);
  expect(Number.isFinite(win.padTop)).toBe(true);
  expect(Number.isFinite(win.padBottom)).toBe(true);

  // IN-RANGE
  expect(win.startIndex).toBeGreaterThanOrEqual(0);
  expect(win.startIndex).toBeLessThanOrEqual(win.endIndex);
  expect(win.endIndex).toBeLessThanOrEqual(rows);

  // empty slice IFF no rows
  if (rows === 0) {
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(0);
  } else {
    // a non-empty data set always renders at least one row
    expect(win.endIndex).toBeGreaterThan(win.startIndex);
    expect(win.startIndex).toBeLessThanOrEqual(rows - 1);
  }

  // NON-NEGATIVE
  expect(win.padTop).toBeGreaterThanOrEqual(0);
  expect(win.padBottom).toBeGreaterThanOrEqual(0);

  // CONSERVATION. The kernel derives every spacer from the SAME sanitized
  // integers and rowHeight, so the three terms sum to rows*rh in real
  // arithmetic. With an INTEGER row height the sum is bit-exact; with a
  // FRACTIONAL height (e.g. 33.3px) the equality is only up to IEEE-754
  // accumulation error from adding three floats — a property of float addition,
  // not a kernel defect — so it is asserted with tolerance there. Either way the
  // per-term identities below are exact (each is a single multiply).
  const visibleHeight = (win.endIndex - win.startIndex) * rh;
  const total = win.padTop + visibleHeight + win.padBottom;
  if (Number.isInteger(rh)) {
    expect(total).toBe(rows * rh);
  } else {
    expect(total).toBeCloseTo(rows * rh, 6);
  }
  expect(win.padTop).toBe(win.startIndex * rh);
  expect(win.padBottom).toBe((rows - win.endIndex) * rh);

  return win;
};

describe("computeVirtualWindow — happy path geometry", () => {
  it("renders the strictly-visible band at the top with no overscan", () => {
    // 100 rows x 40px = 4000px content, 400px viewport, scrolled to top.
    const win = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 40,
      overscan: 0,
      totalRows: 100,
    });
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(10); // ceil((0 + 400) / 40)
    expect(win.padTop).toBe(0);
    expect(win.padBottom).toBe((100 - 10) * 40);
  });

  it("advances the window when scrolled into the middle", () => {
    const win = computeVirtualWindow({
      scrollTop: 1000, // 25 rows down
      viewportHeight: 400,
      rowHeight: 40,
      overscan: 0,
      totalRows: 100,
    });
    expect(win.startIndex).toBe(25); // floor(1000/40)
    expect(win.endIndex).toBe(35); // ceil(1400/40)
    expect(win.padTop).toBe(25 * 40);
    expect(win.padBottom).toBe((100 - 35) * 40);
  });

  it("expands the band by overscan on both sides without leaving range", () => {
    const win = computeVirtualWindow({
      scrollTop: 1000,
      viewportHeight: 400,
      rowHeight: 40,
      overscan: 5,
      totalRows: 100,
    });
    expect(win.startIndex).toBe(20); // 25 - 5
    expect(win.endIndex).toBe(40); // 35 + 5
  });

  it("clamps the overscan band to the data edges at the top and bottom", () => {
    const top = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 40,
      overscan: 5,
      totalRows: 100,
    });
    expect(top.startIndex).toBe(0); // 0 - 5 clamped to 0
    expect(top.padTop).toBe(0);

    const bottom = computeVirtualWindow({
      scrollTop: 3600, // 90 rows down, last page
      viewportHeight: 400,
      rowHeight: 40,
      overscan: 5,
      totalRows: 100,
    });
    expect(bottom.endIndex).toBe(100); // clamped to totalRows
    expect(bottom.padBottom).toBe(0);
  });
});

describe("computeVirtualWindow — adversarial inputs are all survived", () => {
  // Each row models a corrupt/extreme geometry the runtime can actually produce.
  const cases: Array<[string, VirtualWindowInput]> = [
    ["totalRows = 0 (empty data set)", base({ totalRows: 0 })],
    ["totalRows = 1 (single row)", base({ totalRows: 1 })],
    ["negative totalRows", base({ totalRows: -50 })],
    ["NaN totalRows", base({ totalRows: NaN })],
    ["Infinity totalRows", base({ totalRows: Infinity })],
    ["fractional totalRows (2.9 rows)", base({ totalRows: 2.9 })],
    ["rowHeight = 0", base({ rowHeight: 0 })],
    ["negative rowHeight", base({ rowHeight: -40 })],
    ["NaN rowHeight", base({ rowHeight: NaN })],
    ["Infinity rowHeight", base({ rowHeight: Infinity })],
    ["fractional rowHeight (33.3px)", base({ rowHeight: 33.3 })],
    ["scrollTop far beyond content", base({ scrollTop: 1e9 })],
    ["negative scrollTop", base({ scrollTop: -500 })],
    ["NaN scrollTop", base({ scrollTop: NaN })],
    ["Infinity scrollTop", base({ scrollTop: Infinity })],
    ["fractional scrollTop", base({ scrollTop: 137.7 })],
    ["viewportHeight = 0 (collapsed pane)", base({ viewportHeight: 0 })],
    ["negative viewportHeight", base({ viewportHeight: -400 })],
    ["NaN viewportHeight", base({ viewportHeight: NaN })],
    ["Infinity viewportHeight", base({ viewportHeight: Infinity })],
    [
      "viewportHeight taller than all content",
      base({ viewportHeight: 1e6, totalRows: 5 }),
    ],
    ["overscan > totalRows", base({ overscan: 5000, totalRows: 10 })],
    ["negative overscan", base({ overscan: -5 })],
    ["NaN overscan", base({ overscan: NaN })],
    ["Infinity overscan", base({ overscan: Infinity })],
    ["fractional overscan", base({ overscan: 3.7 })],
    [
      "every field NaN at once",
      {
        scrollTop: NaN,
        viewportHeight: NaN,
        rowHeight: NaN,
        overscan: NaN,
        totalRows: NaN,
      },
    ],
    [
      "every field Infinity at once",
      {
        scrollTop: Infinity,
        viewportHeight: Infinity,
        rowHeight: Infinity,
        overscan: Infinity,
        totalRows: Infinity,
      },
    ],
  ];

  it.each(cases)("survives %s with all invariants intact", (_label, input) => {
    expect(() => expectValidWindow(input)).not.toThrow();
  });

  it("never throws and emits an empty padded-zero window for an empty data set", () => {
    const win = computeVirtualWindow(base({ totalRows: 0 }));
    expect(win).toEqual({
      startIndex: 0,
      endIndex: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("falls back to a positive row height when rowHeight is non-positive/non-finite", () => {
    for (const bad of [0, -40, NaN, Infinity, -Infinity]) {
      const win = expectValidWindow(base({ rowHeight: bad, totalRows: 100 }));
      // padTop is startIndex * fallbackHeight, so a non-positive raw rowHeight
      // can never yield a NaN/negative spacer — proven by expectValidWindow, and
      // pinned here that the content height used the fallback, not 0.
      expect(win.padTop + win.padBottom).toBeGreaterThanOrEqual(0);
    }
    // total content height conserved with the fallback height:
    const win = computeVirtualWindow(
      base({ rowHeight: 0, totalRows: 100, viewportHeight: 10, scrollTop: 0 })
    );
    const visible = (win.endIndex - win.startIndex) * DEFAULT_VIRTUAL_ROW_HEIGHT;
    expect(win.padTop + visible + win.padBottom).toBe(
      100 * DEFAULT_VIRTUAL_ROW_HEIGHT
    );
  });

  it("clamps a fling-scroll past the end onto the last page, padBottom = 0", () => {
    const win = computeVirtualWindow({
      scrollTop: 1e9,
      viewportHeight: 400,
      rowHeight: 40,
      overscan: 0,
      totalRows: 100,
    });
    expect(win.endIndex).toBe(100);
    expect(win.padBottom).toBe(0);
    expect(win.startIndex).toBeLessThanOrEqual(99);
  });
});

describe("computeVirtualWindow — PROPERTY: structural invariants over random geometry", () => {
  // A generator spanning clean and adversarial geometry. ~1/6 of the time it
  // injects a non-finite/junk value into each numeric field so the property runs
  // exercise both the happy index math and every fail-safe branch.
  const maybeJunk = (rng: () => number, clean: number): number => {
    const r = rng();
    if (r < 0.04) return NaN;
    if (r < 0.08) return Infinity;
    if (r < 0.1) return -Infinity;
    if (r < 0.14) return -clean - 1; // negative
    return clean;
  };

  const randomInput = (rng: () => number): VirtualWindowInput => ({
    scrollTop: maybeJunk(rng, rng() * 200_000),
    viewportHeight: maybeJunk(rng, randInt(rng, 0, 2000)),
    rowHeight: maybeJunk(rng, rng() < 0.3 ? rng() * 60 : randInt(rng, 1, 80)),
    overscan: maybeJunk(rng, randInt(rng, 0, 50)),
    totalRows: maybeJunk(rng, randInt(rng, 0, 5000)),
  });

  it("satisfies IN-RANGE / CONSERVATION / NON-NEGATIVE for every random input", () => {
    const rng = makeRng(0x5eed_c0de);
    for (let i = 0; i < PROPERTY_RUNS; i += 1) {
      expectValidWindow(randomInput(rng));
    }
  });

  it("keeps startIndex AND endIndex non-decreasing as scrollTop increases (MONOTONIC)", () => {
    const rng = makeRng(0xabad_1dea);
    for (let i = 0; i < PROPERTY_RUNS; i += 1) {
      // Fix a geometry, then sweep scrollTop upward through 12 finite samples.
      const rowHeight = randInt(rng, 1, 80);
      const totalRows = randInt(rng, 0, 5000);
      const viewportHeight = randInt(rng, 0, 2000);
      const overscan = randInt(rng, 0, 50);
      const contentHeight = totalRows * rowHeight;

      let prevStart = -1;
      let prevEnd = -1;
      for (let s = 0; s < 12; s += 1) {
        // monotonically increasing scrollTop samples, including past-content.
        const scrollTop = (contentHeight / 8) * s;
        const win = computeVirtualWindow({
          scrollTop,
          viewportHeight,
          rowHeight,
          overscan,
          totalRows,
        });
        expect(win.startIndex).toBeGreaterThanOrEqual(prevStart);
        expect(win.endIndex).toBeGreaterThanOrEqual(prevEnd);
        prevStart = win.startIndex;
        prevEnd = win.endIndex;
      }
    }
  });

  it("is deterministic: identical input yields an identical window", () => {
    const rng = makeRng(0xc0ff_ee01);
    for (let i = 0; i < PROPERTY_RUNS; i += 1) {
      const input = randomInput(rng);
      expect(computeVirtualWindow(input)).toEqual(computeVirtualWindow(input));
    }
  });

  it("never mutates its input object", () => {
    const rng = makeRng(0xdead_beef);
    for (let i = 0; i < PROPERTY_RUNS; i += 1) {
      const input = randomInput(rng);
      const snapshot = { ...input };
      computeVirtualWindow(input);
      expect(input).toEqual(snapshot);
    }
  });
});

// Build a default-valid geometry and override only the fields a case cares about,
// so each adversarial case isolates ONE corrupt dimension against an otherwise
// sane window.
function base(over: Partial<VirtualWindowInput>): VirtualWindowInput {
  return {
    scrollTop: 1000,
    viewportHeight: 400,
    rowHeight: 40,
    overscan: 3,
    totalRows: 200,
    ...over,
  };
}
