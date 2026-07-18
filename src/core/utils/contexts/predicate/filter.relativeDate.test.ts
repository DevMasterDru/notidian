/**
 * withinLast / olderThan — now-relative date filter fns (ADR 0066 /
 * Notidian-l12a: relative-date filter fns for the Topic Hub
 * Recently-Closed/Stalled overlays that Notidian-ioxi will consume).
 *
 * These two operators accept a relative-token operand (e.g. '7d', '2w', '1m',
 * '1y' — units d/w/m/y) instead of an absolute date string, resolved against
 * `now` via the sibling helper `resolveRelativeDateOperand`. That helper is
 * kept deliberately OUT of `parseDateOperand`: an earlier attempt at this bead
 * folded relative-token parsing into `parseDateOperand` itself (shared by
 * dateAfter/dateBefore) and, as an unreviewed side effect, made THOSE two
 * existing absolute-date operators also silently accept a relative token —
 * that failed review and was reverted. Isolating the grammar in its own
 * helper means dateAfter/dateBefore's operand parsing is untouched here;
 * only withinLast/olderThan resolve relative tokens.
 *
 * `now` is FIXED for every withinLast/olderThan assertion via Jest fake
 * timers (never derived from the live wall clock), so the boundary math is
 * deterministic regardless of which real calendar day the suite runs on.
 * `resolveRelativeDateOperand` itself additionally accepts an INJECTED `now`
 * argument, so its own grammar/unit assertions need no timer mocking at all.
 *
 * Value/threshold strings use local noon ("...T12:00:00", no zone
 * designator) — the same TZ-robustness convention filter.test.ts already
 * documents for dateAfter/dateBefore — so day-boundary math can't flip with
 * the host machine's timezone offset.
 */
import { withinLast, olderThan, resolveRelativeDateOperand } from "./filter";
import { filterFnTypes } from "./filterFns/filterFnTypes";

// Fixed "now" for every withinLast/olderThan assertion: local noon on
// 2026-07-11 (mirrors the bead's own acceptance example verbatim). Noon keeps
// the instant far from any midnight boundary so it can't drift a calendar day
// in either direction under a host timezone shift.
const FIXED_NOW = new Date(2026, 6, 11, 12, 0, 0); // 2026-07-11, local noon

