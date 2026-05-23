# Obsidian Property Backed Contexts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Folder contexts automatically surface existing Obsidian frontmatter properties as Make.md table columns while keeping Markdown frontmatter canonical.

**Architecture:** Add a pure property-discovery utility that reads cached frontmatter from `pathsIndex`, reuse it in the existing manual "add existing frontmatter" menu, and call it from context cache parsing when a folder context still has only default columns. Existing row sync and `saveAllContextToFrontmatter` keep file-backed edits flowing through Obsidian frontmatter.

**Tech Stack:** TypeScript, Jest, ts-jest, Make.md context MDB tables, Obsidian metadata cache/frontmatter.

---

## File Structure

- Create: `jest.config.js` for focused TypeScript Jest tests.
- Modify: `src/shared/types/settings.ts` to add the feature flag.
- Modify: `src/core/schemas/settings.ts` to default the feature flag to true.
- Modify: `src/core/utils/properties/allProperties.ts` to expose reusable discovery/materialization helpers.
- Modify: `src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx` to reuse discovery helpers for manual import.
- Modify: `src/core/superstate/cacheParsers.ts` to materialize discovered columns during folder context parsing.
- Test: `src/core/utils/properties/allProperties.test.ts` for discovery behavior.
- Test: `src/core/superstate/cacheParsers.test.ts` for automatic materialization behavior.

---

### Task 1: Add Jest TypeScript Test Harness And Discovery Tests

**Files:**
- Create: `jest.config.js`
- Create: `src/core/utils/properties/allProperties.test.ts`

- [ ] **Step 1: Write the Jest config**

```js
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleDirectories: ["node_modules", "src"],
  testPathIgnorePatterns: ["/node_modules/"],
};
```

- [ ] **Step 2: Write failing tests for property discovery**

```ts
import {
  contextHasOnlyDefaultColumns,
  discoverFrontmatterPropertiesFromPathStates,
} from "./allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { MakeMDSettings } from "shared/types/settings";

const settings = {
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

const pathState = (property: Record<string, unknown>) =>
  ({
    metadata: { property },
  } as any);

describe("discoverFrontmatterPropertiesFromPathStates", () => {
  it("returns frontmatter properties as context columns in first-seen order", () => {
    const pathsIndex = new Map<string, any>([
      [
        "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
        pathState({
          record: "entity",
          status: "active",
          sort_order: 2,
          updated: "2026-03-27",
          ups: true,
        }),
      ],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md"],
      settings,
      [],
      defaultContextSchemaID
    );

    expect(result).toEqual([
      { name: "record", type: "text", value: "", schemaId: "files" },
      { name: "status", type: "text", value: "", schemaId: "files" },
      { name: "sort_order", type: "number", value: "", schemaId: "files" },
      { name: "updated", type: "date", value: "", schemaId: "files" },
      { name: "ups", type: "boolean", value: "", schemaId: "files" },
    ]);
  });

  it("excludes make metadata, aliases, tags, and existing columns", () => {
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        pathState({
          status: "active",
          aliases: ["Pump"],
          tags: ["hardware"],
          sticker: "emoji//1f331",
          banner: "cover.png",
        }),
      ],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["a.md"],
      settings,
      [{ name: "status", type: "text" } as any],
      defaultContextSchemaID
    );

    expect(result).toEqual([]);
  });
});

describe("contextHasOnlyDefaultColumns", () => {
  it("returns true for empty or default-only context columns", () => {
    expect(contextHasOnlyDefaultColumns([])).toBe(true);
    expect(contextHasOnlyDefaultColumns(defaultContextFields.rows as any)).toBe(
      true
    );
  });

  it("returns false once a user property column exists", () => {
    expect(
      contextHasOnlyDefaultColumns([
        ...(defaultContextFields.rows as any),
        { name: "status", type: "text", value: "", schemaId: "files" },
      ])
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npx jest src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: FAIL because `contextHasOnlyDefaultColumns` and `discoverFrontmatterPropertiesFromPathStates` are not exported.

---

### Task 2: Implement Frontmatter Property Discovery

**Files:**
- Modify: `src/core/utils/properties/allProperties.ts`
- Modify: `src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx`

- [ ] **Step 1: Add discovery helpers**

Implement these exports in `src/core/utils/properties/allProperties.ts`:

```ts
export const excludedFrontmatterPropertyNames = (
  settings: MakeMDSettings
): Set<string> =>
  new Set([
    ...FMMetadataKeys(settings),
    settings.fmKeyAlias,
    "tags",
  ].filter(Boolean));

