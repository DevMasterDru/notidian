/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render coverage for the mk-space-header property fold's
// labeling + visual distinction from the adjacent mk-space-note-header chevron
// (Notidian-ul4t, ratified via Notidian-4qjx.12).
//
// Bug this guards against: the owner clicked this property-fold chevron
// (mk-space-header > mk-props-contexts > .mk-fold .mk-collapse) expecting it
// to collapse the folder-note body. It does not — it folds ONLY the space's
// property/context row (banner/tags/spaces list). The adjacent
// mk-space-note-header chevron (see SpaceNoteBody.dom.test.tsx) is the one
// that collapses the note body. The two controls render the same icon and
// sit close together, so they were mistaken for one another.
//
// Ratified scope (owner ruling, ADR gate Notidian-4qjx.12): RETAIN both
// capabilities; label + visually distinguish ONLY — no behavior change. This
// test locks down:
//   - the fold's CollapseToggle exposes aria-label/title "Hide Properties"
//   - it carries a distinguishing class (mk-collapse-properties) not shared
//     with the note-body chevron's class (mk-collapse-note)
//   - clicking it still toggles the property/context row exactly as before
//
// Heavy leaf dependencies (PropertiesView, PathCrumb, DataPropertyView, menu
// builders, superstate write utils) are mocked to inert stubs — same "mock the
// heavy leaf" approach as SpaceNoteBody.dom.test.tsx and
// SpaceTreeItem.dragFilterGuard.dom.test.tsx — so the test exercises the real
// HeaderPropertiesView fold/collapse wiring without mounting the full property
// editing surface. SpaceContext/PathContext are replaced with fresh, real
// React contexts to sever their heavy import graph (PathContext transitively
// imports shared/utils/uuid.js, an ESM .js helper ts-jest cannot parse — same
// root cause documented in SpaceNoteBody.dom.test.tsx).
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("makemd-core", () => ({}));

jest.mock("core/react/context/SpaceContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpaceContext: require("react").createContext(null),
}));
jest.mock("core/react/context/PathContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PathContext: require("react").createContext(null),
}));

