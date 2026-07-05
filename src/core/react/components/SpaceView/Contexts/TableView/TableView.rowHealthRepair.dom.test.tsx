/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render coverage for the row-health repair menu
// (Notidian-loan.5, ADR-0057 D5 -- review round 2, units M1/M2). Mirrors
// TableView.rowDelete.dom.test.tsx's harness (same mocked contexts/children).
//
// M2: violations are ALWAYS root-frontmatter-scoped (the reconciler's own
// revalidateRow only reads root frontmatter -- see reconciler.ts), so the
// repair menu's column lookup must resolve the ROOT (table=="") column even
// when a linked context column shares the same field name -- never the
// context column, which would misroute the write into another table.
//
// M1: one-click APPLICATION for "enum"/"title-binding" is descoped to
// text-only (Wave 2, ADR-0057 D5 D5/loan.7/loan.8) -- only the ratified
// empty-encoding autofix is still a live write through the funnel.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { PathPropertyName } from "shared/types/context";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

jest.mock("core/react/context/SpaceContext", () => ({
  SpaceContext: require("react").createContext(null),
}));
jest.mock("core/react/context/PathContext", () => ({
  PathContext: require("react").createContext({ readMode: false }),
}));
jest.mock("core/react/context/ContextEditorContext", () => ({
  ContextEditorContext: require("react").createContext(null),
}));
jest.mock("makemd-core", () => ({
  SelectOptionType: require("shared/types/menu").SelectOptionType,
}));
jest.mock(
  "core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView",
  () => ({
    DataTypeView: (props: any) => (
      <span data-testid="cell">{String(props.initialValue ?? "")}</span>
    ),
  })
);
jest.mock(
  "core/react/components/SpaceView/Contexts/TableView/ColumnHeader",
  () => ({ ColumnHeader: () => <div data-testid="col-header" /> })
);
jest.mock(
  "core/react/components/SpaceView/Contexts/TableView/SpaceChart",
  () => ({ SpaceChart: () => <div data-testid="chart" /> })
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  ContextEditorContext,
} = require("core/react/context/ContextEditorContext");

import { TableView, __resetTableUndoJournalForTest } from "./TableView";

const DB_PATH = "Rows";
const HUB_PATH = "Rows/Widgets.md";
const ROW_A = "Rows/A.md";

// Two "status" columns sharing a name: a LINKED CONTEXT column (`table` !=
// "") listed FIRST, and the ROOT (frontmatter, `table` == "") column SECOND
// -- deliberately ordered so a naive `cols.find(name-only)` resolves the
// WRONG (context) one first, exactly the drift M2 guards against.
const cols = [
  {
    name: PathPropertyName,
    schemaId: "table",
    type: "fileprop",
    table: "",
    primary: "true",
  },
  { name: "status", schemaId: "ctx1", type: "text", table: "ctx1" },
  { name: "status", schemaId: "table", type: "text", table: "" },
  { name: "title", schemaId: "table", type: "text", table: "" },
] as any;

// A context-only collision fixture -- the ROOT variant is deliberately
// ABSENT, so a correct resolver must find no column at all (never the
// context one).
const colsContextOnly = [
  {
    name: PathPropertyName,
    schemaId: "table",
    type: "fileprop",
    table: "",
    primary: "true",
  },
  { name: "status", schemaId: "ctx1", type: "text", table: "ctx1" },
] as any;

const rows = [
  { _index: "0", [PathPropertyName]: ROW_A, status: "", title: "wrong-title" },
] as any[];

const predicate = {
  filters: [],
  sort: [],
  groupBy: [],
  colsOrder: [],
  colsHidden: [],
  colsSize: {},
  colsCalc: {},
  colsWrap: {},
  colsHeaderDisplay: {},
  colsDataAnchor: {},
  view: "table",
  listItem: "",
  tableDirection: "ltr",
  frozenColumnCount: 0,
} as any;

// Schema declares "status" with BOTH an empty-string policy (empty-encoding
// autofix eligible) and a non-empty enum (so the pre-fix enum branch's
// actionable one-click submenu is actually reachable, not skipped for lack
// of values).
const schemaProperty = {
  schema_type: "notidian_type_profile",
  fields: JSON.stringify({
    status: {
      kind: "text",
      empty: "empty-string",
      enum: { values: ["a", "b"], strict: true },
    },
    title: { kind: "text", title_binding: true },
  }),
};

const enumViolation = {
  field: "status",
  code: "enum",
  severity: "error",
  message: 'status: "bogus" is not a declared enum value.',
  repairTier: "one-click",
  suggestedFix: "Choose one of: a, b.",
};