describe("relative-date filter fns (withinLast / olderThan) — Notidian-l12a", () => {
  // ----------------------------------------------------------------------- //
  // resolveRelativeDateOperand — the relative-token grammar, tested via     //
  // direct `now` injection (no timer mocking needed for this half).         //
  // ----------------------------------------------------------------------- //
  describe("resolveRelativeDateOperand (relative-token grammar, injected now)", () => {
    it("'d' unit steps back N whole days from now's local start-of-day", () => {
      const result = resolveRelativeDateOperand("3d", FIXED_NOW);
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(6); // July (0-indexed)
      expect(result.getDate()).toBe(8); // 11 - 3
      expect(result.getHours()).toBe(0); // truncated to start-of-day
    });

    it("'w' unit steps back N*7 days from now's local start-of-day", () => {
      const result = resolveRelativeDateOperand("2w", FIXED_NOW);
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(5); // June
      expect(result.getDate()).toBe(27); // July 11 - 14 days = June 27
    });

    it("'m' unit steps back N calendar months (mid-month)", () => {
      const result = resolveRelativeDateOperand("1m", FIXED_NOW);
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(5); // June
      expect(result.getDate()).toBe(11);
    });

    it("'y' unit steps back N calendar years (non-leap-day date)", () => {
      const result = resolveRelativeDateOperand("1y", FIXED_NOW);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(6);
      expect(result.getDate()).toBe(11);
    });

    it("clamps 31 March minus one month to the last valid day of February", () => {
      const result = resolveRelativeDateOperand(
        "1m",
        new Date(2026, 2, 31, 12, 0, 0)
      );
      expect(result).toEqual(new Date(2026, 1, 28));
    });

    it("clamps leap day minus one year to 28 February", () => {
      const result = resolveRelativeDateOperand(
        "1y",
        new Date(2024, 1, 29, 12, 0, 0)
      );
      expect(result).toEqual(new Date(2023, 1, 28));
    });

    it.each([
      ["15m", new Date(2026, 2, 31, 12, 0, 0), new Date(2024, 11, 31)],
      ["13m", new Date(2026, 2, 31, 12, 0, 0), new Date(2025, 1, 28)],
      ["5y", new Date(2024, 1, 29, 12, 0, 0), new Date(2019, 1, 28)],
      ["4y", new Date(2024, 1, 29, 12, 0, 0), new Date(2020, 1, 29)],
    ])(
      "clamps multi-period crossing %s without calendar rollover",
      (token, now, expected) => {
        expect(resolveRelativeDateOperand(token, now)).toEqual(expected);
      }
    );

    it("defaults `now` to the real current time when omitted", () => {
      // Convention (matches filter.test.ts's isSameDayAsToday tests): derive
      // the expected value from a live `new Date()` rather than hardcoding a
      // calendar date, so this assertion never goes stale.
      const today = new Date();
      const result = resolveRelativeDateOperand("0d");
      expect(result.getFullYear()).toBe(today.getFullYear());
      expect(result.getMonth()).toBe(today.getMonth());
      expect(result.getDate()).toBe(today.getDate());
      expect(result.getHours()).toBe(0);
    });

    it.each([
      ["missing unit letter", "7"],
      ["unrecognized unit letter", "7x"],
      ["the old (reverted) dash-prefixed form is NOT accepted", "-7d"],
      ["non-numeric amount", "sevend"],
      ["empty string", ""],
      ["unrelated garbage", "garbage"],
      ["trailing garbage after an otherwise-valid token", "7dd"],
      ["a decimal amount", "1.5d"],
      ["whitespace-only", "   "],
    ])("malformed token %s (%j) resolves to an Invalid Date (fail-closed)", (_label, token) => {
      const result = resolveRelativeDateOperand(token, FIXED_NOW);
      expect(isNaN(result.getTime())).toBe(true);
    });

    it("null/undefined token resolves to an Invalid Date without throwing", () => {
      expect(() =>
        resolveRelativeDateOperand(null as any, FIXED_NOW)
      ).not.toThrow();
      expect(
        isNaN(resolveRelativeDateOperand(null as any, FIXED_NOW).getTime())
      ).toBe(true);
      expect(() =>
        resolveRelativeDateOperand(undefined as any, FIXED_NOW)
      ).not.toThrow();
      expect(
        isNaN(
          resolveRelativeDateOperand(undefined as any, FIXED_NOW).getTime()
        )
      ).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  // withinLast / olderThan — the registry FilterFunctions, exercised with a //
  // FIXED system clock (no `now` param on their 2-arg FilterFunction shape).//
  // ----------------------------------------------------------------------- //
  describe("withinLast / olderThan (registry FilterFunctions, fixed system clock)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(FIXED_NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // Acceptance scenario (bead Notidian-l12a), verbatim: on 2026-07-11,
    // withinLast('2026-07-05','7d') is true and olderThan(...) is false.
    it("ACCEPTANCE: withinLast('2026-07-05','7d') true / olderThan(...) false on 2026-07-11", () => {
      expect(withinLast("2026-07-05T12:00:00", "7d")).toBe(true);
      expect(olderThan("2026-07-05T12:00:00", "7d")).toBe(false);
    });

    it("within-window: boundary-inclusive true (value exactly on the threshold day)", () => {
      // threshold for '7d' on 2026-07-11 is 2026-07-04.
      expect(withinLast("2026-07-04T12:00:00", "7d")).toBe(true);
    });

    it("within-window: true for a value strictly inside the window", () => {
      expect(withinLast("2026-07-10T12:00:00", "7d")).toBe(true);
    });

    it("outside-window: false for a value one day older than the threshold", () => {
      expect(withinLast("2026-07-03T12:00:00", "7d")).toBe(false);
    });

    it("olderThan is the complement of withinLast at the boundary", () => {
      // On the threshold day itself: withinLast true, olderThan false.
      expect(olderThan("2026-07-04T12:00:00", "7d")).toBe(false);
      // One day older than the threshold: withinLast false, olderThan true.
      expect(olderThan("2026-07-03T12:00:00", "7d")).toBe(true);
    });

    it("units d and w both resolve correctly through the FilterFunctions", () => {
      // 'd': 3 days ago from 2026-07-11 is 2026-07-08.
      expect(withinLast("2026-07-08T12:00:00", "3d")).toBe(true);
      expect(olderThan("2026-07-08T12:00:00", "3d")).toBe(false);
      expect(withinLast("2026-07-07T12:00:00", "3d")).toBe(false);
      expect(olderThan("2026-07-07T12:00:00", "3d")).toBe(true);

      // 'w': 1 week ago from 2026-07-11 is 2026-07-04.
      expect(withinLast("2026-07-04T12:00:00", "1w")).toBe(true);
      expect(olderThan("2026-07-04T12:00:00", "1w")).toBe(false);
      expect(withinLast("2026-07-03T12:00:00", "1w")).toBe(false);
      expect(olderThan("2026-07-03T12:00:00", "1w")).toBe(true);
    });

    it("malformed value is fail-closed for BOTH operators (valid token)", () => {
      expect(withinLast("garbage-not-a-date", "7d")).toBe(false);
      expect(olderThan("garbage-not-a-date", "7d")).toBe(false);
    });

    it("malformed token is fail-closed for BOTH operators (valid value)", () => {
      expect(withinLast("2026-07-05T12:00:00", "not-a-token")).toBe(false);
      expect(olderThan("2026-07-05T12:00:00", "not-a-token")).toBe(false);
    });

    it("the old (reverted) dash-prefixed token form is rejected, not silently accepted", () => {
      // Deliberate grammar choice (see filter.ts): only 'Nd'/'Nw'/'Nm'/'Ny' is
      // accepted; a leading '-' never matches, so a token in the earlier
      // (reverted) grammar just fails closed rather than silently resolving.
      expect(withinLast("2026-07-05T12:00:00", "-7d")).toBe(false);
      expect(olderThan("2026-07-05T12:00:00", "-7d")).toBe(false);
    });

    it("does not throw on hostile value/token combinations", () => {
      const hostileValues: unknown[] = [null, undefined, "", "   ", 0, false];
      const hostileTokens: unknown[] = [
        null,
        undefined,
        "",
        "2024-03-15T12:00:00",
        0,
        false,
      ];
      for (const v of hostileValues) {
        for (const f of hostileTokens) {
          expect(() => withinLast(v as any, f as any)).not.toThrow();
          expect(() => olderThan(v as any, f as any)).not.toThrow();
        }
      }
    });
  });

  // ----------------------------------------------------------------------- //
  // Registry-shape assertions: both operators are wired into filterFnTypes  //
  // as date-column operators, and the registry dispatches to the same       //
  // implementations exported above.                                        //
  // ----------------------------------------------------------------------- //
  describe("filterFnTypes registry — withinLast/olderThan entries (Notidian-l12a)", () => {
    it("withinLast is registered for date columns with a callable fn", () => {
      expect(filterFnTypes.withinLast).toBeDefined();
      expect(filterFnTypes.withinLast.type).toEqual(["date"]);
      expect(typeof filterFnTypes.withinLast.fn).toBe("function");
      expect(typeof filterFnTypes.withinLast.valueType).toBe("string");
      expect(filterFnTypes.withinLast.valueType.length).toBeGreaterThan(0);
    });

    it("olderThan is registered for date columns with a callable fn", () => {
      expect(filterFnTypes.olderThan).toBeDefined();
      expect(filterFnTypes.olderThan.type).toEqual(["date"]);
      expect(typeof filterFnTypes.olderThan.fn).toBe("function");
      expect(typeof filterFnTypes.olderThan.valueType).toBe("string");
      expect(filterFnTypes.olderThan.valueType.length).toBeGreaterThan(0);
    });

    it("the registry entries dispatch to the same withinLast/olderThan implementations", () => {
      jest.useFakeTimers();
      jest.setSystemTime(FIXED_NOW);
      try {
        expect(filterFnTypes.withinLast.fn("2026-07-05T12:00:00", "7d")).toBe(
          withinLast("2026-07-05T12:00:00", "7d")
        );
        expect(filterFnTypes.olderThan.fn("2026-07-05T12:00:00", "7d")).toBe(
          olderThan("2026-07-05T12:00:00", "7d")
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
