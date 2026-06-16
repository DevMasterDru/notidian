// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-wzsj) — round-trip + corruption-
// resilience net for the (de)serialization seam in
// src/core/utils/frames/nodes.ts: frameToNode (l.5) and nodeToFrame (l.18).
//
// WHAT THEY ARE. These two PURE functions are the only bridge between two
// representations of a frame node:
//   - MFrame  — the persisted MDB ROW shape (shared/types/mframe.ts). Every
//     structured field is a STRING: `contexts`, `styles`, `actions`, `props`,
//     and `interactions` are JSON strings, and `rank` is a string integer.
//   - FrameNode — the in-memory shape the frame runtime consumes. The same
//     five fields are parsed objects (FrameTreeProp) and `rank` is a number.
//
//   frameToNode  : MFrame  -> FrameNode   (read path, MDB -> runtime)
//   nodeToFrame  : FrameNode -> MFrame     (write path, runtime -> MDB)
//
// frameToNode runs each of the five JSON columns through safelyParseJSON and
// `parseInt(frame.rank)`; it also DERIVES `types`/`propsValue` purely from
// `frame.type` via nodeToTypes/nodeToPropValue (schemas/frames.ts). nodeToFrame
// destructures the five object fields back out and re-stringifies them, emitting
// the canonical 12-key MFrame shape.
//
// WHY IT MATTERS. This seam decides whether a persisted frame survives the
// round trip and how it degrades when the MDB is corrupt:
//   - safelyParseJSON (shared/utils/json.ts) SWALLOWS JSON.parse errors and
//     returns `undefined` — it never throws. So corrupt MDB content silently
//     yields an `undefined` field rather than crashing the runtime. That
//     silent-degrade is the load-bearing resilience contract; this file pins it.
//   - `parseInt(frame.rank)` produces NaN for a non-numeric rank, and a
//     PREFIX-number ("12px" -> 12) for a partly-numeric one. Both are silent.
//   - Persisted columns are attacker/forge-reachable, so frameToNode must not
//     assume well-formed input.
// There was ZERO direct coverage of either function before this file.
//
// METHOD (AGENTS.md Long Autonomous Mode). Pure offline characterization. Each
// assertion pins LIVE behavior observed against the real safelyParseJSON /
// parseInt / nodeToTypes / nodeToPropValue. Where current behavior is the
// CORRECT contract (silent-undefined on corrupt JSON; identity round-trip on
// serializable fields) it is asserted AS the contract — so any future change
// that breaks resilience or symmetry fails here. Where the behavior is a latent
// HAZARD (NaN rank, the "null" JSON literal surviving as `null` not `undefined`,
// nodeToFrame emitting `undefined`-valued keys) it is pinned as a REGRESSION
// witness with an explanatory comment, not silently blessed.
// ===========================================================================

import { frameToNode, nodeToFrame } from "core/utils/frames/nodes";
import { FrameNode, MFrame } from "shared/types/mframe";

// A fully-populated, well-formed persisted row. Every structured column is a
// valid JSON string and rank is a clean string integer — the happy path.
const cleanFrame = (): MFrame => ({
  id: "node-1",
  schemaId: "schema-1",
  name: "Node One",
  type: "text",
  parentId: "parent-1",
  rank: "3",
  ref: "ref-1",
  contexts: JSON.stringify({ ctxKey: "ctxVal", nested: { n: 1 } }),
  styles: JSON.stringify({ color: "red", width: "100px" }),
  actions: JSON.stringify({ onClick: "doThing()" }),
  props: JSON.stringify({ propA: 1, propB: "two" }),
  interactions: JSON.stringify({ hover: true }),
});

