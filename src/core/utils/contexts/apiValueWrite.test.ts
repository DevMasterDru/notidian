/**
 * bd Notidian-1da: the programmatic API value-write surface
 * (api.context.update / api.path.setProperty) must obey the SAME authority
 * partition as the calendar/modal/header edits. These tests pin the pure routing
 * decision: which storage layer a single field write lands in.
 */
import { SpaceTable } from "shared/types/mdb";
import { notidianPropertySource } from "../properties/propertyAuthority";
import { frontmatterPropertySource } from "../properties/allProperties";
import {
  apiFieldWriteTarget,
  resolveApiFieldColumn,
} from "./apiValueWrite";

const tableWith = (cols: SpaceTable["cols"]): SpaceTable => ({
  schema: { id: "ctx", name: "ctx", type: "db" },
  cols,
  rows: [],
});

describe("apiValueWrite: resolveApiFieldColumn", () => {
  it("returns the first context table that defines the field", () => {
    const a = tableWith([{ name: "other", type: "text" }]);
    const b = tableWith([{ name: "status", type: "text", source: "frontmatter" }]);
    expect(resolveApiFieldColumn("status", [a, b])?.source).toBe("frontmatter");
  });

  it("returns undefined when no context table defines the field", () => {
    const a = tableWith([{ name: "other", type: "text" }]);
    expect(resolveApiFieldColumn("missing", [a, null, undefined])).toBeUndefined();
  });
});

describe("apiValueWrite: apiFieldWriteTarget (authority gate)", () => {
  it("routes a frontmatter-authority column to frontmatter (even when the verb defaults to context)", () => {
    const ctx = tableWith([
      { name: "status", type: "text", source: frontmatterPropertySource },
    ]);
    // context.update's pre-gate default is "context"; a frontmatter column must
    // still be redirected to the file's YAML, not leak into the hidden MDB.
    expect(apiFieldWriteTarget("status", [ctx], "context")).toBe("frontmatter");
  });

  it("routes a source:notidian column to context (even when the verb defaults to frontmatter)", () => {
    const ctx = tableWith([
      { name: "manual", type: "text", source: notidianPropertySource },
    ]);
    // setProperty's pre-gate default is "frontmatter"; an explicitly
    // Notidian-owned column must persist to the context MDB instead.
    expect(apiFieldWriteTarget("manual", [ctx], "frontmatter")).toBe("context");
  });

  it("routes a context-only (no-frontmatter-form) column to context", () => {
    const ctx = tableWith([{ name: "rel", type: "context" }]);
    expect(apiFieldWriteTarget("rel", [ctx], "frontmatter")).toBe("context");
  });

  it("skips computed/read-only columns (never persists a derived value)", () => {
    const ctx = tableWith([{ name: "total", type: "rollup" }]);
    expect(apiFieldWriteTarget("total", [ctx], "context")).toBe("skip");
    expect(apiFieldWriteTarget("total", [ctx], "frontmatter")).toBe("skip");
  });

  it("falls back to the verb default for an unresolved column", () => {
    expect(apiFieldWriteTarget("ghost", [], "frontmatter")).toBe("frontmatter");
    expect(apiFieldWriteTarget("ghost", [], "context")).toBe("context");
  });
});
