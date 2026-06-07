# Notidian Database Embeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build first-class live Notidian database embeds for Markdown pages and Obsidian Canvas while preserving Markdown/frontmatter as canonical row data.

**Architecture:** Add a pure `NotidianEmbedDescriptor` model first, then route Markdown blocks, legacy fragment links, menu actions, and Canvas wrapper nodes through that shared descriptor. Rendering goes through one `NotidianEmbed` React component that reuses the existing `SpaceFragmentViewComponent`/table stack instead of forking database behavior.

**Tech Stack:** TypeScript, React 18, Obsidian plugin APIs, JSON Canvas, Jest/ts-jest, existing Notidian `SpaceManager`/`Superstate` APIs.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-06-07-notidian-database-embeds-design.md`
- Current architecture: `docs/current-state.md`
- Governing ADR: `docs/adr/0014-notidian-only-personal-database-engine.md`
- Practical table behavior: `docs/table-database-workflows.md`

## File Structure

Create:

- `src/core/utils/embeds/notidianEmbed.ts`
  - Owns `NotidianEmbedDescriptor`, block parsing, legacy ref parsing, normalization, serialization, and descriptor-to-fragment conversion.
- `src/core/utils/embeds/notidianEmbed.test.ts`
  - Unit tests for descriptor parsing, validation, serialization, and legacy compatibility.
- `src/core/utils/embeds/notidianCanvasEmbed.ts`
  - Pure JSON Canvas and wrapper-note helpers: safe wrapper path, wrapper Markdown content, node id generation boundary, and canvas node insertion.
- `src/core/utils/embeds/notidianCanvasEmbed.test.ts`
  - Unit tests for wrapper paths, wrapper content, node insertion, id uniqueness, and layout.
- `src/core/react/components/NotidianEmbed/NotidianEmbed.tsx`
  - Shared React renderer for valid descriptors and inline errors.
- `src/core/react/components/NotidianEmbed/NotidianEmbed.test.tsx`
  - Server-rendered component tests for error, sizing, and read-only option propagation.
- `src/core/react/components/NotidianEmbed/NotidianEmbedPickerModal.tsx`
  - Minimal picker for command-palette insertion when the current surface does not already identify a table/view.
- `src/adapters/obsidian/utils/notidianMarkdownEmbed.tsx`
  - Obsidian Markdown code block processor and lifecycle-managed React mount.
- `src/adapters/obsidian/utils/notidianEmbedCommands.tsx`
  - Command/menu helpers for copying blocks, inserting into the active Markdown editor, and inserting Canvas wrapper nodes.

Modify:

- `src/core/react/components/SpaceView/Editor/EmbedView/SpaceFragmentView.tsx`
  - Add `readMode?: boolean` and use it when creating `PathProvider`.
- `src/shared/utils/makemd/embed.ts`
  - Keep legacy helpers and add Notidian-native block helper wrappers.
- `src/core/react/components/SpaceEditor/SpaceListProperty.tsx`
  - Table menu copies/inserts Notidian embed blocks and retains legacy copy.
- `src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx`
  - View menu copies/inserts Notidian embed blocks and retains legacy copy.
- `src/basics/flow/markdownPost.tsx`
  - Route legacy Notidian fragments through `NotidianEmbed` instead of generic `UINote`.
- `src/main.ts`
  - Register Markdown processor and register embed commands.
- `src/commands.tsx`
  - Call the Notidian embed command registration helper.
- `src/shared/en.ts`
  - Add labels for copy/insert Notidian embed commands.
- `scripts/notidianRealVaultHarness.js`
  - Add opt-in embed smoke helpers and CLI flag.
- `scripts/notidianRealVaultHarness.test.js`
  - Cover the new harness flag and eval command sequence.
- `docs/current-state.md`
  - Document shipped embed behavior after implementation.
- `docs/table-database-workflows.md`
  - Add user workflow for page and Canvas embeds.
- `docs/notidian-system-architecture.md`
  - Add the descriptor as the durable embed projection contract.

## Implementation Rules

- Do not introduce native Obsidian Bases or `.base` artifacts.
- Do not create copied row-data snapshots as the primary embed path.
- Default every embed to read-only unless a descriptor explicitly sets `editable: true`.
- Use `apply_patch` for manual edits.
- Commit after each task if its tests pass.
- Before final completion, run:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
npm run health:audit -- --live
```

---

### Task 1: Descriptor Parser And Serializer

**Files:**
- Create: `src/core/utils/embeds/notidianEmbed.ts`
- Create: `src/core/utils/embeds/notidianEmbed.test.ts`

- [ ] **Step 1: Write the failing descriptor tests**

Create `src/core/utils/embeds/notidianEmbed.test.ts`:

```ts
import {
  descriptorToFragmentPath,
  normalizeNotidianEmbedDescriptor,
  parseLegacyNotidianEmbedRef,
  parseNotidianEmbedBlock,
  serializeNotidianEmbedBlock,
} from "./notidianEmbed";

describe("Notidian embed descriptor utilities", () => {
  it("parses a canonical fenced block body", () => {
    expect(
      parseNotidianEmbedBlock(`
target: Projects
kind: view
id: active
height: 480
title: true
editable: false
`)
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        height: 480,
        title: true,
        editable: false,
      },
    });
  });

  it("normalizes view and table aliases", () => {
    expect(
      parseNotidianEmbedBlock(`
target: Projects
view: active
`)
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
      },
    });

    expect(
      parseNotidianEmbedBlock(`
target: Projects
table: files
`)
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "table",
        id: "files",
        title: true,
        editable: false,
      },
    });
  });

  it("reports structured errors for invalid descriptors", () => {
    expect(parseNotidianEmbedBlock("view: active")).toEqual({
      ok: false,
      errors: [{ field: "target", message: "target is required" }],
    });

    expect(
      normalizeNotidianEmbedDescriptor({
        target: "Projects",
        kind: "board",
        id: "active",
      } as any)
    ).toEqual({
      ok: false,
      errors: [{ field: "kind", message: "kind must be table or view" }],
    });
  });

  it("parses legacy table and view fragment refs", () => {
    expect(parseLegacyNotidianEmbedRef("Projects/#^files")).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "table",
        id: "files",
        title: true,
        editable: false,
      },
    });

    expect(parseLegacyNotidianEmbedRef("Projects/#*active")).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
      },
    });
  });

  it("serializes descriptors to canonical notidian blocks", () => {
    expect(
      serializeNotidianEmbedBlock({
        target: "Projects",
        kind: "view",
        id: "active",
        height: 480,
        title: true,
        editable: false,
      })
    ).toBe(
      [
        "```notidian",
        "target: Projects",
        "kind: view",
        "id: active",
        "height: 480",
        "title: true",
        "editable: false",
        "```",
      ].join("\n")
    );
  });

  it("converts descriptors to legacy fragment paths for the existing renderer", () => {
    expect(
      descriptorToFragmentPath({
        target: "Projects",
        kind: "table",
        id: "files",
      })
    ).toBe("Projects/#^files");

    expect(
      descriptorToFragmentPath({
        target: "Projects",
        kind: "view",
        id: "active",
      })
    ).toBe("Projects/#*active");
  });
});
```

- [ ] **Step 2: Run the descriptor tests and verify the expected failure**

Run:

```bash
npm test -- src/core/utils/embeds/notidianEmbed.test.ts --runInBand
```

Expected: FAIL because `src/core/utils/embeds/notidianEmbed.ts` does not exist.

- [ ] **Step 3: Implement the descriptor utility**

Create `src/core/utils/embeds/notidianEmbed.ts`:

```ts
export type NotidianEmbedKind = "table" | "view";

