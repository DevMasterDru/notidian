/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render coverage for the collapsible / shrink-to-fit space note
// body (Notidian-8sl). This is a flag-gated core render-path change: the CSS
// layout (shrink-to-fit) is the live-verify part (docs/AUTONOMOUS-REVIEW-QUEUE.md),
// but the RENDER CONTRACT around the flag is provable offline and is what these
// tests lock down:
//
//   - flag OFF (default): the rendered output is byte-identical to the legacy
//     region — a single <div class="mk-space-note"> wrapping the note, with NO
//     header, NO chevron, and NO collapsible class. This is the guarantee that
//     the owner's current vault is unchanged until the flag is enabled.
//   - flag ON, expanded: a header with a collapse chevron is added, the wrapper
//     gains mk-space-note--collapsible, and the note content is rendered.
//   - flag ON, collapsed: the note content is NOT rendered (genuine unmount),
//     the wrapper gains mk-space-note--collapsed, and the chevron reflects it.
//   - toggling the chevron persists noteBodyCollapsed via saveSpaceMetadataValue
//     against the SPACE PATH (per-space view state — ADR 0001/0014, not row data).
//
// NoteView and saveSpaceMetadataValue are mocked so the test exercises the real
// SpaceNoteBody flag/branch logic without mounting the Obsidian editor or hitting
// a real superstate write path.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { SpaceState } from "shared/types/PathState";
import { SpaceDefinition } from "shared/types/spaceDef";

// React 18 act() environment flag.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Replace SpaceContext with a fresh, real React.createContext. This severs its
// heavy implementation graph (it transitively imports PathContext ->
// shared/utils/uuid.js, an ESM .js helper the repo's ts-jest transform cannot
// parse) while still giving SpaceNoteBody a genuine context to read and the test
// a matching <Provider> to feed. jest.mock returns one stable module instance,
// so the component and the test below share the same context object. (Same
// pattern as FilterBar.anchor.dom.test.tsx.)
jest.mock("core/react/context/SpaceContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpaceContext: require("react").createContext(null),
}));
// makemd-core is imported by SpaceNoteBody only for the Superstate type; stub it
// so the test never loads its runtime graph.
jest.mock("makemd-core", () => ({}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");

// --- Mock the note editor: render a recognizable sentinel so presence/absence
//     of the actual note content is assertable without the Obsidian editor. ---
jest.mock("core/react/components/PathView/NoteView", () => ({
  NoteView: (props: any) => (
    <div data-testid="note-view" data-path={props.path}>
      note-content
    </div>
  ),
}));

// --- Mock the persistence verb to capture what view state is written. ---
const saveCalls: Array<{ path: string; key: string; value: unknown }> = [];
jest.mock("core/superstate/utils/spaces", () => ({
  saveSpaceMetadataValue: jest.fn(
    async (_superstate: any, path: string, key: string, value: unknown) => {
      saveCalls.push({ path, key, value });
    }
  ),
}));

import { SpaceNoteBody } from "./SpaceNoteBody";

// --- Scaffolding ------------------------------------------------------------

const makeSuperstate = (
  collapsibleNoteBody: boolean,
  // Notidian-50hn: default ON (full collapse). Existing call sites pass 1 arg
  // and get the full-collapse contract, matching the shipped default.
  spaceNoteBodyFullCollapse = true
) =>
  ({
    settings: {
      enableFolderNote: true,
      collapsibleNoteBody,
      spaceNoteBodyFullCollapse,
    },
    spaceManager: {
      pathExists: jest.fn(async () => true),
      // Non-empty body so hasBody becomes true and the region renders.
      readPath: jest.fn(async () => "# Legend\n\nsome text\n"),
    },
  } as any);

const makeSpaceState = (
  metadata: SpaceDefinition = {}
): SpaceState =>
  ({
    name: "Atlas",
    path: "Projects/Atlas",
    type: "folder",
    metadata,
    space: { notePath: "Projects/Atlas/Atlas.md" },
  } as any);

let container: HTMLDivElement;
let root: Root;

const render = async (superstate: any, spaceState: SpaceState) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{ spaceState, readMode: false, spaceInfo: null }}
      >
        <SpaceNoteBody superstate={superstate} />
      </SpaceContext.Provider>
    );
  });
  // Flush the async hasBody effect (pathExists/readPath are promises).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  saveCalls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// --- Flag OFF (default): legacy, byte-identical rendering -------------------