const titleBindingViolation = {
  field: "title",
  code: "title-binding",
  severity: "error",
  message: 'title ("wrong-title") does not match the file title ("A").',
  repairTier: "one-click",
  suggestedFix: 'Set "title" to "A", or rename the file to "wrong-title".',
};

const emptyEncodingViolation = {
  field: "status",
  code: "empty-encoding",
  severity: "warn",
  message:
    'status: empty value is encoded as null, but the declared policy is "empty-string".',
  repairTier: "autofix",
};

const malformedRowViolation = {
  code: "malformed-row",
  severity: "error",
  message: '"A" (Rows/A.md): frontmatter is missing or failed to parse.',
  repairTier: "manual-only",
};

const applyValueEdits = jest.fn(async (writes: any[]) => ({
  ok: true,
  applied: writes.length,
  skipped: [] as any[],
  failed: [] as any[],
}));

const contextValue = {
  tableData: { schema: { id: "table" }, rows, cols },
  dbSchema: { id: "table", primary: "false" },
  contextTable: {},
  saveDB: jest.fn(),
  source: "Rows",
  selectedRows: [] as string[],
  selectRows: jest.fn(),
  sortedColumns: cols,
  filteredData: rows,
  predicate,
  savePredicate: jest.fn(),
  updateFieldValue: jest.fn(),
  updateValue: jest.fn(),
  applyValueEdits,
  applyTableEdits: jest.fn(),
  reloadContextData: jest.fn(),
  renameRowTitle: jest.fn(),
  setSearchActive: jest.fn(),
  subItemsInfo: null,
  subItemsDisplay: "nested",
  subItemsField: null,
  subItemsParentKey: null,
  collapsedSubItems: new Set<string>(),
  toggleSubItemCollapse: jest.fn(),
  subItemAddRows: null,
  subItemsTreeNodes: null,
} as any;

const openMenu = jest.fn();

const makeSuperstate = (violationsMap: Map<string, any[]>) =>
  ({
    settings: {
      contextPagination: 25,
      rowVirtualization: false,
      defaultDateFormat: "MMM dd yyyy",
      defaultTimeFormat: "h:mm a",
      enableDataHealthSurfaces: true,
    },
    ui: {
      notify: jest.fn(),
      openPath: jest.fn(),
      openModal: jest.fn(),
      openMenu,
      getSticker: () => "",
      setActivePath: jest.fn(),
      primaryInteractionType: () => 1,
      getScreenType: () => 1,
    },
    spaceManager: {
      spaceInfoForPath: jest.fn(() => ({ path: "Rows" })),
      readPath: jest.fn(async () => ""),
      writeToPath: jest.fn(async () => {}),
      deletePath: jest.fn(async () => {}),
      pathExists: jest.fn(async () => false),
    },
    onPathDeleted: jest.fn(),
    onPathCreated: jest.fn(),
    eventsDispatcher: new EventDispatcher(),
    spacesIndex: new Map([
      [DB_PATH, { space: { path: DB_PATH, notePath: HUB_PATH } }],
    ]),
    pathsIndex: new Map([[HUB_PATH, { metadata: { property: schemaProperty } }]]),
    reconciler: {
      onChange: jest.fn(() => () => {}),
      getDbViolations: jest.fn(() => violationsMap),
      getViolationCount: jest.fn(() => 0),
    },
  } as any);

let container: HTMLDivElement;
let root: Root;

const flushPromises = async (count = 5) => {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
};

const render = async (
  violationsMap: Map<string, any[]>,
  contextOverrides: Record<string, any> = {}
) => {
  const superstate = makeSuperstate(violationsMap);
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{ spaceInfo: { path: "Rows" }, spaceState: { path: "Rows" } }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider
            value={{ ...contextValue, ...contextOverrides }}
          >
            <TableView superstate={superstate} />
          </ContextEditorContext.Provider>
        </PathContext.Provider>
      </SpaceContext.Provider>
    );
  });
  await act(async () => {
    await flushPromises();
  });
  return superstate;
};

// Opens the row-health repair menu via the SAME path a user does (clicking
// the badge), and returns the constructed SelectOption[] captured off the
// mocked ui.openMenu -- never reaches into TableView internals directly.
const openHealthMenu = async (): Promise<any[]> => {
  const badge = container.querySelector(
    "button.mk-row-health-badge"
  ) as HTMLButtonElement;
  expect(badge).not.toBeNull();
  openMenu.mockClear();
  await act(async () => {
    badge.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
    await Promise.resolve();
  });
  expect(openMenu).toHaveBeenCalledTimes(1);
  return openMenu.mock.calls[0][1].options as any[];
};

const isActionable = (option: any): boolean =>
  typeof option.onClick == "function" || typeof option.onSubmenu == "function";