export type NotidianEmbedDescriptor = {
  target: string;
  kind: NotidianEmbedKind;
  id: string;
  height?: number;
  title?: boolean;
  editable?: boolean;
  density?: "default" | "compact";
};

export type NotidianEmbedDescriptorInput = Partial<
  Omit<NotidianEmbedDescriptor, "kind" | "id">
> & {
  kind?: string;
  id?: string;
  view?: string;
  table?: string;
};

export type NotidianEmbedDescriptorError = {
  field: string;
  message: string;
};

export type NotidianEmbedParseResult =
  | { ok: true; descriptor: NotidianEmbedDescriptor }
  | { ok: false; errors: NotidianEmbedDescriptorError[] };

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (value.trim().toLowerCase() === "true") return true;
  if (value.trim().toLowerCase() === "false") return false;
  return undefined;
};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseScalar = (value: string): string | number | boolean => {
  const trimmed = value.trim();
  const bool = booleanValue(trimmed);
  if (bool !== undefined) return bool;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  return trimmed.replace(/^["']|["']$/g, "");
};

export const parseNotidianEmbedBlockFields = (
  source: string
): Record<string, string | number | boolean> => {
  const fields: Record<string, string | number | boolean> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    fields[key] = parseScalar(value);
  }
  return fields;
};

export const normalizeNotidianEmbedDescriptor = (
  input: NotidianEmbedDescriptorInput
): NotidianEmbedParseResult => {
  const errors: NotidianEmbedDescriptorError[] = [];
  const target = String(input.target ?? "").trim();
  const aliasKind = input.view ? "view" : input.table ? "table" : undefined;
  const kind = String(input.kind ?? aliasKind ?? "").trim();
  const id = String(input.id ?? input.view ?? input.table ?? "").trim();

  if (!target) errors.push({ field: "target", message: "target is required" });
  if (kind !== "table" && kind !== "view") {
    errors.push({ field: "kind", message: "kind must be table or view" });
  }
  if (!id) errors.push({ field: "id", message: "id is required" });

  const height = numberValue(input.height);
  if (input.height != null && height === undefined) {
    errors.push({ field: "height", message: "height must be an integer" });
  }

  const title =
    input.title == null ? true : booleanValue(input.title);
  if (input.title != null && title === undefined) {
    errors.push({ field: "title", message: "title must be true or false" });
  }

  const editable =
    input.editable == null ? false : booleanValue(input.editable);
  if (input.editable != null && editable === undefined) {
    errors.push({
      field: "editable",
      message: "editable must be true or false",
    });
  }

  if (
    input.density != null &&
    input.density !== "default" &&
    input.density !== "compact"
  ) {
    errors.push({
      field: "density",
      message: "density must be default or compact",
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    descriptor: {
      target,
      kind: kind as NotidianEmbedKind,
      id,
      ...(height == null ? {} : { height }),
      title,
      editable,
      ...(input.density == null ? {} : { density: input.density }),
    },
  };
};

export const parseNotidianEmbedBlock = (
  source: string
): NotidianEmbedParseResult =>
  normalizeNotidianEmbedDescriptor(parseNotidianEmbedBlockFields(source));

export const parseLegacyNotidianEmbedRef = (
  ref: string
): NotidianEmbedParseResult => {
  const match = String(ref ?? "").match(/^(.*)\/#([\^\*])([^#]+)$/);
  if (!match) {
    return {
      ok: false,
      errors: [{ field: "legacyRef", message: "legacy ref is not a Notidian embed" }],
    };
  }
  return normalizeNotidianEmbedDescriptor({
    target: match[1],
    kind: match[2] === "^" ? "table" : "view",
    id: match[3],
  });
};

export const descriptorToFragmentPath = (
  descriptor: Pick<NotidianEmbedDescriptor, "target" | "kind" | "id">
) =>
  `${descriptor.target}/#${descriptor.kind === "table" ? "^" : "*"}${
    descriptor.id
  }`;

export const serializeNotidianEmbedBlock = (
  descriptor: NotidianEmbedDescriptor
) => {
  const normalized = normalizeNotidianEmbedDescriptor(descriptor);
  if (!normalized.ok) {
    throw new Error(
      normalized.errors.map((error) => `${error.field}: ${error.message}`).join(", ")
    );
  }
  const value = normalized.descriptor;
  return [
    "```notidian",
    `target: ${value.target}`,
    `kind: ${value.kind}`,
    `id: ${value.id}`,
    ...(value.height == null ? [] : [`height: ${value.height}`]),
    `title: ${value.title === false ? "false" : "true"}`,
    `editable: ${value.editable === true ? "true" : "false"}`,
    ...(value.density ? [`density: ${value.density}`] : []),
    "```",
  ].join("\n");
};
```

- [ ] **Step 4: Run the descriptor tests and verify they pass**

Run:

```bash
npm test -- src/core/utils/embeds/notidianEmbed.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/core/utils/embeds/notidianEmbed.ts src/core/utils/embeds/notidianEmbed.test.ts
git commit -m "feat: add notidian embed descriptors"
```

---

### Task 2: Pure Canvas Wrapper Utilities

**Files:**
- Create: `src/core/utils/embeds/notidianCanvasEmbed.ts`
- Create: `src/core/utils/embeds/notidianCanvasEmbed.test.ts`

- [ ] **Step 1: Write the failing Canvas utility tests**

Create `src/core/utils/embeds/notidianCanvasEmbed.test.ts`:

```ts
import {
  buildNotidianWrapperNote,
  insertNotidianCanvasFileNode,
  safeNotidianEmbedFileStem,
  wrapperPathForNotidianEmbed,
} from "./notidianCanvasEmbed";

const descriptor = {
  target: "Projects/Launch Work",
  kind: "view" as const,
  id: "active tasks",
  height: 480,
  title: true,
  editable: false,
};

describe("Notidian Canvas embed utilities", () => {
  it("builds a safe wrapper note path under the preferred storage root", () => {
    expect(safeNotidianEmbedFileStem(descriptor)).toBe(
      "Projects-Launch-Work-view-active-tasks"
    );
    expect(wrapperPathForNotidianEmbed(descriptor)).toBe(
      ".notidian/embeds/Projects-Launch-Work-view-active-tasks.md"
    );
  });

  it("builds wrapper note content containing the canonical notidian block", () => {
    expect(buildNotidianWrapperNote(descriptor)).toContain("```notidian");
    expect(buildNotidianWrapperNote(descriptor)).toContain(
      "target: Projects/Launch Work"
    );
    expect(buildNotidianWrapperNote(descriptor)).toContain("kind: view");
    expect(buildNotidianWrapperNote(descriptor)).toContain("id: active tasks");
  });

  it("inserts a JSON Canvas file node without touching existing edges", () => {
    const canvas = {
      nodes: [
        {
          id: "aaaaaaaaaaaaaaaa",
          type: "text",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          text: "Existing",
        },
      ],
      edges: [
        {
          id: "bbbbbbbbbbbbbbbb",
          fromNode: "aaaaaaaaaaaaaaaa",
          toNode: "aaaaaaaaaaaaaaaa",
        },
      ],
    };

    expect(
      insertNotidianCanvasFileNode(canvas, {
        file: ".notidian/embeds/projects-view-active.md",
        idFactory: () => "cccccccccccccccc",
      })
    ).toEqual({
      canvas: {
        nodes: [
          canvas.nodes[0],
          {
            id: "cccccccccccccccc",
            type: "file",
            x: 380,
            y: 0,
            width: 760,
            height: 480,
            file: ".notidian/embeds/projects-view-active.md",
          },
        ],
        edges: canvas.edges,
      },
      nodeId: "cccccccccccccccc",
    });
  });

  it("uses explicit insertion coordinates when provided", () => {
    expect(
      insertNotidianCanvasFileNode(
        { nodes: [], edges: [] },
        {
          file: "Notidian Embeds/projects.md",
          idFactory: () => "dddddddddddddddd",
          x: 40,
          y: 80,
          width: 640,
          height: 360,
        }
      ).canvas.nodes[0]
    ).toMatchObject({
      x: 40,
      y: 80,
      width: 640,
      height: 360,
    });
  });
});
```

- [ ] **Step 2: Run the Canvas utility tests and verify the expected failure**

Run:

```bash
npm test -- src/core/utils/embeds/notidianCanvasEmbed.test.ts --runInBand
```

Expected: FAIL because `src/core/utils/embeds/notidianCanvasEmbed.ts` does not exist.

- [ ] **Step 3: Implement the Canvas utility**

Create `src/core/utils/embeds/notidianCanvasEmbed.ts`:

```ts
import {
  NotidianEmbedDescriptor,
  serializeNotidianEmbedBlock,
} from "./notidianEmbed";

export type JsonCanvasNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  file?: string;
  text?: string;
  [key: string]: unknown;
};

export type JsonCanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  [key: string]: unknown;
};

export type JsonCanvasDocument = {
  nodes?: JsonCanvasNode[];
  edges?: JsonCanvasEdge[];
};

export type InsertNotidianCanvasNodeOptions = {
  file: string;
  idFactory: () => string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

const defaultNodeWidth = 760;
const defaultNodeHeight = 480;
const nodeGap = 80;

export const safeNotidianEmbedFileStem = (
  descriptor: Pick<NotidianEmbedDescriptor, "target" | "kind" | "id">
) =>
  [descriptor.target, descriptor.kind, descriptor.id]
    .join("-")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

export const wrapperPathForNotidianEmbed = (
  descriptor: Pick<NotidianEmbedDescriptor, "target" | "kind" | "id">,
  root = ".notidian/embeds"
) => `${root}/${safeNotidianEmbedFileStem(descriptor)}.md`;

export const buildNotidianWrapperNote = (
  descriptor: NotidianEmbedDescriptor
) =>
  [
    "---",
    "notidian_embed_wrapper: true",
    "---",
    "",
    serializeNotidianEmbedBlock(descriptor),
    "",
  ].join("\n");

const nextCanvasPosition = (nodes: JsonCanvasNode[]) => {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const rightMost = nodes.reduce((right, node) => {
    const nodeRight = Number(node.x ?? 0) + Number(node.width ?? 0);
    return Math.max(right, nodeRight);
  }, 0);
  const topMost = nodes.reduce(
    (top, node) => Math.min(top, Number(node.y ?? 0)),
    Number(nodes[0].y ?? 0)
  );
  return { x: rightMost + nodeGap, y: topMost };
};

export const insertNotidianCanvasFileNode = (
  document: JsonCanvasDocument,
  options: InsertNotidianCanvasNodeOptions
): { canvas: Required<JsonCanvasDocument>; nodeId: string } => {
  const nodes = [...(document.nodes ?? [])];
  const edges = [...(document.edges ?? [])];
  const usedIds = new Set([
    ...nodes.map((node) => node.id),
    ...edges.map((edge) => edge.id),
  ]);
  let id = options.idFactory();
  while (usedIds.has(id)) id = options.idFactory();

  const position =
    options.x == null || options.y == null
      ? nextCanvasPosition(nodes)
      : { x: options.x, y: options.y };

  nodes.push({
    id,
    type: "file",
    x: position.x,
    y: position.y,
    width: options.width ?? defaultNodeWidth,
    height: options.height ?? defaultNodeHeight,
    file: options.file,
  });

  return {
    canvas: { nodes, edges },
    nodeId: id,
  };
};
```

- [ ] **Step 4: Run the Canvas utility tests and verify they pass**

Run:

```bash
npm test -- src/core/utils/embeds/notidianCanvasEmbed.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/core/utils/embeds/notidianCanvasEmbed.ts src/core/utils/embeds/notidianCanvasEmbed.test.ts
git commit -m "feat: add notidian canvas embed utilities"
```

---

### Task 3: Shared React Embed Renderer

**Files:**
- Create: `src/core/react/components/NotidianEmbed/NotidianEmbed.tsx`
- Create: `src/core/react/components/NotidianEmbed/NotidianEmbed.test.tsx`
- Modify: `src/core/react/components/SpaceView/Editor/EmbedView/SpaceFragmentView.tsx`

- [ ] **Step 1: Write the failing renderer tests**

Create `src/core/react/components/NotidianEmbed/NotidianEmbed.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NotidianEmbed, NotidianEmbedError } from "./NotidianEmbed";

const superstate = {
  spaceManager: {
    uriByString: (path: string) => ({
      basePath: path.split("/#")[0],
      ref: path.split("/#")[1]?.slice(1),
      refType: path.includes("/#*") ? "frame" : "context",
    }),
  },
} as any;

describe("NotidianEmbed", () => {
  it("renders inline errors without mounting a table", () => {
    const markup = renderToStaticMarkup(
      <NotidianEmbed
        superstate={superstate}
        sourcePath="Dashboard.md"
        host="markdown"
        error={{ message: "target is required" }}
      />
    );

    expect(markup).toContain("mk-notidian-embed-error");
    expect(markup).toContain("target is required");
  });

  it("applies sizing and read-only data attributes for valid descriptors", () => {
    const markup = renderToStaticMarkup(
      <NotidianEmbed
        superstate={superstate}
        sourcePath="Dashboard.md"
        host="markdown"
        descriptor={{
          target: "Projects",
          kind: "view",
          id: "active",
          height: 420,
          title: false,
          editable: false,
        }}
      />
    );

    expect(markup).toContain("mk-notidian-embed");
    expect(markup).toContain('data-host="markdown"');
    expect(markup).toContain('data-editable="false"');
    expect(markup).toContain("height:420px");
  });
});
```

- [ ] **Step 2: Run the renderer tests and verify the expected failure**

Run:

```bash
npm test -- src/core/react/components/NotidianEmbed/NotidianEmbed.test.tsx --runInBand
```

Expected: FAIL because `NotidianEmbed.tsx` does not exist.

- [ ] **Step 3: Add read-mode plumbing to `SpaceFragmentViewComponent`**

Modify `src/core/react/components/SpaceView/Editor/EmbedView/SpaceFragmentView.tsx`:

```tsx
export interface SpaceFragmentViewComponentProps {
  path: string;
  id: string;
  superstate: Superstate;
  source?: string;
  minMode?: boolean;
  showTitle?: boolean;
  readMode?: boolean;
  containerRef?: React.RefObject<HTMLDivElement>;
  setFrameSchema?: (schema: string) => void;
  predicate?: Predicate;
}
```

Change the context render `PathProvider` calls that currently hardcode `readMode={false}` to:

```tsx
readMode={props.readMode ?? false}
```

Apply that replacement in the context branch and the visualization branch. Keep the frame branch `editable={false}` unchanged.

- [ ] **Step 4: Implement `NotidianEmbed`**

Create `src/core/react/components/NotidianEmbed/NotidianEmbed.tsx`:

```tsx
import { SpaceManagerProvider } from "core/react/context/SpaceManagerContext";
import { Superstate } from "makemd-core";
import React from "react";
import {
  descriptorToFragmentPath,
  NotidianEmbedDescriptor,
} from "core/utils/embeds/notidianEmbed";
import { SpaceFragmentViewComponent } from "../SpaceView/Editor/EmbedView/SpaceFragmentView";

export type NotidianEmbedHost =
  | "markdown"
  | "canvas-wrapper"
  | "legacy-transclusion"
  | "workspace-leaf";

export type NotidianEmbedError = {
  message: string;
};

export const NotidianEmbedErrorView = (props: {
  error: NotidianEmbedError;
}) => (
  <div className="mk-notidian-embed-error" role="note">
    <strong>Notidian embed</strong>
    <div>{props.error.message}</div>
  </div>
);

export const NotidianEmbed = (props: {
  superstate: Superstate;
  sourcePath: string;
  host: NotidianEmbedHost;
  descriptor?: NotidianEmbedDescriptor;
  error?: NotidianEmbedError;
}) => {
  if (props.error || !props.descriptor) {
    return (
      <NotidianEmbedErrorView
        error={props.error ?? { message: "Missing Notidian embed descriptor" }}
      />
    );
  }

  const descriptor = props.descriptor;
  const fragmentPath = descriptorToFragmentPath(descriptor);
  const heightStyle =
    descriptor.height == null ? undefined : { height: `${descriptor.height}px` };

  return (
    <div
      className="mk-notidian-embed"
      data-host={props.host}
      data-kind={descriptor.kind}
      data-editable={descriptor.editable === true ? "true" : "false"}
      style={heightStyle}
    >
      <SpaceManagerProvider superstate={props.superstate}>
        <SpaceFragmentViewComponent
          id={fragmentPath}
          path={fragmentPath}
          source={props.sourcePath}
          superstate={props.superstate}
          showTitle={descriptor.title !== false}
          readMode={descriptor.editable !== true}
        />
      </SpaceManagerProvider>
    </div>
  );
};
```

- [ ] **Step 5: Run the renderer tests and the existing fragment compile target**

Run:

```bash
npm test -- src/core/react/components/NotidianEmbed/NotidianEmbed.test.tsx --runInBand
npx tsc -noEmit -skipLibCheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/core/react/components/NotidianEmbed/NotidianEmbed.tsx src/core/react/components/NotidianEmbed/NotidianEmbed.test.tsx src/core/react/components/SpaceView/Editor/EmbedView/SpaceFragmentView.tsx
git commit -m "feat: add shared notidian embed renderer"
```

---

### Task 4: Markdown Code Block Processor

**Files:**
- Create: `src/adapters/obsidian/utils/notidianMarkdownEmbed.tsx`
- Modify: `src/main.ts`

- [ ] **Step 1: Write processor tests around pure handler behavior**

Create `src/adapters/obsidian/utils/notidianMarkdownEmbed.test.tsx`:

```tsx
import { parseNotidianEmbedBlock } from "core/utils/embeds/notidianEmbed";

describe("Notidian markdown embed parser contract", () => {
  it("accepts the block shape used by the Obsidian code block processor", () => {
    expect(
      parseNotidianEmbedBlock("target: Projects\nkind: view\nid: active")
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
      },
    });
  });
});
```

- [ ] **Step 2: Run the processor-adjacent test**

Run:

```bash
npm test -- src/adapters/obsidian/utils/notidianMarkdownEmbed.test.tsx --runInBand
```

Expected: PASS after Task 1. This anchors the block shape before runtime registration.

- [ ] **Step 3: Implement the Markdown processor**

Create `src/adapters/obsidian/utils/notidianMarkdownEmbed.tsx`:

```tsx
import { NotidianEmbed } from "core/react/components/NotidianEmbed/NotidianEmbed";
import {
  parseNotidianEmbedBlock,
  NotidianEmbedDescriptorError,
} from "core/utils/embeds/notidianEmbed";
import MakeMDPlugin from "main";
import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