describe("frameToNode (MDB row -> runtime FrameNode, read path)", () => {
  it("passes scalar identity fields through unchanged", () => {
    const node = frameToNode(cleanFrame());
    expect(node.id).toBe("node-1");
    expect(node.schemaId).toBe("schema-1");
    expect(node.name).toBe("Node One");
    expect(node.type).toBe("text");
    expect(node.parentId).toBe("parent-1");
    expect(node.ref).toBe("ref-1");
  });

  it("parses each of the five JSON columns into the matching object field", () => {
    const node = frameToNode(cleanFrame());
    expect(node.contexts).toEqual({ ctxKey: "ctxVal", nested: { n: 1 } });
    expect(node.styles).toEqual({ color: "red", width: "100px" });
    expect(node.actions).toEqual({ onClick: "doThing()" });
    expect(node.props).toEqual({ propA: 1, propB: "two" });
    expect(node.interactions).toEqual({ hover: true });
  });

  it("converts the string rank into a number", () => {
    expect(frameToNode(cleanFrame()).rank).toBe(3);
    expect(typeof frameToNode(cleanFrame()).rank).toBe("number");
  });

  it("derives types/propsValue purely from type (not from the row's own fields)", () => {
    // value-bearing leaf type ("text") -> nodeToTypes/nodeToPropValue produce
    // {value:'text'} and a value alias. These are DERIVED, so they are present
    // even though MFrame carries no `types`/`propsValue` columns.
    const textNode = frameToNode(cleanFrame());
    expect(textNode.types).toEqual({ value: "text" });
    expect(textNode.propsValue).toEqual({ value: JSON.stringify({ alias: "Label" }) });

    // structural container types collapse both to empty objects.
    const containerNode = frameToNode({ ...cleanFrame(), type: "container" });
    expect(containerNode.types).toEqual({});
    expect(containerNode.propsValue).toEqual({});
  });

  // -- corruption resilience: the load-bearing safelyParseJSON contract --------

  it("yields undefined (no throw) for malformed JSON in the contexts column", () => {
    const node = frameToNode({ ...cleanFrame(), contexts: "{ not json" });
    expect(node.contexts).toBeUndefined();
  });

  it("yields undefined (no throw) for malformed JSON in the styles column", () => {
    const node = frameToNode({ ...cleanFrame(), styles: "[1, 2" });
    expect(node.styles).toBeUndefined();
  });

  it("yields undefined (no throw) for malformed JSON in the actions column", () => {
    const node = frameToNode({ ...cleanFrame(), actions: "undefined" });
    expect(node.actions).toBeUndefined();
  });

  it("yields undefined (no throw) for an empty-string props column", () => {
    const node = frameToNode({ ...cleanFrame(), props: "" });
    expect(node.props).toBeUndefined();
  });

  it("yields undefined (no throw) for malformed JSON in the interactions column", () => {
    const node = frameToNode({ ...cleanFrame(), interactions: "{bad" });
    expect(node.interactions).toBeUndefined();
  });

  it("does not throw when EVERY structured column is corrupt at once", () => {
    const allCorrupt: MFrame = {
      ...cleanFrame(),
      contexts: "{",
      styles: "}",
      actions: "[",
      props: "not-json",
      interactions: "###",
    };
    let node!: FrameNode;
    expect(() => {
      node = frameToNode(allCorrupt);
    }).not.toThrow();
    expect(node.contexts).toBeUndefined();
    expect(node.styles).toBeUndefined();
    expect(node.actions).toBeUndefined();
    expect(node.props).toBeUndefined();
    expect(node.interactions).toBeUndefined();
    // identity fields still survive a fully-corrupt structured payload.
    expect(node.id).toBe("node-1");
    expect(node.type).toBe("text");
  });

  it("HAZARD: a literal \"null\" JSON column survives as null, not undefined", () => {
    // safelyParseJSON only returns undefined on a PARSE FAILURE. "null" is VALID
    // JSON, so it parses to the value `null`. Consumers that key off `undefined`
    // to mean "absent/corrupt" will see `null` here instead. Pinned as the live
    // contract (falsy-JSON-literal quirk) so a future change is a deliberate one.
    const node = frameToNode({ ...cleanFrame(), interactions: "null" });
    expect(node.interactions).toBeNull();
    // by contrast the literal "false"/"0"/'""' also survive as their values.
    expect(frameToNode({ ...cleanFrame(), props: "false" }).props).toBe(false);
    expect(frameToNode({ ...cleanFrame(), props: "0" }).props).toBe(0);
    expect(frameToNode({ ...cleanFrame(), props: '""' }).props).toBe("");
  });

  // -- rank coercion hazards ----------------------------------------------------

  it("HAZARD: a non-numeric rank string yields NaN (silently)", () => {
    expect(frameToNode({ ...cleanFrame(), rank: "abc" }).rank).toBeNaN();
  });

  it("HAZARD: an undefined rank yields NaN (parseInt(undefined) === NaN)", () => {
    expect(frameToNode({ ...cleanFrame(), rank: undefined as unknown as string }).rank).toBeNaN();
  });

  it("HAZARD: a number-prefixed rank string is truncated to its leading integer", () => {
    // parseInt stops at the first non-digit: "12px" -> 12, "3.9" -> 3.
    expect(frameToNode({ ...cleanFrame(), rank: "12px" }).rank).toBe(12);
    expect(frameToNode({ ...cleanFrame(), rank: "3.9" }).rank).toBe(3);
    // leading whitespace is tolerated by parseInt.
    expect(frameToNode({ ...cleanFrame(), rank: "  7" }).rank).toBe(7);
  });
});