export const contextHasOnlyDefaultColumns = (
  cols: Pick<SpaceProperty, "name" | "type" | "value">[] = []
): boolean => {
  if (cols.length === 0) return true;
  return cols.every((col) =>
    (defaultContextFields.rows as SpaceProperty[]).some(
      (defaultCol) =>
        defaultCol.name === col.name &&
        defaultCol.type === col.type &&
        (defaultCol.value ?? "") === (col.value ?? "")
    )
  );
};

export const discoverFrontmatterPropertiesFromPathStates = (
  pathsIndex: Map<string, Pick<PathState, "metadata">>,
  paths: string[],
  settings: MakeMDSettings,
  existingCols: Pick<SpaceProperty, "name">[] = [],
  schemaId = defaultContextSchemaID
): SpaceProperty[] => {
  const excluded = excludedFrontmatterPropertyNames(settings);
  const seen = new Set(existingCols.map((col) => col.name));
  const discovered: SpaceProperty[] = [];

  for (const path of paths) {
    const properties = pathsIndex.get(path)?.metadata?.property;
    if (!properties) continue;

    for (const key of Object.keys(properties)) {
      if (excluded.has(key) || seen.has(key)) continue;
      discovered.push({
        name: key,
        type: yamlTypeToMDBType(detectPropertyType(properties[key], key)),
        value: "",
        schemaId,
      });
      seen.add(key);
    }
  }

  return discovered;
};
```

- [ ] **Step 2: Refactor `allPropertiesForPaths`**

Make `allPropertiesForPaths` call `discoverFrontmatterPropertiesFromPathStates` and return `{ name, type }[]`.

- [ ] **Step 3: Refactor manual import menu**

Replace the local filtering/mapping in `newSpacePropertyMenu.tsx` with:

```ts
const existingProps: SpaceProperty[] =
  discoverFrontmatterPropertiesFromPathStates(
    props.superstate.pathsIndex,
    [...(props.superstate.spacesMap.getInverse(source) ?? [])],
    props.superstate.settings,
    existingCols,
    props.schemaId
  );
```

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npx jest src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: PASS.

---

### Task 3: Add Automatic Materialization Tests

**Files:**
- Create: `src/core/superstate/cacheParsers.test.ts`

- [ ] **Step 1: Write failing tests for context parsing**

```ts
import { parseContextTableToCache } from "./cacheParsers";
import { IndexMap } from "shared/types/indexMap";
import { defaultContextDBSchema } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { MakeMDSettings } from "shared/types/settings";