describe("flag OFF (default) — legacy byte-identical region (Notidian-8sl)", () => {
  it("renders exactly one .mk-space-note wrapping the note, no header/chevron/class", async () => {
    await render(makeSuperstate(false), makeSpaceState());

    const wrapper = container.querySelector(".mk-space-note");
    expect(wrapper).not.toBeNull();
    // Legacy wrapper has EXACTLY the one class — no collapsible/collapsed modifier.
    expect(wrapper!.className).toBe("mk-space-note");
    // No header and no collapse chevron in the legacy path.
    expect(container.querySelector(".mk-space-note-header")).toBeNull();
    expect(container.querySelector("button.mk-collapse")).toBeNull();
    // The note content is rendered (always, in legacy mode).
    const note = container.querySelector('[data-testid="note-view"]');
    expect(note).not.toBeNull();
    expect(note!.getAttribute("data-path")).toBe("Projects/Atlas");
  });

  it("ignores a stale persisted noteBodyCollapsed while the flag is OFF", async () => {
    // A vault that toggled collapse, then turned the feature off, must still see
    // its note body (the flag, not stale metadata, governs legacy rendering).
    await render(makeSuperstate(false), makeSpaceState({ noteBodyCollapsed: true }));
    expect(container.querySelector('[data-testid="note-view"]')).not.toBeNull();
    expect(container.querySelector(".mk-space-note-header")).toBeNull();
  });
});

// --- Flag ON: collapsible behavior -----------------------------------------