const errorMessage = (errors: NotidianEmbedDescriptorError[]) =>
  errors.map((error) => `${error.field}: ${error.message}`).join("; ");

class NotidianEmbedRenderChild extends MarkdownRenderChild {
  root: Root | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: MakeMDPlugin,
    private readonly source: string,
    private readonly ctx: MarkdownPostProcessorContext
  ) {
    super(containerEl);
  }

  onload() {
    const parsed = parseNotidianEmbedBlock(this.source);
    this.root = this.plugin.ui.createRoot(this.containerEl);
    this.root.render(
      parsed.ok ? (
        <NotidianEmbed
          superstate={this.plugin.superstate}
          sourcePath={this.ctx.sourcePath}
          host="markdown"
          descriptor={parsed.descriptor}
        />
      ) : (
        <NotidianEmbed
          superstate={this.plugin.superstate}
          sourcePath={this.ctx.sourcePath}
          host="markdown"
          error={{ message: errorMessage(parsed.errors) }}
        />
      )
    );
  }

  onunload() {
    this.root?.unmount();
    this.root = null;
  }
}

export const registerNotidianMarkdownEmbedProcessor = (
  plugin: MakeMDPlugin
) => {
  plugin.registerMarkdownCodeBlockProcessor(
    "notidian",
    (source, element, ctx) => {
      ctx.addChild(new NotidianEmbedRenderChild(element, plugin, source, ctx));
    }
  );
};
```

- [ ] **Step 4: Register the processor in `main.ts`**

Add import near the existing markdown post-processor import:

```ts
import { registerNotidianMarkdownEmbedProcessor } from "adapters/obsidian/utils/notidianMarkdownEmbed";
```

Inside `loadContext()`, in the `if (this.superstate.settings.contextEnabled)` block after extension registration, add:

```ts
      registerNotidianMarkdownEmbedProcessor(this);
