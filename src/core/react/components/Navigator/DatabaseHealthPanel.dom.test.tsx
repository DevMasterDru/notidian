/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render coverage for the Database Health panel
// (Notidian-loan.5, ADR-0057 D3/D4). makemd-core is stubbed (type-only
// dependency, same pattern as HubRowIndicator.dom.test.tsx / SyncWarnings'
// own runtime graph) so this never loads the real Superstate.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("makemd-core", () => ({}));

import {
  DatabaseHealthPanel,
  formatIssueCount,
} from "./DatabaseHealthPanel";
import { Violation } from "core/utils/contexts/validateRow";

const enumViolation: Violation = {
  field: "status",
  code: "enum",
  severity: "error",
  message: 'status: "bogus" is not a declared enum value.',
  repairTier: "one-click",
  suggestedFix: "Choose one of: a, b.",
};

const makeSuperstate = (opts: {
  rowViolations?: Map<string, Violation[]>;
  sweepIncomplete?: { examinedRows: number; expectedRows: number | null; message: string };
  allDbPaths?: string[];
  countsByDb?: Record<string, number>;
  // Notidian-loan.5 review round 2 (unit S3): defaults ON so every EXISTING
  // test below (written before the panel self-guarded the flag) keeps
  // exercising the real content; the dedicated "flag off" test passes
  // `false` explicitly.
  enableDataHealthSurfaces?: boolean;
  // Notidian-loan.5 review round 2 (unit tests #3): omit the reconciler
  // entirely to prove the panel never throws for a caller that opens it
  // before/without one.
  noReconciler?: boolean;
}) => {
  const rowViolations = opts.rowViolations ?? new Map<string, Violation[]>();
  const rowCount = [...rowViolations.values()].reduce((n, v) => n + v.length, 0);
  const sweepBonus = opts.sweepIncomplete ? 1 : 0;
  return {
    settings: {
      enableDataHealthSurfaces: opts.enableDataHealthSurfaces ?? true,
    },
    reconciler: opts.noReconciler
      ? undefined
      : {
          onChange: jest.fn(() => () => {}),
          getDbViolations: jest.fn(() => rowViolations),
          getSweepIncomplete: jest.fn(() => opts.sweepIncomplete),
          getAllDbPaths: jest.fn(() => opts.allDbPaths ?? []),
          getViolationCount: jest.fn((dbPath?: string) => {
            if (!dbPath) return rowCount + sweepBonus;
            if (opts.countsByDb && dbPath in opts.countsByDb) {
              return opts.countsByDb[dbPath];
            }
            return rowCount + sweepBonus;
          }),
        },
  } as any;
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("formatIssueCount", () => {
  it("singularizes 1 issue and pluralizes everything else", () => {
    expect(formatIssueCount(1)).toBe("1 issue");
    expect(formatIssueCount(0)).toBe("0 issues");
    expect(formatIssueCount(3)).toBe("3 issues");
  });
});

describe("DatabaseHealthPanel", () => {
  it("db view: total matches getViolationCount's own formula (rows + sweep-incomplete)", async () => {
    const superstate = makeSuperstate({
      rowViolations: new Map([["db/row1.md", [enumViolation]]]),
      sweepIncomplete: {
        examinedRows: 0,
        expectedRows: 2,
        message: "Sweep examined 0 of 2 row(s).",
      },
    });

    await act(async () => {
      root.render(
        <DatabaseHealthPanel superstate={superstate} dbPath="db/path" />
      );
    });

    expect(superstate.reconciler.getViolationCount).toHaveBeenCalledWith(
      "db/path"
    );
    const totalEl = container.querySelector(".mk-health-total");
    // 1 row violation + 1 for the sweep-incomplete flag == the SAME formula
    // getViolationCount itself implements.
    expect(totalEl?.getAttribute("data-panel-violation-count")).toBe("2");

    const rowCard = container.querySelector(".mk-health-row-card");
    expect(rowCard?.getAttribute("data-row-path")).toBe("db/row1.md");
    expect(rowCard?.textContent).toContain(enumViolation.message);
    expect(rowCard?.textContent).toContain("one-click");

    const sweepCard = container.querySelector(
      ".mk-health-sweep-incomplete-card"
    );
    expect(sweepCard?.textContent).toContain(
      "Sweep examined 0 of 2 row(s)."
    );
  });

  it("vault-wide view: lists every getAllDbPaths() entry with its own getViolationCount", async () => {
    const superstate = makeSuperstate({
      allDbPaths: ["db/a", "db/b"],
      countsByDb: { "db/a": 3, "db/b": 0 },
    });

    await act(async () => {
      root.render(<DatabaseHealthPanel superstate={superstate} />);
    });

    const cards = container.querySelectorAll(".mk-health-db-card");
    expect(cards).toHaveLength(2);
    const cardA = container.querySelector('[data-db-path="db/a"]');
    const cardB = container.querySelector('[data-db-path="db/b"]');
    expect(cardA?.getAttribute("data-violation-count")).toBe("3");
    expect(cardB?.getAttribute("data-violation-count")).toBe("0");
    expect(cardA?.textContent).toContain("3 issues");
    expect(cardB?.textContent).toContain("No issues");
  });

  it("clicking a vault-wide db card switches into that database's own view", async () => {
    const superstate = makeSuperstate({
      allDbPaths: ["db/a"],
      countsByDb: { "db/a": 1 },
      rowViolations: new Map([["db/a/row1.md", [enumViolation]]]),
    });

    await act(async () => {
      root.render(<DatabaseHealthPanel superstate={superstate} />);
    });

    const cardA = container.querySelector(
      '[data-db-path="db/a"]'
    ) as HTMLElement;
    await act(async () => {
      cardA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-health-view="db"]')).not.toBeNull();
    expect(container.querySelector(".mk-health-row-card")).not.toBeNull();
  });

  it("'All databases' link switches from db view to vault view", async () => {
    const superstate = makeSuperstate({ allDbPaths: ["db/a"] });

    await act(async () => {
      root.render(
        <DatabaseHealthPanel superstate={superstate} dbPath="db/path" />
      );
    });

    const link = container.querySelector(
      ".mk-health-all-databases-link"
    ) as HTMLButtonElement;
    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-health-view="vault"]')).not.toBeNull();
  });

  it("'Show row' calls hide() then dispatches a window CustomEvent with {dbPath, rowPath}", async () => {
    const superstate = makeSuperstate({
      rowViolations: new Map([["db/row1.md", [enumViolation]]]),
    });
    const hide = jest.fn();
    const jumpListener = jest.fn();
    window.addEventListener("mk-health-jump-to-row", jumpListener);

    await act(async () => {
      root.render(
        <DatabaseHealthPanel
          superstate={superstate}
          dbPath="db/path"
          hide={hide}
        />
      );
    });

    const showRowButton = container.querySelector(
      ".mk-health-show-row"
    ) as HTMLButtonElement;
    await act(async () => {
      showRowButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(hide).toHaveBeenCalledTimes(1);
    expect(jumpListener).toHaveBeenCalledTimes(1);
    const event = jumpListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ dbPath: "db/path", rowPath: "db/row1.md" });

    window.removeEventListener("mk-health-jump-to-row", jumpListener);
  });

  // Notidian-loan.5 review round 2 (unit S3): the panel self-guards the
  // flag so it is safe regardless of which caller opens it (defense-in-
  // depth alongside FilterBar's own gate on rendering the chip at all).
  it("renders nothing when enableDataHealthSurfaces is off, regardless of which caller opens it (unit S3)", async () => {
    const superstate = makeSuperstate({
      enableDataHealthSurfaces: false,
      rowViolations: new Map([["db/row1.md", [enumViolation]]]),
    });

    await act(async () => {
      root.render(
        <DatabaseHealthPanel superstate={superstate} dbPath="db/path" />
      );
    });

    expect(container.querySelector(".mk-health-panel")).toBeNull();
    expect(container.textContent).toBe("");
  });

  // Notidian-loan.5 review round 2 (unit tests #3): a caller that opens the
  // panel before/without a reconciler must never crash it.
  it("never throws and renders an empty state when reconciler is undefined", async () => {
    const superstate = makeSuperstate({ noReconciler: true });

    await act(async () => {
      root.render(
        <DatabaseHealthPanel superstate={superstate} dbPath="db/path" />
      );
    });

    expect(container.querySelector('[data-health-view="db"]')).not.toBeNull();
    expect(container.querySelector(".mk-health-row-card")).toBeNull();
    expect(
      container.querySelector(".mk-health-total")?.getAttribute("data-panel-violation-count")
    ).toBe("0");
  });

  // Notidian-loan.5 review round 2 (unit tests #3): two violations on the
  // SAME row must both surface, and the row card's own count must reflect
  // both -- never just the first/last.
  it("renders both violations for a row that carries 2 (multi-violation-per-row)", async () => {
    const requiredViolation: Violation = {
      field: "priority",
      code: "required",
      severity: "error",
      message: "priority: a value is required.",
      repairTier: "manual-only",
    };
    const superstate = makeSuperstate({
      rowViolations: new Map([["db/row1.md", [enumViolation, requiredViolation]]]),
    });

    await act(async () => {
      root.render(
        <DatabaseHealthPanel superstate={superstate} dbPath="db/path" />
      );
    });

    const rowCard = container.querySelector(".mk-health-row-card");
    expect(rowCard?.getAttribute("data-violation-count")).toBe("2");
    expect(rowCard?.textContent).toContain(enumViolation.message);
    expect(rowCard?.textContent).toContain(requiredViolation.message);
  });

  // Notidian-loan.5 review round 2 (unit tests #3): captures the onChange
  // listener directly (rather than relying on the reconciler's own
  // getDbViolations mock to change) plus a DISTINCT unsubscribe mock, so the
  // re-render-on-bump wiring and the unmount cleanup are each independently
  // provable. Uses its own LOCAL root/container (not the shared
  // beforeEach/afterEach one) so it can unmount exactly once, mid-test.
  it("re-renders when the captured onChange listener fires, and unsubscribes exactly once on unmount", async () => {
    let changeListener: ((dbPath?: string) => void) | undefined;
    const unsubscribe = jest.fn();
    let currentCount = 1;
    const superstate = {
      settings: { enableDataHealthSurfaces: true },
      reconciler: {
        onChange: jest.fn((listener: (dbPath?: string) => void) => {
          changeListener = listener;
          return unsubscribe;
        }),
        getDbViolations: jest.fn(() => new Map([["db/row1.md", [enumViolation]]])),
        getSweepIncomplete: jest.fn(
          ():
            | { examinedRows: number; expectedRows: number | null; message: string }
            | undefined => undefined
        ),
        getAllDbPaths: jest.fn((): string[] => []),
        getViolationCount: jest.fn(() => currentCount),
      },
    } as any;

    const localContainer = document.createElement("div");
    document.body.appendChild(localContainer);
    const localRoot = createRoot(localContainer);

    await act(async () => {
      localRoot.render(
        <DatabaseHealthPanel superstate={superstate} dbPath="db/path" />
      );
    });

    expect(
      localContainer
        .querySelector(".mk-health-total")
        ?.getAttribute("data-panel-violation-count")
    ).toBe("1");
    expect(changeListener).toBeDefined();

    currentCount = 5;
    await act(async () => {
      changeListener?.("db/path");
    });

    expect(
      localContainer
        .querySelector(".mk-health-total")
        ?.getAttribute("data-panel-violation-count")
    ).toBe("5");
    expect(unsubscribe).not.toHaveBeenCalled();

    await act(async () => {
      localRoot.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    localContainer.remove();
  });
});