jest.mock("core/react/components/Explorer/PropertiesView", () => ({
  PropertiesView: () => <div data-testid="properties-view" />,
}));
jest.mock("core/react/components/UI/Crumbs/PathCrumb", () => ({
  PathCrumb: () => <div data-testid="path-crumb" />,
}));
jest.mock(
  "core/react/components/SpaceView/Contexts/DataTypeView/DataPropertyView",
  () => ({
    DataPropertyView: () => <div data-testid="data-property-view" />,
  })
);
jest.mock(
  "core/react/components/UI/Menus/contexts/newSpacePropertyMenu",
  () => ({
    showNewPropertyMenu: jest.fn(),
  })
);
jest.mock("core/react/components/UI/Menus/contexts/spacePropertyMenu", () => ({
  showPropertyMenu: jest.fn(),
}));
jest.mock("core/react/components/UI/Menus/properties/selectSpaceMenu", () => ({
  showSpacesMenu: jest.fn(),
}));
jest.mock("core/react/components/UI/Menus/menu/SelectionMenu", () => ({
  defaultMenu: jest.fn(),
}));
jest.mock("core/react/components/UI/Modals/InputModal", () => ({
  InputModal: (): null => null,
}));
jest.mock("core/superstate/utils/spaces", () => ({
  createSpace: jest.fn(),
  saveNewProperty: jest.fn(),
  saveProperties: jest.fn(),
}));
jest.mock("core/superstate/utils/tags", () => ({
  addTagToPath: jest.fn(),
}));
// HeaderPropertiesView only imports TableView for the CellEditMode enum (used
// as a prop value passed to the already-mocked DataPropertyView). The real
// TableView.tsx transitively imports ContextEditorContext.tsx ->
// core/react/components/UI/Menus/menu/concerns/matchers.js, an ESM .js helper
// ts-jest cannot parse (same class of issue as PathContext -> uuid.js,
// documented in SpaceNoteBody.dom.test.tsx) — stub the enum directly instead
// of loading the real, unrelated 4000+ line table module.
jest.mock("core/react/components/SpaceView/Contexts/TableView/TableView", () => ({
  CellEditMode: {
    EditModeReadOnly: 0,
    EditModeNone: 1,
    EditModeView: 2,
    EditModeValueOnly: 3,
    EditModeActive: 4,
    EditModeAlways: 5,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");

import { HeaderPropertiesView } from "./HeaderPropertiesView";

// --- Scaffolding ------------------------------------------------------------

const makeSuperstate = (inlineContextExpanded = false) =>
  ({
    settings: {
      inlineContextExpanded,
      inlineContextProperties: true,
      fmKeyBanner: "banner",
      fmKeySticker: "sticker",
      fmKeyColor: "color",
      fmKeyBannerOffset: "bannerOffset",
      fmKeyAlias: "alias",
    },
    saveSettings: jest.fn(),
    // Always returns an array — HeaderPropertiesView spreads this directly
    // (`...spacesMap.get(path)`), so an undefined return would throw.
    spacesMap: { get: jest.fn((): any[] => []) },
    spacesIndex: { get: jest.fn((): any => undefined) },
    pathsIndex: { get: jest.fn((): any => undefined) },
    eventsDispatcher: { addListener: jest.fn(), removeListener: jest.fn() },
    ui: { getSticker: jest.fn((): string => "") },
    spaceManager: {
      readTable: jest.fn(
        async (): Promise<{ schema: any; cols: any[]; rows: any[] }> => ({
          schema: {},
          cols: [],
          rows: [],
        })
      ),
    },
  } as any);

const makePathState = () =>
  ({
    path: "Projects/Atlas",
    parent: "Projects",
    type: "space",
    liveSpaces: [],
    metadata: { tags: [], property: {} },
  } as any);

let container: HTMLDivElement;
let root: Root;

const render = async (superstate: any) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider value={{ spaceState: null }}>
        <PathContext.Provider
          value={{
            pathState: makePathState(),
            readMode: false,
            addToSpace: jest.fn(),
            removeFromSpace: jest.fn(),
          }}
        >
          <HeaderPropertiesView superstate={superstate} collapseSpaces={true} />
        </PathContext.Provider>
      </SpaceContext.Provider>
    );
  });
  // Flush the mount-time reloadProperties effect and the startTransition wrap
  // around the collapse toggle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// --- Tests -------------------------------------------------------------

describe("mk-space-header property fold — label + visual distinction (Notidian-ul4t)", () => {
  it("labels the fold chevron 'Hide Properties' via aria-label and title", async () => {
    await render(makeSuperstate());
    const chevron = container.querySelector(
      ".mk-props-contexts .mk-fold .mk-collapse"
    );
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute("aria-label")).toBe("Hide Properties");
    expect(chevron!.getAttribute("title")).toBe("Hide Properties");
  });

  it("carries a distinguishing class not shared with the note-body chevron", async () => {
    await render(makeSuperstate());
    const chevron = container.querySelector(
      ".mk-props-contexts .mk-fold .mk-collapse"
    );
    expect(chevron).not.toBeNull();
    expect(chevron!.classList.contains("mk-collapse-properties")).toBe(true);
    expect(chevron!.classList.contains("mk-collapse-note")).toBe(false);
  });

  it("clicking the chevron still toggles the property/context row (no behavior change)", async () => {
    await render(makeSuperstate(false));
    const chevron = container.querySelector(
      ".mk-props-contexts .mk-fold .mk-collapse"
    ) as HTMLButtonElement;

    // Default collapsed (inlineContextExpanded falsy): the property row region
    // is not rendered and the chevron carries mk-collapsed.
    expect(chevron.classList.contains("mk-collapsed")).toBe(true);
    expect(container.querySelector(".mk-header-space")).toBeNull();

    await act(async () => {
      chevron.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(chevron.classList.contains("mk-collapsed")).toBe(false);
    expect(container.querySelector(".mk-header-space")).not.toBeNull();
  });
});