const settings = {
  autoImportObsidianPropertiesToContexts: true,
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

const space = {
  name: "Relays & Devices",
  path: "Relays & Devices",
  isRemote: false,
  readOnly: false,
  defPath: "Relays & Devices/.space/def.json",
  notePath: "Relays & Devices/Relays & Devices.md",
};

describe("parseContextTableToCache property materialization", () => {
  it("adds discovered frontmatter properties when folder context has only default columns", () => {
    const result = parseContextTableToCache(
      space,
      {
        files: {
          schema: defaultContextDBSchema,
          cols: defaultContextFields.rows as any,
          rows: [{ File: "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md" }],
        },
      },
      ["Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md"],
      true,
      new Map<string, any>([
        ["Relays & Devices", { path: "Relays & Devices", type: "space" }],
        [
          "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
          {
            path: "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
            metadata: {
              property: {
                status: "active",
                area: "Veg",
                address: 2,
                ups: true,
              },
            },
          },
        ],
      ]),
      new IndexMap(),
      null as any,
      settings,
      new Map(),
      { calculate: false }
    );

    expect(result.changed).toBe(true);
    expect(result.cache.contextTable.cols.map((col) => col.name)).toEqual([
      "File",
      "Created",
      "status",
      "area",
      "address",
      "ups",
    ]);
    expect(result.cache.contextTable.rows[0]).toMatchObject({
      File: "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
      status: "active",
      area: "Veg",
      address: "2",
      ups: "true",
    });
  });

  it("does not add discovered properties when context already has a user column", () => {
    const result = parseContextTableToCache(
      space,
      {
        files: {
          schema: defaultContextDBSchema,
          cols: [
            ...(defaultContextFields.rows as any),
            { name: "manual", type: "text", value: "", schemaId: "files" },
          ],
          rows: [{ File: "a.md" }],
        },
      },
      ["a.md"],
      true,
      new Map<string, any>([
        ["Relays & Devices", { path: "Relays & Devices", type: "space" }],
        ["a.md", { path: "a.md", metadata: { property: { status: "active" } } }],
      ]),
      new IndexMap(),
      null as any,
      settings,
      new Map(),
      { calculate: false }
    );

    expect(result.cache.contextTable.cols.map((col) => col.name)).toEqual([
      "File",
      "Created",
      "manual",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npx jest src/core/superstate/cacheParsers.test.ts --runInBand`

Expected: FAIL because `parseContextTableToCache` does not materialize discovered columns.

---

### Task 4: Implement Automatic Materialization In Context Parsing

**Files:**
- Modify: `src/core/superstate/cacheParsers.ts`
- Modify: `src/shared/types/settings.ts`
- Modify: `src/core/schemas/settings.ts`

- [ ] **Step 1: Add setting type and default**

Add to `MakeMDSettings`:

```ts
autoImportObsidianPropertiesToContexts: boolean;
```

Add to `DEFAULT_SETTINGS`:

```ts
autoImportObsidianPropertiesToContexts: true,
```

- [ ] **Step 2: Import discovery helpers**

In `cacheParsers.ts`, import:

```ts
import {
  contextHasOnlyDefaultColumns,
  discoverFrontmatterPropertiesFromPathStates,
} from "core/utils/properties/allProperties";
```

- [ ] **Step 3: Materialize columns before row sync**

Inside `parseContextTableToCache`, derive a source context table:

```ts
const sourceContextTable = mdb[defaultContextSchemaID] ?? {
  schema: defaultContextDBSchema,
  cols: defaultContextFields.rows as SpaceProperty[],
  rows: [],
};
const shouldAutoImportProperties =
  settings.autoImportObsidianPropertiesToContexts !== false &&
  !space.path.startsWith("spaces://") &&
  contextHasOnlyDefaultColumns(sourceContextTable.cols);
const discoveredCols = shouldAutoImportProperties
  ? discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      paths,
      settings,
      sourceContextTable.cols,
      defaultContextSchemaID
    )
  : [];
const materializedContextTable =
  discoveredCols.length > 0
    ? {
        ...sourceContextTable,
        cols: [...sourceContextTable.cols, ...discoveredCols],
      }
    : sourceContextTable;
```

Use `materializedContextTable.cols`, `.schema`, and `.rows` for the rest of parsing.

- [ ] **Step 4: Fix changed detection**

Compute `changed` before assigning back to `mdb[defaultContextSchemaID]`:

```ts
const changed = !_.isEqual(contextTable, mdb[defaultContextSchemaID]);
mdb[defaultContextSchemaID] = contextTable;
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
npx jest src/core/utils/properties/allProperties.test.ts src/core/superstate/cacheParsers.test.ts --runInBand
```

Expected: PASS.

---

### Task 5: Verify And Commit Implementation

**Files:**
- All changed implementation and test files.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npx jest src/core/utils/properties/allProperties.test.ts src/core/superstate/cacheParsers.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run available broader tests**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS once new tests exist.

- [ ] **Step 3: Run TypeScript check and record baseline if unrelated failure remains**

Run:

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: May fail on existing `src/adapters/text/textCacher.ts` ES target mismatch. If it does, document as baseline unless touched by this feature.

- [ ] **Step 4: Commit implementation**

```bash
git add jest.config.js src/shared/types/settings.ts src/core/schemas/settings.ts src/core/utils/properties/allProperties.ts src/core/utils/properties/allProperties.test.ts src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx src/core/superstate/cacheParsers.ts src/core/superstate/cacheParsers.test.ts
git commit -m "feat: materialize frontmatter properties in contexts"
```

Expected: commit succeeds.