```

- [ ] **Step 5: Run processor tests and typecheck**

Run:

```bash
npm test -- src/adapters/obsidian/utils/notidianMarkdownEmbed.test.tsx --runInBand
npx tsc -noEmit -skipLibCheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/adapters/obsidian/utils/notidianMarkdownEmbed.tsx src/adapters/obsidian/utils/notidianMarkdownEmbed.test.tsx src/main.ts
git commit -m "feat: render notidian markdown embeds"
```

---

### Task 5: Legacy Embed Routing And Block Helper Compatibility

**Files:**
- Modify: `src/shared/utils/makemd/embed.ts`
- Modify: `src/basics/flow/markdownPost.tsx`
- Modify: `src/core/react/components/SpaceEditor/SpaceListProperty.tsx`
- Modify: `src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx`

- [ ] **Step 1: Extend descriptor tests for helper wrappers**

Append to `src/core/utils/embeds/notidianEmbed.test.ts`:

```ts
import { notidianEmbedBlockFromParts } from "shared/utils/makemd/embed";

it("builds a Notidian-native block from legacy embed helper inputs", () => {
  expect(
    notidianEmbedBlockFromParts({
      target: "Projects",
      kind: "view",
      id: "active",
    })
  ).toBe(
    [
      "```notidian",
      "target: Projects",
      "kind: view",
      "id: active",
      "title: true",
      "editable: false",
      "```",
    ].join("\n")
  );
});
```

- [ ] **Step 2: Run the helper test and verify the expected failure**

Run:

```bash
npm test -- src/core/utils/embeds/notidianEmbed.test.ts --runInBand
```

Expected: FAIL because `notidianEmbedBlockFromParts` is not exported from `shared/utils/makemd/embed`.

- [ ] **Step 3: Add helper wrappers while preserving legacy helpers**

Modify `src/shared/utils/makemd/embed.ts`:

```ts
import {
  NotidianEmbedDescriptor,
  serializeNotidianEmbedBlock,
} from "core/utils/embeds/notidianEmbed";
import { SpaceState } from "shared/types/PathState";

