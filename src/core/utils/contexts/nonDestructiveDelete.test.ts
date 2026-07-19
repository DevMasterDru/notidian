// Adversarial unit net for requestRowDeleteWithSubItems (Notidian-vh9t).
//
// nonDestructiveDelete.ts is the ADR 0050 / Notidian-5ond.8 parent-delete
// decision shared by rowContextMenu + pathContextMenu — the single most
// data-loss-critical surface in the sub-items engine: it decides whether
// deleting a parent row SILENTLY destroys child .md files. The menu dom test
// (rowContextMenu.anchor.dom.test.tsx) already covers the two SURFACE-AUTHORITY
// branches (primary file-delete vs non-primary un-list); this suite targets the
// uncovered DECISION-MATRIX edges, all documented past data-loss footguns from
// the 5ond.8 review:
//
//   (1) LEAF row (empty subtree)          -> immediate deleteSelf(), modal NEVER
//   (2) subItemsDelete undefined          -> silent deleteSelf, no modal
//   (3) empty rootPath                     -> silent delete guard (subtree=[])
//   (4) recursive ORDERING                 -> deleteSelf resolves BEFORE any
//                                             descendant removal (the MDB
//                                             re-index footgun — assert call
//                                             ORDER, not just the set)
//   (5) non-primary, removeFromSurface ABSENT -> no-op fallback, NEVER escalates
//                                                to a higher authority (deletePath)
//   (6) deleteOnly / promote-children      -> only deleteSelf, zero descendant
//                                             removal
//
// Pure + offline + jsdom-free: the real subtreePathsFromTree runs over REAL
// buildRowTree fixtures, and the captured modal element's deleteOnly /
// deleteRecursive props are invoked DIRECTLY (no render) via a capturing
// openModal spy. Only deletePath is mocked (its real module pulls a heavy
// transitive graph ts-jest cannot parse here); the decision helper and the tree
// utilities are kept REAL so the actual branch logic is exercised.

import React from "react";
import { buildRowTree, RowTreeNode } from "core/utils/contexts/tableRowTree";
import { PathPropertyName } from "shared/types/context";

// Superstate is a type-only import in the SUT, but isolatedModules makes ts-jest
// emit a runtime require — stub the heavy module so the graph stays isolated.
jest.mock("makemd-core", () => ({}));
// Mock ONLY deletePath (the higher-authority, file-destroying sink). If the SUT
// ever escalates a non-primary descendant removal to it, these spies catch it.
jest.mock("core/superstate/utils/path", () => ({
  deletePath: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deletePath } = require("core/superstate/utils/path");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  requestRowDeleteWithSubItems,
} = require("core/utils/contexts/nonDestructiveDelete");

// Tree fixture (real buildRowTree output): P > C1 > G ; P > C2 ; and a leaf L.
// Depth-first emit order beneath P is therefore [C1, G, C2] — the order the
// recursive branch must remove descendants in, and the count (3) the modal
// shows. Paths use PathPropertyName ("File"); parent links are wikilinks the
// real parseRelationLinks resolves with the identity resolver ([[P]] -> "P").
const ROWS = [
  { File: "P", parent: "" },
  { File: "C1", parent: "[[P]]" },
  { File: "G", parent: "[[C1]]" },
  { File: "C2", parent: "[[P]]" },
  { File: "L", parent: "" },
];

const buildTree = (): RowTreeNode[] =>
  buildRowTree({ rows: ROWS, parentKey: "parent", pathKey: "File" });

// A capturing openModal spy: records (title, element, win) and DOES NOT render.
// The element is a React.createElement(SubItemDeleteModal, props); we reach its
// props directly to invoke deleteOnly / deleteRecursive — no jsdom needed.
type ModalCapture = { title: string; element: any; win: unknown };
const makeSuperstate = (captures: ModalCapture[]): any => ({
  ui: {
    openModal: (title: string, element: any, win: unknown) => {
      captures.push({ title, element, win });
      return { update: () => {}, hide: () => {} };
    },
  },
});

const modalProps = (capture: ModalCapture) => capture.element.props;

beforeEach(() => {
  (deletePath as jest.Mock).mockReset();
});

describe("requestRowDeleteWithSubItems — silent-vs-prompt decision (Notidian-vh9t)", () => {
  it("contains a leaf rejection and reports it exactly once", async () => {
    const captures: ModalCapture[] = [];
    const reportError = jest.fn();
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "L",
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf: jest.fn().mockRejectedValue(new Error("leaf locked")),
      reportError,
      win: {} as Window,
    });

    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toContain("L");
    expect(reportError.mock.calls[0][0]).toContain("leaf locked");
    expect(captures).toHaveLength(0);
  });

  it("(1) LEAF row (empty subtree) deletes immediately — openModal is NEVER called", () => {
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn();
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "L", // a real leaf in the tree
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf,
      win: {} as Window,
    });
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    expect(captures).toHaveLength(0); // no prompt for a childless row (no regression)
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("(1b) a path NOT present in the tree is treated as a leaf — silent, no modal", () => {
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn();
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "Nonexistent", // findIndex -> -1 -> subtree []
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf,
      win: {} as Window,
    });
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    expect(captures).toHaveLength(0);
  });

  it("(2) subItemsDelete undefined degrades to a silent deleteSelf — no modal", () => {
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn();
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P", // even a real parent: with config off, no subtree resolves
      subItemsDelete: undefined,
      deleteSelf,
      win: {} as Window,
    });
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    expect(captures).toHaveLength(0);
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("(3) empty rootPath short-circuits to a silent delete (guard: subtree=[])", () => {
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn();
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "", // falsy -> subtree forced to [] regardless of the tree
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf,
      win: {} as Window,
    });
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    expect(captures).toHaveLength(0);
  });

  it("a PARENT row opens the 3-way prompt instead of deleting anything", () => {
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn();
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf,
      win: {} as Window,
    });
    // Nothing deleted yet — the user must choose in the modal.
    expect(deleteSelf).not.toHaveBeenCalled();
    expect(deletePath).not.toHaveBeenCalled();
    expect(captures).toHaveLength(1);
    // The modal is given the descendant COUNT (C1, G, C2 = 3), derived from the
    // FULL tree — never a collapsed/limited projection.
    expect(modalProps(captures[0]).subItemCount).toBe(3);
  });
});

