import { SpaceTableColumn } from "shared/types/mdb";
import {
  applyPropertyVisibilityDrag,
  hideAllProperties,
  isPinnedPropertyColumn,
  propertyVisibilityKey,
  showAllProperties,
  splitPropertyVisibilityGroups,
  togglePropertyVisibility,
} from "./propertyVisibility";

const col = (
  name: string,
  options?: Partial<SpaceTableColumn>
): SpaceTableColumn => ({
  name,
  type: "text",
  table: "",
  schemaId: "files",
  ...options,
});

const file = col("File", { type: "file", primary: "true" });
const status = col("Status");
const priority = col("Priority");
const due = col("Due");
const cols = [file, status, priority, due];

describe("propertyVisibilityKey", () => {
  it("keys entries by name + table to match predicate state", () => {
    expect(propertyVisibilityKey(col("Status"))).toBe("Status");
    expect(propertyVisibilityKey(col("Status", { table: "tasks" }))).toBe(
      "Statustasks"
    );
  });
});

describe("splitPropertyVisibilityGroups", () => {
  it("pins primary columns and splits the rest by colsHidden", () => {
    const groups = splitPropertyVisibilityGroups(
      cols,
      ["File", "Status", "Priority", "Due"],
      ["Priority"]
    );
    expect(groups.pinned.map((f) => f.name)).toEqual(["File"]);
    expect(groups.shown.map((f) => f.name)).toEqual(["Status", "Due"]);
    expect(groups.hidden.map((f) => f.name)).toEqual(["Priority"]);
  });

  it("orders the shown group by colsOrder like the live table", () => {
    const groups = splitPropertyVisibilityGroups(
      cols,
      ["File", "Due", "Priority", "Status"],
      []
    );
    expect(groups.shown.map((f) => f.name)).toEqual([
      "Due",
      "Priority",
      "Status",
    ]);
  });

  it("keeps a primary column pinned even when colsHidden lists it", () => {
    const groups = splitPropertyVisibilityGroups(cols, [], ["File", "Due"]);
    expect(groups.pinned.map((f) => f.name)).toEqual(["File"]);
    expect(groups.hidden.map((f) => f.name)).toEqual(["Due"]);
  });

  it("tolerates missing colsOrder and colsHidden", () => {
    const groups = splitPropertyVisibilityGroups(cols, undefined, undefined);
    expect(groups.shown.map((f) => f.name)).toEqual([
      "Status",
      "Priority",
      "Due",
    ]);
    expect(groups.hidden).toEqual([]);
  });
});

describe("togglePropertyVisibility", () => {
  it("adds the key once when hiding", () => {
    expect(togglePropertyVisibility(status, true, ["Status", "Due"])).toEqual([
      "Due",
      "Status",
    ]);
  });

  it("removes the key when showing", () => {
    expect(togglePropertyVisibility(status, false, ["Status", "Due"])).toEqual([
      "Due",
    ]);
  });

  it("never hides a pinned primary column", () => {
    expect(togglePropertyVisibility(file, true, [])).toEqual([]);
  });
});

describe("showAllProperties / hideAllProperties", () => {
  it("show all clears only keys belonging to the panel's columns", () => {
    expect(
      showAllProperties(cols, ["Status", "Due", "Legacyother"])
    ).toEqual(["Legacyother"]);
  });

  it("hide all hides every column except pinned primaries, without duplicates", () => {
    expect(hideAllProperties(cols, ["Due", "Legacyother"])).toEqual([
      "Legacyother",
      "Status",
      "Priority",
      "Due",
    ]);
  });
});

describe("applyPropertyVisibilityDrag", () => {
  const order = ["File", "Status", "Priority", "Due"];

  it("reorders within the shown group through colsOrder", () => {
    expect(
      applyPropertyVisibilityDrag(cols, order, [], {
        activeKey: "Due",
        overKey: "Status",
        targetGroup: "shown",
      })
    ).toEqual({ colsOrder: ["File", "Due", "Status", "Priority"] });
  });

  it("hides a shown column dropped on the hidden group", () => {
    expect(
      applyPropertyVisibilityDrag(cols, order, [], {
        activeKey: "Status",
        targetGroup: "hidden",
      })
    ).toEqual({ colsHidden: ["Status"] });
  });

  it("shows a hidden column dropped on the shown group at the target position", () => {
    expect(
      applyPropertyVisibilityDrag(cols, order, ["Due"], {
        activeKey: "Due",
        overKey: "Status",
        targetGroup: "shown",
      })
    ).toEqual({
      colsHidden: [],
      colsOrder: ["File", "Due", "Status", "Priority"],
    });
  });

  it("shows a hidden column dropped on an empty shown container without reordering", () => {
    expect(
      applyPropertyVisibilityDrag(cols, order, ["Due"], {
        activeKey: "Due",
        targetGroup: "shown",
      })
    ).toEqual({ colsHidden: [] });
  });

  it("appends a key missing from colsOrder before reordering", () => {
    expect(
      applyPropertyVisibilityDrag(cols, ["File", "Status"], [], {
        activeKey: "Due",
        overKey: "Status",
        targetGroup: "shown",
      })
    ).toEqual({ colsOrder: ["File", "Due", "Status"] });
  });

  it("ignores drags of pinned or unknown columns and no-op drops", () => {
    expect(
      applyPropertyVisibilityDrag(cols, order, [], {
        activeKey: "File",
        overKey: "Status",
        targetGroup: "shown",
      })
    ).toBeNull();
    expect(
      applyPropertyVisibilityDrag(cols, order, [], {
        activeKey: "Ghost",
        targetGroup: "hidden",
      })
    ).toBeNull();
    expect(
      applyPropertyVisibilityDrag(cols, order, ["Due"], {
        activeKey: "Due",
        targetGroup: "hidden",
      })
    ).toBeNull();
    expect(
      applyPropertyVisibilityDrag(cols, order, [], {
        activeKey: "Status",
        overKey: "Status",
        targetGroup: "shown",
      })
    ).toBeNull();
  });
});

describe("isPinnedPropertyColumn", () => {
  it("treats only primary == 'true' as pinned", () => {
    expect(isPinnedPropertyColumn(file)).toBe(true);
    expect(isPinnedPropertyColumn(status)).toBe(false);
    expect(isPinnedPropertyColumn(col("X", { primary: "false" }))).toBe(false);
  });
});