export const framePathForSpace = (space: SpaceState, schema: string) => {
  if (space.type == "folder") {
    return `${space.path}/#*${schema}`;
  }
  if (space.type == "vault") {
    return `/#*${schema}`;
  }
  return `${space.path}/#*${schema}`;
};

export const actionPathForSpace = (space: SpaceState, schema: string) => {
  if (space.type == "folder") {
    return `${space.path}/#;${schema}`;
  }
  if (space.type == "vault") {
    return `/#;${schema}`;
  }
  return `${space.path}/#;${schema}`;
};

export const contextPathForSpace = (space: SpaceState, schema: string) => {
  if (space.type == "folder") {
    return `${space.path}/#^${schema}`;
  }
  if (space.type == "vault") {
    return `/#^${schema}`;
  }
  return `${space.path}/#^${schema}`;
};

export const contextViewEmbedStringFromContext = (
  space: SpaceState,
  schema: string
) => `![![${framePathForSpace(space, schema)}]]`;

export const contextEmbedStringFromContext = (
  space: SpaceState,
  schema: string
) => `![![${contextPathForSpace(space, schema)}]]`;

export const notidianEmbedBlockFromParts = (
  descriptor: NotidianEmbedDescriptor
) => serializeNotidianEmbedBlock(descriptor);

export const notidianTableEmbedBlockFromContext = (
  space: SpaceState,
  schema: string
) =>
  notidianEmbedBlockFromParts({
    target: space.path,
    kind: "table",
    id: schema,
    title: true,
    editable: false,
  });

export const notidianViewEmbedBlockFromContext = (
  space: SpaceState,
  schema: string
) =>
  notidianEmbedBlockFromParts({
    target: space.path,
    kind: "view",
    id: schema,
    title: true,
    editable: false,
  });
```

- [ ] **Step 4: Route legacy fragments in reading mode through `NotidianEmbed`**

Modify `src/basics/flow/markdownPost.tsx` imports:

```tsx
import { NotidianEmbed } from "core/react/components/NotidianEmbed/NotidianEmbed";
import { parseLegacyNotidianEmbedRef } from "core/utils/embeds/notidianEmbed";
```

In `replaceAllTables`, replace the current `reactEl.render(<UINote ... />)` block with:

```tsx
      const parsed = parseLegacyNotidianEmbedRef(link);
      if (parsed.ok) {
        reactEl.render(
          <NotidianEmbed
            superstate={(plugin.enactor as any).makemd.superstate}
            sourcePath={ctx.sourcePath}
            host="legacy-transclusion"
            descriptor={parsed.descriptor}
          />
        );
      } else {
        reactEl.render(
          <UINote
            load={true}
            plugin={plugin}
            path={link}
            source={ctx.sourcePath}
          ></UINote>
        );
      }
```

- [ ] **Step 5: Update table/view menus to copy Notidian-native blocks**

In `src/core/react/components/SpaceEditor/SpaceListProperty.tsx`, add imports:

```ts
  contextEmbedStringFromContext,
  notidianTableEmbedBlockFromContext,
```

Change the existing copy option body to:

```tsx
        navigator.clipboard.writeText(
          notidianTableEmbedBlockFromContext(spaceState, _schema.id)
        );
```

Add a second menu option immediately after it:

```tsx
    menuOptions.push({
      name: "Copy Legacy Embed Link",
      icon: "ui//link",
      onClick: () => {
        navigator.clipboard.writeText(
          contextEmbedStringFromContext(spaceState, _schema.id)
        );
      },
    });
```

In `src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx`, import `notidianViewEmbedBlockFromContext` and make the same default/legacy split for saved views.

- [ ] **Step 6: Run helper and type tests**

Run:

```bash
npm test -- src/core/utils/embeds/notidianEmbed.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
```

Expected: both commands PASS.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add src/shared/utils/makemd/embed.ts src/basics/flow/markdownPost.tsx src/core/react/components/SpaceEditor/SpaceListProperty.tsx src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx src/core/utils/embeds/notidianEmbed.test.ts
git commit -m "feat: route legacy notidian embeds"
```

---

### Task 6: Markdown Insert Commands And Picker

**Files:**
- Create: `src/core/react/components/NotidianEmbed/NotidianEmbedPickerModal.tsx`
- Create: `src/adapters/obsidian/utils/notidianEmbedCommands.tsx`
- Modify: `src/commands.tsx`
- Modify: `src/core/react/components/SpaceEditor/SpaceListProperty.tsx`
- Modify: `src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx`
- Modify: `src/shared/en.ts`

- [ ] **Step 1: Write insertion helper tests**