beforeEach(() => {
  __resetTableUndoJournalForTest();
  applyValueEdits.mockClear();
  openMenu.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetTableUndoJournalForTest();
});

describe("row-health repair menu -- root-scoped column resolution (M2)", () => {
  it("routes the empty-encoding autofix write to the ROOT column, never a same-named linked context column", async () => {
    await render(new Map([[ROW_A, [emptyEncodingViolation]]]));
    const options = await openHealthMenu();
    const actionable = options.filter(isActionable);
    expect(actionable).toHaveLength(1);

    await act(async () => {
      actionable[0].onClick();
      await flushPromises();
    });

    expect(applyValueEdits).toHaveBeenCalledTimes(1);
    const write = applyValueEdits.mock.calls[0][0][0];
    expect(write.table).toBe("");
    expect(write.columnName).toBe("status");
    expect(write.value).toBe("");
  });

  it("falls through to manual (no write, ever) when the field only matches a linked context column, never a root one", async () => {
    await render(new Map([[ROW_A, [emptyEncodingViolation]]]), {
      sortedColumns: colsContextOnly,
      tableData: { schema: { id: "table" }, rows, cols: colsContextOnly },
    });
    const options = await openHealthMenu();
    expect(options.filter(isActionable)).toHaveLength(0);
    expect(applyValueEdits).not.toHaveBeenCalled();
  });
});

describe("row-health repair menu -- one-click APPLICATION descoped to text-only (M1)", () => {
  it("enum + title-binding stay informational (no write path); empty-encoding autofix is the ONLY live write", async () => {
    await render(
      new Map([
        [ROW_A, [enumViolation, titleBindingViolation, emptyEncodingViolation]],
      ])
    );
    const options = await openHealthMenu();
    const actionable = options.filter(isActionable);
    // Exactly one actionable entry survives: the empty-encoding autofix.
    expect(actionable).toHaveLength(1);

    // The enum's declared values + the title-binding suggested-fix text
    // still surface, as plain informational (disabled) text -- never wired
    // to a write.
    const names = options.map((o) => o.name).filter((n) => typeof n == "string");
    expect(names.some((n) => n.includes("status") && n.includes("a, b"))).toBe(
      true
    );
    expect(names.some((n) => n.includes('Set "title" to "A"'))).toBe(true);

    await act(async () => {
      actionable[0].onClick();
      await flushPromises();
    });
    expect(applyValueEdits).toHaveBeenCalledTimes(1);
    expect(applyValueEdits.mock.calls[0][0][0].table).toBe("");
    expect(applyValueEdits.mock.calls[0][0][0].columnName).toBe("status");
  });
});

describe("row-health repair menu -- write-path flag guard (unit S2)", () => {
  it("never writes if the kill-switch flips off between opening the menu and clicking the (now stale) fix", async () => {
    const superstate = await render(
      new Map([[ROW_A, [emptyEncodingViolation]]])
    );
    const options = await openHealthMenu();
    const actionable = options.filter(isActionable);
    expect(actionable).toHaveLength(1);

    // The flag is turned off AFTER the menu was already constructed (e.g. a
    // stale-rendered menu still open from before the toggle) -- the write
    // path itself must refuse, defense-in-depth, regardless of whatever the
    // (now-stale) menu still displays.
    superstate.settings.enableDataHealthSurfaces = false;

    await act(async () => {
      actionable[0].onClick();
      await flushPromises();
    });

    expect(applyValueEdits).not.toHaveBeenCalled();
  });
});

describe("row-health surfaces -- runtime kill-switch reactivity (unit S2)", () => {
  it("hides the badge immediately on a settingsChanged event, without needing any unrelated re-render", async () => {
    const superstate = await render(
      new Map([[ROW_A, [emptyEncodingViolation]]])
    );
    expect(container.querySelector("button.mk-row-health-badge")).not.toBeNull();

    superstate.settings.enableDataHealthSurfaces = false;
    await act(async () => {
      await superstate.eventsDispatcher.dispatchEvent("settingsChanged", null);
      await flushPromises();
    });

    expect(container.querySelector("button.mk-row-health-badge")).toBeNull();
  });
});

describe("row-health broken-row rendering (shared MALFORMED_ROW_CODE constant)", () => {
  it("marks the row's <tr> with mk-row-broken for a malformed-row violation", async () => {
    await render(new Map([[ROW_A, [malformedRowViolation]]]));
    const tr = container.querySelector(
      `tr[data-row-id="0"]`
    ) as HTMLTableRowElement;
    expect(tr).not.toBeNull();
    expect(tr.classList.contains("mk-row-broken")).toBe(true);
  });
});
