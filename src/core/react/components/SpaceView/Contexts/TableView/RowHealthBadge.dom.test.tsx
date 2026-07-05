/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render coverage for the row-health badge (Notidian-loan.5,
// ADR-0057 D3/D4) — mirrors HubRowIndicator.dom.test.tsx's style. No
// makemd-core / Superstate dependency at all (the component only takes
// `violations` + an `onOpenMenu` callback), so nothing needs stubbing.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { Violation } from "core/utils/contexts/validateRow";
import { RowHealthBadge } from "./RowHealthBadge";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

const enumViolation: Violation = {
  field: "status",
  code: "enum",
  severity: "error",
  message: 'status: "bogus" is not a declared enum value.',
  repairTier: "one-click",
  suggestedFix: "Choose one of: a, b.",
};

const warnViolation: Violation = {
  field: "ref",
  code: "reference-broken",
  severity: "warn",
  message: 'ref: "x" has no matching row.',
  repairTier: "one-click",
};

describe("RowHealthBadge", () => {
  it("renders nothing for an empty violation list", async () => {
    await act(async () => {
      root.render(<RowHealthBadge violations={[]} />);
    });
    expect(container.querySelector("button")).toBeNull();
  });

  it("tints error when any violation is error-severity, even alongside a warn", async () => {
    await act(async () => {
      root.render(<RowHealthBadge violations={[warnViolation, enumViolation]} />);
    });
    const button = container.querySelector("button.mk-row-health-badge");
    expect(button).not.toBeNull();
    expect(button?.classList.contains("mk-row-health-badge--error")).toBe(true);
    expect(button?.classList.contains("mk-row-health-badge--warn")).toBe(false);
  });

  it("tints warn when every violation is warn-severity", async () => {
    await act(async () => {
      root.render(<RowHealthBadge violations={[warnViolation]} />);
    });
    const button = container.querySelector("button.mk-row-health-badge");
    expect(button?.classList.contains("mk-row-health-badge--warn")).toBe(true);
  });

  it("exposes the data-* contract: count, worst code, worst repair tier", async () => {
    await act(async () => {
      root.render(<RowHealthBadge violations={[warnViolation, enumViolation]} />);
    });
    const button = container.querySelector(
      "button.mk-row-health-badge"
    ) as HTMLButtonElement;
    expect(button.getAttribute("data-violation-count")).toBe("2");
    // enumViolation is the worst (error > warn) — its code/tier win.
    expect(button.getAttribute("data-violation-code")).toBe("enum");
    expect(button.getAttribute("data-repair-tier")).toBe("one-click");
  });

  it("joins every violation's message + code into the native title tooltip", async () => {
    await act(async () => {
      root.render(<RowHealthBadge violations={[warnViolation, enumViolation]} />);
    });
    const button = container.querySelector(
      "button.mk-row-health-badge"
    ) as HTMLButtonElement;
    const title = button.getAttribute("title") ?? "";
    expect(title).toContain(warnViolation.message);
    expect(title).toContain("(reference-broken)");
    expect(title).toContain(enumViolation.message);
    expect(title).toContain("(enum)");
    expect(title.split("\n")).toHaveLength(2);
  });

  it("shows a count badge only when there is more than one violation", async () => {
    await act(async () => {
      root.render(<RowHealthBadge violations={[enumViolation]} />);
    });
    expect(
      container.querySelector(".mk-row-health-badge-count")
    ).toBeNull();

    await act(async () => {
      root.render(<RowHealthBadge violations={[warnViolation, enumViolation]} />);
    });
    expect(
      container.querySelector(".mk-row-health-badge-count")?.textContent
    ).toBe("2");
  });

  it("clicking calls onOpenMenu exactly once and stops the click from bubbling to a parent row handler", async () => {
    const onOpenMenu = jest.fn();
    const onRowClick = jest.fn();

    await act(async () => {
      root.render(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div onClick={onRowClick}>
          <RowHealthBadge violations={[enumViolation]} onOpenMenu={onOpenMenu} />
        </div>
      );
    });

    const button = container.querySelector(
      "button.mk-row-health-badge"
    ) as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