Create `src/adapters/obsidian/utils/notidianEmbedCommands.test.ts`:

```ts
import {
  insertTextIntoEditorSelection,
  defaultDescriptorForTarget,
} from "./notidianEmbedCommands";

describe("Notidian embed command helpers", () => {
  it("builds a default files view descriptor for command-palette insertion", () => {
    expect(defaultDescriptorForTarget("Projects")).toEqual({
      target: "Projects",
      kind: "view",
      id: "filesView",
      title: true,
      editable: false,
    });
  });

  it("inserts text into an editor selection", () => {
    const replaceRange = jest.fn();
    const editor = {
      getCursor: () => ({ line: 2, ch: 4 }),
      replaceRange,
    };

    insertTextIntoEditorSelection(editor as any, "```notidian\n```");

    expect(replaceRange).toHaveBeenCalledWith(
      "```notidian\n```",
      { line: 2, ch: 4 }
    );
  });
});
```

- [ ] **Step 2: Run the command helper tests and verify the expected failure**

Run:

```bash
npm test -- src/adapters/obsidian/utils/notidianEmbedCommands.test.ts --runInBand
```

Expected: FAIL because `notidianEmbedCommands.tsx` does not exist.

- [ ] **Step 3: Add picker modal**

Create `src/core/react/components/NotidianEmbed/NotidianEmbedPickerModal.tsx`:

```tsx
import { Superstate } from "makemd-core";
import React, { useMemo, useState } from "react";
import { NotidianEmbedDescriptor } from "core/utils/embeds/notidianEmbed";

export const NotidianEmbedPickerModal = (props: {
  superstate: Superstate;
  saveLabel: string;
  onChoose: (descriptor: NotidianEmbedDescriptor) => void;
}) => {
  const spaces = useMemo(
    () =>
      Array.from(props.superstate.spacesIndex.values())
        .filter((space: any) => space?.path)
        .map((space: any) => ({
          path: space.path,
          name: space.name || space.path,
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [props.superstate]
  );
  const [target, setTarget] = useState(spaces[0]?.path ?? "");

  return (
    <div className="mk-notidian-embed-picker">
      <label>
        <div>Database</div>
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.path} value={space.path}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!target}
        onClick={() =>
          props.onChoose({
            target,
            kind: "view",
            id: "filesView",
            title: true,
            editable: false,
          })
        }
      >
        {props.saveLabel}
      </button>
    </div>
  );
};
```

- [ ] **Step 4: Add command helpers**

Create `src/adapters/obsidian/utils/notidianEmbedCommands.tsx`:

```tsx
import { NotidianEmbedPickerModal } from "core/react/components/NotidianEmbed/NotidianEmbedPickerModal";
import {
  NotidianEmbedDescriptor,
  serializeNotidianEmbedBlock,
} from "core/utils/embeds/notidianEmbed";
import {
  buildNotidianWrapperNote,
  insertNotidianCanvasFileNode,
  wrapperPathForNotidianEmbed,
} from "core/utils/embeds/notidianCanvasEmbed";
import MakeMDPlugin from "main";
import { Editor, MarkdownView, normalizePath, TFile } from "obsidian";
import React from "react";
import i18n from "shared/i18n";
import { windowFromDocument } from "shared/utils/dom";
import { genId } from "shared/utils/uuid";
import { safelyParseJSON } from "shared/utils/json";

export const defaultDescriptorForTarget = (
  target: string
): NotidianEmbedDescriptor => ({
  target,
  kind: "view",
  id: "filesView",
  title: true,
  editable: false,
});

export const insertTextIntoEditorSelection = (editor: Editor, text: string) => {
  editor.replaceRange(text, editor.getCursor());
};

export const insertDescriptorIntoActiveMarkdown = (
  plugin: MakeMDPlugin,
  descriptor: NotidianEmbedDescriptor
) => {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.editor) {
    plugin.superstate.ui.notify("Open a Markdown editor before inserting a Notidian embed.");
    return false;
  }
  insertTextIntoEditorSelection(
    view.editor,
    `${serializeNotidianEmbedBlock(descriptor)}\n`
  );
  return true;
};

export const copyDescriptorToClipboard = async (
  descriptor: NotidianEmbedDescriptor
) => navigator.clipboard.writeText(serializeNotidianEmbedBlock(descriptor));

export const openNotidianEmbedPicker = (
  plugin: MakeMDPlugin,
  onChoose: (descriptor: NotidianEmbedDescriptor) => void,
  saveLabel: string
) => {
  plugin.superstate.ui.openModal(
    "Notidian Embed",
    <NotidianEmbedPickerModal
      superstate={plugin.superstate}
      saveLabel={saveLabel}
      onChoose={onChoose}
    />,
    windowFromDocument(plugin.app.workspace.getLeaf()?.containerEl.ownerDocument)
  );
};

export const insertDescriptorIntoActiveCanvas = async (
  plugin: MakeMDPlugin,
  descriptor: NotidianEmbedDescriptor
) => {
  const file = plugin.app.workspace.getActiveFile();
  if (!(file instanceof TFile) || file.extension !== "canvas") {
    plugin.superstate.ui.notify("Open a Canvas file before inserting a Notidian embed.");
    return false;
  }

  const wrapperPath = normalizePath(wrapperPathForNotidianEmbed(descriptor));
  const wrapperContent = buildNotidianWrapperNote(descriptor);
  const existingWrapper = plugin.app.vault.getAbstractFileByPath(wrapperPath);
  if (existingWrapper instanceof TFile) {
    await plugin.app.vault.modify(existingWrapper, wrapperContent);
  } else {
    const parentPath = wrapperPath.slice(0, wrapperPath.lastIndexOf("/"));
    if (parentPath && !plugin.app.vault.getAbstractFileByPath(parentPath)) {
      await plugin.app.vault.createFolder(parentPath);
    }
    await plugin.app.vault.create(wrapperPath, wrapperContent);
  }

  const canvasText = await plugin.app.vault.read(file);
  const parsedCanvas = safelyParseJSON(canvasText) || {};
  const { canvas } = insertNotidianCanvasFileNode(parsedCanvas, {
    file: wrapperPath,
    idFactory: genId,
  });
  await plugin.app.vault.modify(file, JSON.stringify(canvas, null, 2));
  return true;
};

export const registerNotidianEmbedCommands = (plugin: MakeMDPlugin) => {
  plugin.addCommand({
    id: "notidian-insert-database-embed",
    name: i18n.commandPalette.insertNotidianDatabaseEmbed,
    callback: () =>
      openNotidianEmbedPicker(
        plugin,
        (descriptor) => insertDescriptorIntoActiveMarkdown(plugin, descriptor),
        i18n.buttons.insert
      ),
  });

  plugin.addCommand({
    id: "notidian-copy-database-embed",
    name: i18n.commandPalette.copyNotidianDatabaseEmbed,
    callback: () =>
      openNotidianEmbedPicker(
        plugin,
        (descriptor) => copyDescriptorToClipboard(descriptor),
        i18n.buttons.copy
      ),
  });

  plugin.addCommand({
    id: "notidian-insert-database-embed-into-canvas",
    name: i18n.commandPalette.insertNotidianDatabaseEmbedIntoCanvas,
    callback: () =>
      openNotidianEmbedPicker(
        plugin,
        (descriptor) => insertDescriptorIntoActiveCanvas(plugin, descriptor),
        i18n.buttons.insert
      ),
  });
};
```