describe("flag ON — collapsible header + chevron (Notidian-8sl)", () => {
  it("expanded: adds the collapsible class, a header with chevron, and renders the note", async () => {
    await render(makeSuperstate(true), makeSpaceState());

    const wrapper = container.querySelector(".mk-space-note");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.classList.contains("mk-space-note--collapsible")).toBe(true);
    expect(wrapper!.classList.contains("mk-space-note--collapsed")).toBe(false);

    expect(container.querySelector(".mk-space-note-header")).not.toBeNull();
    const chevron = container.querySelector("button.mk-collapse");
    expect(chevron).not.toBeNull();
    // Expanded → chevron is NOT in the collapsed visual state.
    expect(chevron!.classList.contains("mk-collapsed")).toBe(false);
    // Header labels the page with the space name.
    expect(
      container.querySelector(".mk-space-note-header-label")!.textContent
    ).toBe("Atlas");
    // Note content is present when expanded.
    expect(container.querySelector('[data-testid="note-view"]')).not.toBeNull();
  });

  it("collapsed: marks the wrapper/chevron collapsed and does NOT render note content", async () => {
    await render(
      makeSuperstate(true),
      makeSpaceState({ noteBodyCollapsed: true })
    );

    const wrapper = container.querySelector(".mk-space-note");
    expect(wrapper!.classList.contains("mk-space-note--collapsed")).toBe(true);
    const chevron = container.querySelector("button.mk-collapse");
    expect(chevron!.classList.contains("mk-collapsed")).toBe(true);
    // Genuine unmount: the note editor is not in the DOM while collapsed.
    expect(container.querySelector('[data-testid="note-view"]')).toBeNull();
  });

  it("clicking the chevron persists noteBodyCollapsed against the space path", async () => {
    await render(makeSuperstate(true), makeSpaceState());

    const chevron = container.querySelector(
      "button.mk-collapse"
    ) as HTMLButtonElement;
    await act(async () => {
      chevron.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toEqual({
      path: "Projects/Atlas",
      key: "noteBodyCollapsed",
      value: true, // expanded → next state is collapsed (true)
    });
  });

  it("clicking the chevron while collapsed persists the expand (false)", async () => {
    await render(
      makeSuperstate(true),
      makeSpaceState({ noteBodyCollapsed: true })
    );

    const chevron = container.querySelector(
      "button.mk-collapse"
    ) as HTMLButtonElement;
    await act(async () => {
      chevron.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toEqual({
      path: "Projects/Atlas",
      key: "noteBodyCollapsed",
      value: false, // collapsed → next state is expanded (false)
    });
  });
});

// --- Notidian-50hn: full collapse (default) vs keep-mounted kill-switch -----

describe("full collapse — collapsing hides 100% of note text (Notidian-50hn)", () => {
  it("default (full-collapse ON) + collapsed → ZERO note-content nodes", async () => {
    // The owner directive: the collapsed database-only view must contain none of
    // the note's DOM — not merely a hidden/height-shrunk remnant.
    await render(
      makeSuperstate(true, /* spaceNoteBodyFullCollapse */ true),
      makeSpaceState({ noteBodyCollapsed: true })
    );
    expect(container.querySelector('[data-testid="note-view"]')).toBeNull();
    expect(container.querySelector(".mk-space-note-body")).toBeNull();
    // No hidden remnant either — the class is only ever emitted in the OFF path.
    expect(container.querySelector(".mk-space-note-body--hidden")).toBeNull();
    // No resize handle over a collapsed region.
    expect(container.querySelector(".mk-space-note-resize")).toBeNull();
    // The wrapper still reflects the collapsed state (chevron + persistence).
    expect(
      container
        .querySelector(".mk-space-note")!
        .classList.contains("mk-space-note--collapsed")
    ).toBe(true);
  });

  it("expand from full-collapse restores the full note content", async () => {
    await render(
      makeSuperstate(true, true),
      makeSpaceState() // expanded
    );
    const note = container.querySelector('[data-testid="note-view"]');
    expect(note).not.toBeNull();
    expect(
      container.querySelector(".mk-space-note-body [data-testid='note-view']")
    ).not.toBeNull();
    // Expanded shows the resize handle (a visible, sizable body).
    expect(container.querySelector(".mk-space-note-resize")).not.toBeNull();
    expect(container.querySelector(".mk-space-note-body--hidden")).toBeNull();
  });

  it("kill-switch (full-collapse OFF) + collapsed → body kept MOUNTED but hidden", async () => {
    // The non-destructive fallback: note nodes remain in the DOM (editor stays
    // alive) but the body carries the --hidden class so CSS removes it visually.
    await render(
      makeSuperstate(true, /* spaceNoteBodyFullCollapse */ false),
      makeSpaceState({ noteBodyCollapsed: true })
    );
    const body = container.querySelector(".mk-space-note-body");
    expect(body).not.toBeNull();
    expect(body!.classList.contains("mk-space-note-body--hidden")).toBe(true);
    // The note content is still mounted (kept alive) under the hidden body.
    expect(container.querySelector('[data-testid="note-view"]')).not.toBeNull();
    // Still no resize handle — you cannot drag a hidden body.
    expect(container.querySelector(".mk-space-note-resize")).toBeNull();
    // Wrapper is still marked collapsed.
    expect(
      container
        .querySelector(".mk-space-note")!
        .classList.contains("mk-space-note--collapsed")
    ).toBe(true);
  });

  it("kill-switch OFF + expanded is byte-identical to the default expanded body (no --hidden)", async () => {
    await render(makeSuperstate(true, false), makeSpaceState());
    const body = container.querySelector(".mk-space-note-body");
    expect(body).not.toBeNull();
    expect(body!.classList.contains("mk-space-note-body--hidden")).toBe(false);
    expect(container.querySelector('[data-testid="note-view"]')).not.toBeNull();
    expect(container.querySelector(".mk-space-note-resize")).not.toBeNull();
  });
});

// --- Notidian-ul4t: label + visual distinction from the mk-space-header ----
//     property fold (ratified via Notidian-4qjx.12). Scope is labeling +
//     visual distinction ONLY — the toggle/persistence behavior asserted above
//     (Notidian-8sl) must be unchanged; these tests only add the new
//     aria-label/title contract and a distinguishing class.

describe("note-body collapse chevron — label + visual distinction (Notidian-ul4t)", () => {
  it("labels the chevron 'Collapse Note' via aria-label and title", async () => {
    await render(makeSuperstate(true), makeSpaceState());
    const chevron = container.querySelector("button.mk-collapse");
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute("aria-label")).toBe("Collapse Note");
    expect(chevron!.getAttribute("title")).toBe("Collapse Note");
  });

  it("carries a distinguishing class not shared with the property-fold chevron", async () => {
    await render(makeSuperstate(true), makeSpaceState());
    const chevron = container.querySelector("button.mk-collapse");
    expect(chevron!.classList.contains("mk-collapse-note")).toBe(true);
    expect(chevron!.classList.contains("mk-collapse-properties")).toBe(false);
  });

  it("still toggles and persists noteBodyCollapsed after the label/class change (no behavior change)", async () => {
    await render(makeSuperstate(true), makeSpaceState());
    const chevron = container.querySelector(
      "button.mk-collapse"
    ) as HTMLButtonElement;
    await act(async () => {
      chevron.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toEqual({
      path: "Projects/Atlas",
      key: "noteBodyCollapsed",
      value: true,
    });
  });
});

// --- Flag ON: resize + scroll (Notidian-egoh) ------------------------------

describe("flag ON — resizeable + scrollable note body (Notidian-egoh)", () => {
  const pointer = (type: string, clientY: number): Event => {
    try {
      return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientY,
        button: 0,
        pointerId: 1,
      } as any);
    } catch {
      // jsdom without PointerEvent: a MouseEvent of the same type still fires
      // React's onPointer* handlers (it dispatches by native event name).
      return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientY,
        button: 0,
      } as any);
    }
  };

  it("expanded: renders the scroll body wrapper and the resize handle", async () => {
    await render(makeSuperstate(true), makeSpaceState());
    expect(container.querySelector(".mk-space-note-body")).not.toBeNull();
    const handle = container.querySelector(".mk-space-note-resize");
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute("role")).toBe("separator");
    // The note content lives inside the scroll wrapper.
    expect(
      container.querySelector(".mk-space-note-body [data-testid='note-view']")
    ).not.toBeNull();
  });

  it("flag OFF: no resize handle or scroll wrapper (legacy path untouched)", async () => {
    await render(makeSuperstate(false), makeSpaceState());
    expect(container.querySelector(".mk-space-note-resize")).toBeNull();
    expect(container.querySelector(".mk-space-note-body")).toBeNull();
  });

  it("collapsed: no resize handle (cannot resize a hidden body)", async () => {
    await render(
      makeSuperstate(true),
      makeSpaceState({ noteBodyCollapsed: true })
    );
    expect(container.querySelector(".mk-space-note-resize")).toBeNull();
    expect(container.querySelector(".mk-space-note-body")).toBeNull();
  });

  it("applies a persisted height as a fixed, scrollable inline style", async () => {
    await render(makeSuperstate(true), makeSpaceState({ noteBodyHeight: 300 }));
    const body = container.querySelector(
      ".mk-space-note-body"
    ) as HTMLDivElement;
    expect(body.style.height).toBe("300px");
    expect(body.style.overflowY).toBe("auto");
  });

  it("with no persisted height the body is auto (shrink-to-fit, no fixed height)", async () => {
    await render(makeSuperstate(true), makeSpaceState());
    const body = container.querySelector(
      ".mk-space-note-body"
    ) as HTMLDivElement;
    expect(body.style.height).toBe("");
    expect(body.style.overflowY).toBe("");
  });

  it("double-clicking the handle resets to auto (persists noteBodyHeight undefined)", async () => {
    await render(makeSuperstate(true), makeSpaceState({ noteBodyHeight: 300 }));
    const handle = container.querySelector(
      ".mk-space-note-resize"
    ) as HTMLDivElement;
    await act(async () => {
      handle.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true })
      );
    });
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toEqual({
      path: "Projects/Atlas",
      key: "noteBodyHeight",
      value: undefined,
    });
  });

  it("dragging the handle persists a clamped numeric height against the space path", async () => {
    await render(makeSuperstate(true), makeSpaceState());
    const handle = container.querySelector(
      ".mk-space-note-resize"
    ) as HTMLDivElement;
    // offsetHeight is 0 in jsdom -> clamp(0) = MIN (60); +80px drag -> 140.
    await act(async () => {
      handle.dispatchEvent(pointer("pointerdown", 100));
      handle.dispatchEvent(pointer("pointermove", 180));
      handle.dispatchEvent(pointer("pointerup", 180));
    });
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].path).toBe("Projects/Atlas");
    expect(saveCalls[0].key).toBe("noteBodyHeight");
    expect(saveCalls[0].value).toBe(140);
  });
});