describe("nodeToFrame (runtime FrameNode -> MDB row, write path)", () => {
  it("preserves the identity fields id/schemaId/name/type/parentId/ref", () => {
    const node: FrameNode = {
      id: "node-9",
      schemaId: "schema-9",
      name: "Node Nine",
      type: "image",
      parentId: "parent-9",
      ref: "ref-9",
      rank: 5,
    };
    const frame = nodeToFrame(node);
    expect(frame.id).toBe("node-9");
    expect(frame.schemaId).toBe("schema-9");
    expect(frame.name).toBe("Node Nine");
    expect(frame.type).toBe("image");
    expect(frame.parentId).toBe("parent-9");
    expect(frame.ref).toBe("ref-9");
  });

  it("serializes each destructured object field back into its JSON column", () => {
    const node: FrameNode = {
      id: "n",
      type: "text",
      rank: 0,
      contexts: { ctxKey: "ctxVal" },
      styles: { color: "blue" },
      actions: { onClick: "go()" },
      props: { p: 1 },
      interactions: { hover: false },
    };
    const frame = nodeToFrame(node);
    expect(frame.contexts).toBe(JSON.stringify({ ctxKey: "ctxVal" }));
    expect(frame.styles).toBe(JSON.stringify({ color: "blue" }));
    expect(frame.actions).toBe(JSON.stringify({ onClick: "go()" }));
    expect(frame.props).toBe(JSON.stringify({ p: 1 }));
    expect(frame.interactions).toBe(JSON.stringify({ hover: false }));
  });

  it("serializes the numeric rank back into a string", () => {
    expect(nodeToFrame({ id: "n", type: "text", rank: 7 }).rank).toBe("7");
    // rank 0 must round-trip to "0" (0 is not nullish, so ?.toString() applies,
    // NOT the "0" fallback — guarding against a falsy-zero coercion bug).
    expect(nodeToFrame({ id: "n", type: "text", rank: 0 }).rank).toBe("0");
  });

  it("falls back schemaId -> id, name -> \"\", rank -> \"0\" when those fields are absent/falsy", () => {
    const minimal: FrameNode = { id: "only-id", type: "container" };
    const frame = nodeToFrame(minimal);
    expect(frame.schemaId).toBe("only-id"); // schemaId || id
    expect(frame.name).toBe(""); // name || ""
    expect(frame.rank).toBe("0"); // rank?.toString() ?? "0"
    // empty-string schemaId is falsy and ALSO falls back to id.
    expect(nodeToFrame({ id: "x", type: "text", schemaId: "" }).schemaId).toBe("x");
  });

  it("emits exactly the canonical 12-key MFrame shape (no derived/extra columns leak through)", () => {
    // Even though a runtime FrameNode carries derived fields (types, propsValue,
    // propsAttrs, icon), nodeToFrame destructures only the five object columns
    // and explicitly rebuilds the MFrame — so types/propsValue/icon must NOT
    // appear on the persisted row. Pins the write-path projection.
    const node: FrameNode = {
      id: "n",
      type: "text",
      rank: 1,
      types: { value: "text" },
      propsValue: { value: "x" },
      propsAttrs: { a: 1 },
      icon: "lucide-star",
    } as FrameNode;
    const frame = nodeToFrame(node);
    expect(Object.keys(frame).sort()).toEqual(
      [
        "actions",
        "contexts",
        "id",
        "interactions",
        "name",
        "parentId",
        "props",
        "rank",
        "ref",
        "schemaId",
        "styles",
        "type",
      ].sort()
    );
    expect(frame).not.toHaveProperty("types");
    expect(frame).not.toHaveProperty("propsValue");
    expect(frame).not.toHaveProperty("propsAttrs");
    expect(frame).not.toHaveProperty("icon");
  });

  it("HAZARD: absent object fields serialize to literal undefined (JSON.stringify(undefined)), not the string \"null\" nor \"\"", () => {
    // JSON.stringify(undefined) === undefined. So a node with no contexts/styles/
    // etc. produces an MFrame whose JSON columns are the VALUE `undefined` (the
    // key is present). Persisted, this depends on the MDB sink dropping undefined
    // columns; pinned so the projection stays predictable.
    const frame = nodeToFrame({ id: "n", type: "container" });
    expect(frame.contexts).toBeUndefined();
    expect(frame.styles).toBeUndefined();
    expect(frame.actions).toBeUndefined();
    expect(frame.props).toBeUndefined();
    expect(frame.interactions).toBeUndefined();
    expect("contexts" in frame).toBe(true); // key present, value undefined
  });
});