- [ ] **Step 5: Register commands**

In `src/commands.tsx`, add:

```ts
import { registerNotidianEmbedCommands } from "adapters/obsidian/utils/notidianEmbedCommands";
```

Inside `attachCommands`, after `plugin.addCommand({ id: "path-fixer", ... })`, add:

```ts
  registerNotidianEmbedCommands(plugin);
```

- [ ] **Step 6: Add menu insertion actions for the current table or view**

In `src/core/react/components/SpaceEditor/SpaceListProperty.tsx`, add:

```ts
import {
  insertDescriptorIntoActiveCanvas,
  insertDescriptorIntoActiveMarkdown,
} from "adapters/obsidian/utils/notidianEmbedCommands";
```

Inside `viewContextMenu`, after the copy actions, add:

```tsx
    menuOptions.push({
      name: "Insert Embed In Active Markdown",
      icon: "ui//plus",
      onClick: () => {
        insertDescriptorIntoActiveMarkdown(
          (props.superstate.ui as any).plugin,
          {
            target: spaceState.path,
            kind: "table",
            id: _schema.id,
            title: true,
            editable: false,
          }
        );
      },
    });

    menuOptions.push({
      name: "Insert Embed Into Active Canvas",
      icon: "ui//canvas",
      onClick: () => {
        insertDescriptorIntoActiveCanvas((props.superstate.ui as any).plugin, {
          target: spaceState.path,
          kind: "table",
          id: _schema.id,
          title: true,
          editable: false,
        });
      },
    });
```

In `src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx`, add the same imports and add view-specific actions:

```tsx
    menuOptions.push({
      name: "Insert Embed In Active Markdown",
      icon: "ui//plus",
      onClick: () => {
        insertDescriptorIntoActiveMarkdown(
          (props.superstate.ui as any).plugin,
          {
            target: spaceState.path,
            kind: "view",
            id: _schema.id,
            title: true,
            editable: false,
          }
        );
      },
    });

    menuOptions.push({
      name: "Insert Embed Into Active Canvas",
      icon: "ui//canvas",
      onClick: () => {
        insertDescriptorIntoActiveCanvas((props.superstate.ui as any).plugin, {
          target: spaceState.path,
          kind: "view",
          id: _schema.id,
          title: true,
          editable: false,
        });
      },
    });
```

- [ ] **Step 7: Add i18n labels**

In `src/shared/en.ts`, add command labels under `commandPalette`:

```ts
    "insertNotidianDatabaseEmbed": "Insert Notidian Database Embed",
    "copyNotidianDatabaseEmbed": "Copy Notidian Database Embed",
    "insertNotidianDatabaseEmbedIntoCanvas": "Insert Notidian Database Embed Into Canvas",
```

Add button labels under the existing `buttons` object if missing:

```ts
    "insert": "Insert",
    "copy": "Copy",
```

- [ ] **Step 8: Run command tests and typecheck**

Run:

```bash
npm test -- src/adapters/obsidian/utils/notidianEmbedCommands.test.ts --runInBand
npx tsc -noEmit -skipLibCheck
```

Expected: both commands PASS.

- [ ] **Step 9: Commit Task 6**

Run:

```bash
git add src/core/react/components/NotidianEmbed/NotidianEmbedPickerModal.tsx src/adapters/obsidian/utils/notidianEmbedCommands.tsx src/adapters/obsidian/utils/notidianEmbedCommands.test.ts src/commands.tsx src/core/react/components/SpaceEditor/SpaceListProperty.tsx src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx src/shared/en.ts
git commit -m "feat: add notidian embed insertion commands"
```

---

### Task 7: Canvas Runtime Probe And Real-Vault Smoke Path

**Files:**
- Modify: `scripts/notidianRealVaultHarness.js`
- Modify: `scripts/notidianRealVaultHarness.test.js`
- Modify: `docs/real-vault-smoke-harness.md`

- [ ] **Step 1: Extend harness argument parsing tests**

In `scripts/notidianRealVaultHarness.test.js`, update the first test expected object to include:

```js
includeEmbeds: false,
```

Add a parse assertion:

```js
    expect(
      parseHarnessArgs(["vault=Atlas Vault", "--allow-write", "--embeds"], {})
    ).toMatchObject({
      vault: "Atlas Vault",
      allowWrite: true,
      includeEmbeds: true,
    });
```

- [ ] **Step 2: Run the harness tests and verify the expected failure**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: FAIL because `includeEmbeds` and `--embeds` are not implemented.

- [ ] **Step 3: Add harness config flag**

In `scripts/notidianRealVaultHarness.js`, add to `parseHarnessArgs` default config:

```js
    includeEmbeds: false,
```

Inside the arg loop:

```js
    if (arg == "--embeds") {
      config.includeEmbeds = true;
      continue;
    }
```

- [ ] **Step 4: Add embed eval helpers**

Add these helpers near the other eval builders:

