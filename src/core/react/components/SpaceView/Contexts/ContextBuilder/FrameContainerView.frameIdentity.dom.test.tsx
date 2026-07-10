/**
 * @jest-environment jsdom
 */
// bd Notidian-pg6g (milestone-gate regression on Notidian-214 / ADR 0022 2c).
//
// WHY THIS TEST EXISTS: the frame TRUST identity (frameId) that keys the
// per-frame $api-withheld notice AND the per-frame bless consent is derived in
// FrameInstanceContext from FrameRootContext.path. The EDITOR branch of
// FrameContainerView (editMode >= Page, non-$kit — i.e. EVERY editable space's
// main frame, plus editable listGroup/listItem sections) mounted NO
// FrameRootContext at all, so every editable space collapsed to the shared "?"
// fallback identity: cross-space notice de-dup, one shared bless registry key,
// and a single-pending auto-bless that could stamp a frame the user never
// reviewed (the confused deputy ADR 0022 2c rules out).
//
// This pins the derivation seam the frameTrustSession unit tests cannot see:
//   1. the editor (Page) branch now provides the REAL frame identity
//      (uri.fullPath) via FrameRootContext — same identity the read path gets;
//   2. FrameInstanceProvider mounted under it derives that identity;
//   3. the no-FrameRootContext mount derives NULL — never the aliasing "?";
//   4. the non-editor ($kit / Read) branch keeps its FrameRootProvider identity.
import React, { useContext } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { Superstate } from "makemd-core";
import { FrameEditorMode } from "shared/types/frameExec";
import { parseURI } from "shared/utils/uri";
import { DEFAULT_SETTINGS } from "core/schemas/settings";
import { FrameRootContext } from "core/react/context/FrameRootContext";
import {
  FrameInstanceContext,
  FrameInstanceProvider,
} from "core/react/context/FrameInstanceContext";
import { resetFrameTrustSession } from "core/utils/frames/frameTrustSession";
import { FrameContainerView } from "./FrameContainerView";

// React 18 act() environment flag.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// shared/utils/uuid is an untransformed ESM .js file ts-jest cannot parse
// (same workaround as the other .dom.test.tsx suites' module mocks).
jest.mock("shared/utils/uuid", () => ({ genId: () => "test-uid" }));

const makeSuperstate = () =>
  ({
    settings: { ...DEFAULT_SETTINGS },
    spaceManager: {
      uriByString: (s: string) => parseURI(s),
      readFrame: jest.fn(async (): Promise<null> => null),
    },
    eventsDispatcher: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    ui: {
      getScreenType: () => "desktop",
      notify: jest.fn(),
    },
    kitFrames: new Map(),
  } as unknown as Superstate);

// Probes ---------------------------------------------------------------------

let capturedRootPath: string | null | undefined;
const RootPathProbe = (): null => {
  const { path } = useContext(FrameRootContext);
  capturedRootPath = path;
  return null;
};

let capturedFrameId: string | null | undefined;
const FrameIdProbe = (): null => {
  const { frameId } = useContext(FrameInstanceContext);
  capturedFrameId = frameId;
  return null;
};

// Harness ----------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetFrameTrustSession();
  capturedRootPath = undefined;
  capturedFrameId = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (el: React.ReactElement) => act(() => root.render(el));

// Tests ------------------------------------------------------------------------

describe("FrameContainerView editor (Page) branch — the editable space main frame path", () => {
  const uri = parseURI("spaces://vault/Projects#*main");

  it("provides the REAL frame identity (uri.fullPath) via FrameRootContext, not the default null", () => {
    const superstate = makeSuperstate();
    render(
      <FrameContainerView
        superstate={superstate}
        uri={uri}
        cols={[]}
        editMode={FrameEditorMode.Page}
      >
        <RootPathProbe />
      </FrameContainerView>
    );
    expect(capturedRootPath).toBe("spaces://vault/Projects#*main");
  });

  it("FrameInstanceProvider under the editor branch derives that identity as its frameId", () => {
    const superstate = makeSuperstate();
    render(
      <FrameContainerView
        superstate={superstate}
        uri={uri}
        cols={[]}
        editMode={FrameEditorMode.Page}
      >
        <FrameInstanceProvider id={""} superstate={superstate} editable={true}>
          <FrameIdProbe />
        </FrameInstanceProvider>
      </FrameContainerView>
    );
    expect(capturedFrameId).toBe("spaces://vault/Projects#*main");
  });

  it("TWO different spaces' editable main frames derive DISTINCT identities (the aliasing regression)", () => {
    const superstate = makeSuperstate();
    const seen: (string | null)[] = [];
    const Collector = (): null => {
      const { frameId } = useContext(FrameInstanceContext);
      seen.push(frameId);
      return null;
    };
    const uriA = parseURI("spaces://vault/Space A#*main");
    const uriB = parseURI("spaces://vault/Space B#*main");
    render(
      <>
        <FrameContainerView
          superstate={superstate}
          uri={uriA}
          cols={[]}
          editMode={FrameEditorMode.Page}
        >
          <FrameInstanceProvider id={""} superstate={superstate} editable={true}>
            <Collector />
          </FrameInstanceProvider>
        </FrameContainerView>
        <FrameContainerView
          superstate={superstate}
          uri={uriB}
          cols={[]}
          editMode={FrameEditorMode.Page}
        >
          <FrameInstanceProvider id={""} superstate={superstate} editable={true}>
            <Collector />
          </FrameInstanceProvider>
        </FrameContainerView>
      </>
    );
    const identities = new Set(seen);
    expect(identities.has("spaces://vault/Space A#*main")).toBe(true);
    expect(identities.has("spaces://vault/Space B#*main")).toBe(true);
    expect(identities.has("?")).toBe(false);
    expect(identities.has(null)).toBe(false);
  });
});

describe("no-FrameRootContext mount (unforeseen topology)", () => {
  it("derives frameId null — NEVER the shared '?' alias", () => {
    const superstate = makeSuperstate();
    render(
      <FrameInstanceProvider id={""} superstate={superstate} editable={false}>
        <FrameIdProbe />
      </FrameInstanceProvider>
    );
    expect(capturedFrameId).toBeNull();
  });
});

describe("non-editor branch ($kit / Read) — existing FrameRootProvider identity, pinned", () => {
  it("still provides uri.fullPath via FrameRootProvider", () => {
    const superstate = makeSuperstate();
    const kitUri = parseURI("spaces://$kit/#*noteView");
    render(
      <FrameContainerView
        superstate={superstate}
        uri={kitUri}
        cols={[]}
        editMode={FrameEditorMode.Page}
      >
        <RootPathProbe />
      </FrameContainerView>
    );
    expect(capturedRootPath).toBe("spaces://$kit/#*noteView");
  });

  it("Read mode routes through FrameRootProvider with the same identity", () => {
    const superstate = makeSuperstate();
    const uri = parseURI("spaces://vault/Projects#*main");
    render(
      <FrameContainerView
        superstate={superstate}
        uri={uri}
        cols={[]}
        editMode={FrameEditorMode.Read}
      >
        <RootPathProbe />
      </FrameContainerView>
    );
    expect(capturedRootPath).toBe("spaces://vault/Projects#*main");
  });
});