describe("round-trip identity (the seam's core contract)", () => {
  it("frameToNode -> nodeToFrame is identity on every serializable MFrame field", () => {
    const frame = cleanFrame();
    const back = nodeToFrame(frameToNode(frame));
    // The re-stringified JSON columns are byte-identical because the source was
    // produced by JSON.stringify of plain objects (stable key order).
    expect(back).toEqual(frame);
  });

  it("the round trip is STABLE under repetition (no drift on a second pass)", () => {
    const frame = cleanFrame();
    const once = nodeToFrame(frameToNode(frame));
    const twice = nodeToFrame(frameToNode(once));
    expect(twice).toEqual(once);
    expect(twice).toEqual(frame);
  });

  it("nodeToFrame -> frameToNode preserves the object fields (reverse round trip)", () => {
    const node: FrameNode = {
      id: "rt",
      schemaId: "rt-s",
      name: "RT",
      type: "image",
      parentId: "rt-p",
      ref: "rt-r",
      rank: 4,
      contexts: { a: 1 },
      styles: { b: 2 },
      actions: { c: 3 },
      props: { d: 4 },
      interactions: { e: 5 },
    };
    const back = frameToNode(nodeToFrame(node));
    expect(back.contexts).toEqual({ a: 1 });
    expect(back.styles).toEqual({ b: 2 });
    expect(back.actions).toEqual({ c: 3 });
    expect(back.props).toEqual({ d: 4 });
    expect(back.interactions).toEqual({ e: 5 });
    expect(back.rank).toBe(4);
    expect(back.id).toBe("rt");
    expect(back.schemaId).toBe("rt-s");
    expect(back.type).toBe("image");
    expect(back.parentId).toBe("rt-p");
    expect(back.ref).toBe("rt-r");
  });

  it("a corrupt-on-disk row that read as undefined re-serializes to undefined (degrade is stable, not crashing)", () => {
    // Corrupt MDB -> frameToNode gives undefined fields -> nodeToFrame writes
    // them straight back as undefined JSON columns without throwing. The seam
    // never amplifies corruption into an exception on the write path either.
    const corrupt: MFrame = { ...cleanFrame(), contexts: "{bad", styles: "]]" };
    const node = frameToNode(corrupt);
    let back!: MFrame;
    expect(() => {
      back = nodeToFrame(node);
    }).not.toThrow();
    expect(back.contexts).toBeUndefined();
    expect(back.styles).toBeUndefined();
    // the still-valid columns round-trip cleanly.
    expect(back.actions).toBe(cleanFrame().actions);
    expect(back.props).toBe(cleanFrame().props);
    expect(back.interactions).toBe(cleanFrame().interactions);
  });
});