describe("requestRowDeleteWithSubItems — recursive branch (Notidian-vh9t)", () => {
  it("(4) ORDERING: deleteSelf RESOLVES before ANY descendant removal (MDB re-index footgun)", async () => {
    // The recursive branch is `await deleteSelf(); for (...) await removeDescendant`.
    // On the MDB surface deleteSelf is deleteRowInTable(index) and removing a
    // descendant FIRST re-indexes the table, so a stale parent index would then
    // nuke the WRONG row. The existing dom test asserts only the .sort()ed set;
    // here we assert the awaited ORDER. deleteSelf returns a promise that only
    // resolves on a later microtask — if the loop did not truly await it, a
    // descendant marker would land before "deleteSelf:resolved".
    const order: string[] = [];
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push("deleteSelf:called");
          // Defer resolution across a microtask hop to prove the loop waits.
          Promise.resolve()
            .then(() => Promise.resolve())
            .then(() => {
              order.push("deleteSelf:resolved");
              resolve();
            });
        })
    );
    const removeFromSurface = jest.fn(async (path: string) => {
      order.push(`remove:${path}`);
    });
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: {
        treeNodes: buildTree(),
        isPrimarySurface: false,
        removeFromSurface,
      },
      deleteSelf,
      win: {} as Window,
    });
    // Drive the recursive option directly off the captured modal element's prop.
    modalProps(captures[0]).deleteRecursive();
    // Flush the whole awaited chain (parent + 3 descendants + microtask hops).
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // deleteSelf must have fully RESOLVED before the first descendant removal.
    expect(order[0]).toBe("deleteSelf:called");
    const firstRemoveIdx = order.findIndex((o) => o.startsWith("remove:"));
    const resolvedIdx = order.indexOf("deleteSelf:resolved");
    expect(resolvedIdx).toBeGreaterThanOrEqual(0);
    expect(firstRemoveIdx).toBeGreaterThan(resolvedIdx);
    // Descendants are removed in depth-first tree order: C1, then its child G,
    // then C2 (ordering, not just the set).
    expect(order.slice(resolvedIdx + 1)).toEqual([
      "remove:C1",
      "remove:G",
      "remove:C2",
    ]);
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("(5) non-primary surface with removeFromSurface ABSENT falls back to a no-op — NEVER escalates to deletePath", async () => {
    // The 'never escalate to a higher authority for children' safety: on a
    // non-primary MDB row surface the parent is only UN-LISTED, so a missing
    // un-lister must degrade to nothing — never a file-destroying deletePath.
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn(async () => {});
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: {
        treeNodes: buildTree(),
        isPrimarySurface: false,
        // removeFromSurface intentionally ABSENT.
      },
      deleteSelf,
      win: {} as Window,
    });
    modalProps(captures[0]).deleteRecursive();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // The parent itself is still removed (un-listed) via deleteSelf...
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    // ...but NOT ONE descendant escalated to the file-delete authority.
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("recursive on the PRIMARY surface file-deletes EVERY descendant via deletePath (depth-first)", async () => {
    // The authority-matched counterpart: on the primary files schema the
    // parent's own removal IS a file delete, so descendants are file-deleted too.
    const captures: ModalCapture[] = [];
    const superstate = makeSuperstate(captures);
    const deleteSelf = jest.fn(async () => {});
    requestRowDeleteWithSubItems({
      superstate,
      rootPath: "P",
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf,
      win: {} as Window,
    });
    modalProps(captures[0]).deleteRecursive();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // deletePath(superstate, path) for each descendant, in depth-first order.
    const deletedPaths = (deletePath as jest.Mock).mock.calls.map(
      (c: any[]) => c[1]
    );
    expect(deletedPaths).toEqual(["C1", "G", "C2"]);
    // Every call targets THIS superstate (never a leaked/global one).
    for (const call of (deletePath as jest.Mock).mock.calls) {
      expect(call[0]).toBe(superstate);
    }
    expect(deleteSelf).toHaveBeenCalledTimes(1);
  });

  it("returns the recursive deletion promise to its UI owner", async () => {
    const captures: ModalCapture[] = [];
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf: jest.fn(async () => {}),
      win: {} as Window,
    });

    const deletion = modalProps(captures[0]).deleteRecursive();
    expect(deletion).toBeInstanceOf(Promise);
    await deletion;
  });

  it("attempts every recursive descendant before rejecting once with aggregate failure", async () => {
    const captures: ModalCapture[] = [];
    (deletePath as jest.Mock).mockImplementation(
      async (_superstate: unknown, path: string) => {
        if (path === "C1" || path === "C2") {
          throw new Error(`${path} locked`);
        }
      }
    );
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf: jest.fn(async () => {}),
      win: {} as Window,
    });

    await expect(modalProps(captures[0]).deleteRecursive()).rejects.toMatchObject({
      name: "AggregateError",
      errors: [
        expect.objectContaining({ message: "C1 locked" }),
        expect.objectContaining({ message: "C2 locked" }),
      ],
    });
    expect((deletePath as jest.Mock).mock.calls.map((call) => call[1])).toEqual([
      "C1",
      "G",
      "C2",
    ]);
  });

});

describe("requestRowDeleteWithSubItems — deleteOnly / promote-children (Notidian-vh9t)", () => {
  it("(6) deleteOnly removes ONLY the parent — zero descendant removal of any authority", async () => {
    // Promotion is automatic and one-way: children's parent links dangle and
    // resurface as roots next render; their files are NEVER touched, and no
    // un-list/file-delete runs for any descendant.
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn(async () => {});
    const removeFromSurface = jest.fn(async () => {});
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: {
        treeNodes: buildTree(),
        isPrimarySurface: false,
        removeFromSurface,
      },
      deleteSelf,
      win: {} as Window,
    });
    modalProps(captures[0]).deleteOnly();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    expect(removeFromSurface).not.toHaveBeenCalled(); // children promote, not removed
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("deleteOnly on the PRIMARY surface likewise file-deletes NOTHING but the parent", async () => {
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn(async () => {});
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: { treeNodes: buildTree(), isPrimarySurface: true },
      deleteSelf,
      win: {} as Window,
    });
    modalProps(captures[0]).deleteOnly();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(deleteSelf).toHaveBeenCalledTimes(1);
    expect(deletePath).not.toHaveBeenCalled();
  });
});