```js
const embedSmokeEvalCode = ({ pluginId, folder, pagePath, canvasPath }) =>
  `(async () => {
    const marker = "notidianEmbedSmoke";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
      if (!plugin?.superstate) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      const block = [
        "```notidian",
        "target: ${folder}",
        "kind: view",
        "id: filesView",
        "height: 480",
        "title: true",
        "editable: false",
        "```",
        "",
      ].join("\\n");
      const page = app.vault.getAbstractFileByPath(${JSON.stringify(pagePath)});
      if (!page) return finish({ ok: false, reason: "missing-page" });
      await app.vault.modify(page, block);
      const wrapperPath = ".notidian/embeds/notidian-smoke-filesView.md";
      const wrapperParent = app.vault.getAbstractFileByPath(".notidian/embeds");
      if (!wrapperParent) {
        const root = app.vault.getAbstractFileByPath(".notidian");
        if (!root) await app.vault.createFolder(".notidian");
        await app.vault.createFolder(".notidian/embeds");
      }
      const wrapper = app.vault.getAbstractFileByPath(wrapperPath);
      if (wrapper) {
        await app.vault.modify(wrapper, block);
      } else {
        await app.vault.create(wrapperPath, block);
      }
      const canvas = app.vault.getAbstractFileByPath(${JSON.stringify(canvasPath)});
      if (!canvas) return finish({ ok: false, reason: "missing-canvas" });
      await app.vault.modify(canvas, JSON.stringify({
        nodes: [{
          id: "notidianembed0001",
          type: "file",
          x: 0,
          y: 0,
          width: 760,
          height: 480,
          file: wrapperPath
        }],
        edges: []
      }, null, 2));
      return finish({ ok: true, wrapperPath });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");
```

- [ ] **Step 5: Wire the embed smoke path into the harness**

In `createFixturePaths`, add:

```js
    embedPagePath: `${prefix}-Embed Page.md`,
    embedCanvasPath: `${prefix}-Embed Canvas.canvas`,
```

In `runRealVaultSmokeHarness`, after the table view setup succeeds and before cleanup, add:

```js
    if (config.includeEmbeds) {
      await runObsidian(config, runner, "create", {
        path: paths.embedPagePath,
        content: "",
        overwrite: true,
      });
      await runObsidian(config, runner, "create", {
        path: paths.embedCanvasPath,
        content: JSON.stringify({ nodes: [], edges: [] }),
        overwrite: true,
      });
      const embedResult = JSON.parse(
        normalizeCliValue(
          await runObsidian(config, runner, "eval", {
            code: embedSmokeEvalCode({
              pluginId: config.pluginId,
              folder: paths.folder,
              pagePath: paths.embedPagePath,
              canvasPath: paths.embedCanvasPath,
            }),
          })
        )
      );
      if (!embedResult.ok) {
        throw new Error(`Embed smoke failed: ${JSON.stringify(embedResult)}`);
      }
    }
```

Add `paths.embedPagePath` and `paths.embedCanvasPath` to the cleanup path list.

- [ ] **Step 6: Update harness docs**

In `docs/real-vault-smoke-harness.md`, add a row to the options table:

```md
| `--embeds` | off | Also creates a Notidian Markdown embed page and Canvas wrapper file-node fixture. |
```

- [ ] **Step 7: Run harness tests**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

Run:

```bash
git add scripts/notidianRealVaultHarness.js scripts/notidianRealVaultHarness.test.js docs/real-vault-smoke-harness.md
git commit -m "test: add notidian embed smoke harness"
```

---

### Task 8: Documentation And Full Verification

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/table-database-workflows.md`
- Modify: `docs/notidian-system-architecture.md`

- [ ] **Step 1: Update `docs/current-state.md`**

Add a new implemented behavior section after `Canonical Schema Planning`:

```md
### Notidian Database Embeds

Notidian supports live database embeds in Markdown pages through fenced
`notidian` blocks. Embed blocks resolve to a Notidian target folder plus a
table/schema id or saved view id, then render through the same table projection
path as ordinary Notidian database views.

Legacy `![![Folder/#^schema]]` and `![![Folder/#*view]]` references remain
compatible and route through the shared embed renderer.

Canvas insertion uses a wrapper Markdown note and a JSON Canvas file node. The
wrapper note stores only the Notidian embed block; it does not store row data.
Rows remain Markdown files, ordinary properties remain frontmatter, and
Notidian view state remains Notidian-owned context state.

Embedded views default to read-only. Editable embeds require an explicit
descriptor flag and still use the existing authority-aware table transaction
paths.
```

Add implementation map rows for:

```md
| Database embed descriptor and Canvas utilities | [notidianEmbed.ts](../src/core/utils/embeds/notidianEmbed.ts), [notidianEmbed.test.ts](../src/core/utils/embeds/notidianEmbed.test.ts), [notidianCanvasEmbed.ts](../src/core/utils/embeds/notidianCanvasEmbed.ts), and [notidianCanvasEmbed.test.ts](../src/core/utils/embeds/notidianCanvasEmbed.test.ts) |
| Database embed renderer and Obsidian hosts | [NotidianEmbed.tsx](../src/core/react/components/NotidianEmbed/NotidianEmbed.tsx), [notidianMarkdownEmbed.tsx](../src/adapters/obsidian/utils/notidianMarkdownEmbed.tsx), and [notidianEmbedCommands.tsx](../src/adapters/obsidian/utils/notidianEmbedCommands.tsx) |
```

- [ ] **Step 2: Update `docs/table-database-workflows.md`**

Add a section before `Copy, Cut, Paste, And Clear Ranges`:

```md
## Embed A Database In A Page Or Canvas

Use `Copy Notidian database embed` from a table or saved view menu to copy a
live embed block:

````md
```notidian
target: Projects
kind: view
id: filesView
title: true
editable: false
```
````

Paste that block into a Markdown page to render the live Notidian view.

Use `Insert Notidian database into canvas` while a Canvas file is active to add
the same live view as a Canvas file node. Notidian creates or updates a small
wrapper note for the Canvas node. The wrapper stores only the embed block, not
database rows or frontmatter values.

Embeds are read-only by default. Open the source Notidian table when you want
the full editing surface.
```

- [ ] **Step 3: Update `docs/notidian-system-architecture.md`**

Add this under `System Layers`:

```md
### Database Embed Projection

A Notidian database embed is a live projection descriptor:

- `target` identifies the folder/database scope;
- `kind` identifies whether the descriptor points at a table/schema or saved
  view/frame;
- `id` identifies that schema or view;
- host fields such as height and title visibility affect presentation only.

Markdown pages and Canvas files store this descriptor or a wrapper reference to
it. They do not store row data. Rendering the descriptor uses the same Notidian
table projection and authority-aware edit model as the main database surface.
```

- [ ] **Step 4: Run documentation diff checks**

Run:

```bash
rg -n "Bases|\\.base" docs/current-state.md docs/table-database-workflows.md docs/notidian-system-architecture.md
git diff --check
```

Expected: `rg` only reports existing architecture/guardrail mentions, and `git diff --check` exits 0.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/core/utils/embeds/notidianEmbed.test.ts src/core/utils/embeds/notidianCanvasEmbed.test.ts src/core/react/components/NotidianEmbed/NotidianEmbed.test.tsx src/adapters/obsidian/utils/notidianMarkdownEmbed.test.tsx src/adapters/obsidian/utils/notidianEmbedCommands.test.ts scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Run full source verification**

Run:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

Expected: all commands PASS.

- [ ] **Step 7: Run live health audit**

Run:

```bash
npm run health:audit -- --live
```

Expected: PASS with Notidian enabled, loaded, legacy storage guard active, native Bases disabled, and no captured Obsidian errors.

- [ ] **Step 8: Optional live embed smoke**

Run only after the user approves real-vault writes:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --embeds
```

Expected: PASS, with fixture cleanup unless `--keep-fixture` is also supplied.

- [ ] **Step 9: Commit Task 8**

Run:

```bash
git add docs/current-state.md docs/table-database-workflows.md docs/notidian-system-architecture.md
git commit -m "docs: document notidian database embeds"
```

---

## Final Integration Checklist

- [ ] `NotidianEmbedDescriptor` is the only parser/serializer contract.
- [ ] Legacy `#^` and `#*` refs still work.
- [ ] New UI copies fenced `notidian` blocks by default.
- [ ] Markdown reading mode renders valid embeds and inline errors.
- [ ] Canvas insertion creates a wrapper note and a valid JSON Canvas file node.
- [ ] Wrapper notes store only embed descriptors, not row data.
- [ ] Default embed rendering is read-only.
- [ ] Typecheck, build, focused tests, full tests, and live health audit pass.
- [ ] Documentation describes the shipped behavior without introducing native Bases as a target.
