/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render coverage for the read-only lock badge (Notidian-loan.15,
// Atlas Method ADR-0069) — mirrors RowHealthBadge.dom.test.tsx's style. The
// component takes only `enabled` + `locked` (no makemd-core / Superstate
// dependency), so nothing needs stubbing.
//
// This is the offline half of a flag-gated core render-path change: it proves
// the full flag-OFF / locked-false / locked-absent / locked-true matrix AND the
// read-only invariants (no button, no click handler, no dangerous HTML sink) so
// the only thing left for the owner is live placement (docs/AUTONOMOUS-REVIEW-QUEUE.md).
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { isLockedValue, LockBadge } from "./LockBadge";

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

const render = (el: React.ReactElement) =>
  act(() => {
    root.render(el);
  });

describe("LockBadge — render matrix", () => {
  it("renders the badge when the flag is ON and the row is locked", async () => {
    await render(<LockBadge enabled={true} locked={true} />);
    const badge = container.querySelector(".mk-lock-badge");
    expect(badge).not.toBeNull();
    // The glyph is a pure CSS-icon span (no SVG/innerHTML).
    expect(container.querySelector(".mk-lock-badge-icon")).not.toBeNull();
  });

  it("renders NOTHING when the flag is OFF (even if the row is locked)", async () => {
    await render(<LockBadge enabled={false} locked={true} />);
    expect(container.querySelector(".mk-lock-badge")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the flag is ON but the row is not locked", async () => {
    await render(<LockBadge enabled={true} locked={false} />);
    expect(container.querySelector(".mk-lock-badge")).toBeNull();
  });

  it("renders nothing when `locked` is absent (undefined)", async () => {
    await render(<LockBadge enabled={true} />);
    expect(container.querySelector(".mk-lock-badge")).toBeNull();
  });

  it("renders nothing when both flag and locked are absent", async () => {
    await render(<LockBadge />);
    expect(container.querySelector(".mk-lock-badge")).toBeNull();
  });
});

describe("LockBadge — read-only / non-interactive invariants (ADR-0069 D2 + ADR-0017)", () => {
  it("is NOT a button and carries no click handler (no click-to-unlock, no write path)", async () => {
    await render(<LockBadge enabled={true} locked={true} />);
    // No <button> anywhere — it is a plain <span>, not an actionable control.
    expect(container.querySelector("button")).toBeNull();
    const badge = container.querySelector(".mk-lock-badge") as HTMLElement;
    expect(badge.tagName).toBe("SPAN");
    // onClick would attach a React handler; dispatching a click must be a no-op
    // (nothing to invoke) and must not throw.
    let threw = false;
    try {
      await act(async () => {
        badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it("uses no dangerous HTML sink — the badge subtree has no injected markup", async () => {
    await render(<LockBadge enabled={true} locked={true} />);
    const badge = container.querySelector(".mk-lock-badge") as HTMLElement;
    // Only the empty CSS-icon span child; no SVG, no arbitrary HTML.
    expect(badge.querySelector("svg")).toBeNull();
    expect(badge.querySelector(".mk-lock-badge-icon")?.innerHTML).toBe("");
  });
});

describe("isLockedValue — reserved `locked` truthiness resolver", () => {
  it("treats boolean true and the string 'true' as locked", () => {
    expect(isLockedValue(true)).toBe(true);
    expect(isLockedValue("true")).toBe(true);
  });

  it("treats false, 'false', absent, null, and anything else as not locked", () => {
    expect(isLockedValue(false)).toBe(false);
    expect(isLockedValue("false")).toBe(false);
    expect(isLockedValue(undefined)).toBe(false);
    expect(isLockedValue(null)).toBe(false);
    expect(isLockedValue(1)).toBe(false);
    expect(isLockedValue("yes")).toBe(false);
    expect(isLockedValue("")).toBe(false);
  });
});
