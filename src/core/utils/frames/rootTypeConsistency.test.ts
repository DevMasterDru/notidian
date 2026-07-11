// bd Notidian-it0j (REOPENED) — frame ROOT-prop / context-column TYPE-collision
// runtime divergence, and the REGRESSION GUARD for the reverted
// `frameRootTypeConsistency` attempt.
//
// BACKGROUND. linkProps (ast.ts) folds an injected context-column set (`fields`)
// onto the frame root. The two render topologies feed it DIFFERENT roots:
//   • EDITABLE (FrameEditorRootContext): root.node.types is PINNED to tableData.cols
//     (line 124 reduces the whole context table into the root's own `types`), and
//     fields = [...tableData.cols, ...props.cols].
//   • READ / embed (buildRootFromMDBFrame → frameToNode): root.node.types is {}
//     (nodeToTypes('group') === {}), and fields = frame.cols.
// executable.ts generateCodeForProp keys `isObject` off `type?.startsWith('object')
// && objectIsConst(...)`. For a MULTI-LINE array literal ('[\n1,\n2\n]') an
// object-multi/object type picks the EXPRESSION form (returns the array) while an
// undefined type picks the STATEMENT form (returns undefined).
//
// THE REVERTED FIX added a per-prop skip keyed on `root.node.types?.[name] == null`.
// Because that signal is TOPOLOGY-DEPENDENT (pinned on editable, {} on read), it
// FIRED ON THE READ PATH ONLY for a genuine frame-own column that also holds an
// authored value — turning a case that was CONSISTENT under legacy (both surfaces
// return the array) into a DIVERGENT one (editable array, read undefined): the exact
// defect class the flag claimed to remove (reviewer CASE2). It was reverted because
// CASE1-editable and CASE2-read feed linkProps BYTE-IDENTICAL per-prop inputs, so no
// linkProps-local rule can fix one without breaking the other — the type BASIS must
// be equalized at the field-set prep level (owner triage), not here.
//
// This suite pins the LEGACY behavior and, above all, GUARDS the CASE2 invariant so a
// future re-attempt at this seam cannot silently reintroduce the read-path divergence.
import { SpaceProperty } from "shared/types/mdb";
import { FrameExecutable, FrameTreeNode } from "shared/types/frameExec";
import { FrameNode } from "shared/types/mframe";
import { linkProps } from "./ast";
import { buildExecutable } from "./executable";

// A root FrameTreeNode as a render path holds it BEFORE linkProps folds the injected
// columns in: one stored, code-bearing root prop `hero`, plus the root's OWN `types`
// map — which the EDITABLE topology pre-pins and the READ topology leaves empty.
const makeRoot = (
  heroValue: string,
  ownTypes: Record<string, string> = {}
): FrameTreeNode => {
  const node: FrameNode = {
    id: "main",
    schemaId: "s1",
    name: "main",
    type: "group",
    rank: 0,
    props: { hero: heroValue },
    styles: {},
    actions: {},
    types: ownTypes,
  };
  return {
    id: "main",
    node,
    isRef: false,
    children: [],
    editorProps: { editMode: 0 },
    parent: null,
  };
};

const col = (name: string, type: string): SpaceProperty => ({
  name,
  schemaId: "s1",
  type,
});

// A multi-line array literal — the exact value shape that reaches the divergent
// generateCodeForProp branch (multi-line + '['-leading, not paren-wrapped).
const MULTILINE_ARRAY = "[\n1,\n2\n]";
// A multi-line object literal — paren-wrapped at generateCodeForProp:10 FIRST, so it
// is type-INDEPENDENT (always the expression form) and never diverged.
const MULTILINE_OBJECT = '{\n"a": 1\n}';

const runHero = (linked: FrameTreeNode): unknown => {
  const exec = buildExecutable(linked) as FrameExecutable;
  const fn = (exec.execProps as Record<string, () => unknown>).hero;
  return fn.call({});
};
const typeOfHero = (linked: FrameTreeNode): string | undefined =>
  linked.node.types?.hero;

describe("Notidian-it0j: frame root-prop / context-column TYPE-collision (legacy fold)", () => {
  // GUARD (the invariant the reverted flag violated). When `hero` IS a column in the
  // field set — a genuine frame-own column, present on BOTH topologies — linkProps
  // must fold its type onto the root IDENTICALLY whether the root's OWN `types` map
  // arrives empty (read) or pre-pinned (editable). If a future change makes the fold
  // depend on root.node.types again, this fails.
  describe("CASE2 — genuine frame-own column collision stays TOPOLOGY-CONSISTENT", () => {
    // `hero` is present in the field set on both surfaces (a real frame column).
    const FIELDS: SpaceProperty[] = [
      col("hero", "object-multi"),
      col("Status", "text"),
    ];

    it("types `hero` identically regardless of the root's own-types map", () => {
      const readShape = linkProps(FIELDS, makeRoot(MULTILINE_ARRAY, {}));
      const editableShape = linkProps(
        FIELDS,
        makeRoot(MULTILINE_ARRAY, { hero: "object-multi" }) // FrameEditorRootContext pin
      );
      // The folded type basis does NOT depend on the pinned own-types map.
      expect(typeOfHero(readShape)).toBe("object-multi");
      expect(typeOfHero(editableShape)).toBe("object-multi");
    });

    it("executes identically on both topologies (both return the array)", () => {
      const readResult = runHero(linkProps(FIELDS, makeRoot(MULTILINE_ARRAY, {})));
      const editableResult = runHero(
        linkProps(FIELDS, makeRoot(MULTILINE_ARRAY, { hero: "object-multi" }))
      );
      expect(readResult).toEqual([1, 2]);
      expect(editableResult).toEqual([1, 2]);
      // Consistency is the whole point — the reverted flag made these DIFFER.
      expect(editableResult).toEqual(readResult);
    });
  });

  // The ORIGINAL, PRE-EXISTING divergence (reviewer CASE1): a root prop colliding
  // with a SPACE context column that is injected on the editable field set only
  // (props.cols) and absent from the read field set (frame.cols). This is NOT fixed
  // here — it is documented as the known legacy state tracked by the reopened bead;
  // the authoritative fix (owner triage) equalizes the type basis at field-set prep.
  describe("CASE1 — space-context-column-only collision: KNOWN legacy divergence", () => {
    const EDITABLE_COLS: SpaceProperty[] = [
      col("hero", "object-multi"), // injected via props.cols — editable only
      col("Status", "text"),
    ];
    const READ_COLS: SpaceProperty[] = [col("Status", "text")]; // frame.cols: no `hero`

    it("editable types + returns the array; read is untyped + returns undefined", () => {
      const editable = linkProps(EDITABLE_COLS, makeRoot(MULTILINE_ARRAY));
      const read = linkProps(READ_COLS, makeRoot(MULTILINE_ARRAY));

      expect(typeOfHero(editable)).toBe("object-multi");
      expect(typeOfHero(read)).toBeUndefined();

      const editableResult = runHero(editable);
      const readResult = runHero(read);
      expect(editableResult).toEqual([1, 2]); // expression form
      expect(readResult).toBeUndefined(); // statement form
      // Pinned so a future fix that closes it is INTENTIONAL and updates this test.
      expect(editableResult).not.toEqual(readResult);
    });
  });

  // Object literals ({...}) are paren-wrapped BEFORE the type check, so they take the
  // expression form regardless of type — they never reached the divergent branch.
  describe("object literal ({...}) is TYPE-INDEPENDENT on every topology", () => {
    const OBJECT_COLS: SpaceProperty[] = [
      col("hero", "object"),
      col("Status", "text"),
    ];
    const READ_COLS: SpaceProperty[] = [col("Status", "text")];

    it("returns the object on both the editable and read surfaces", () => {
      const editable = runHero(linkProps(OBJECT_COLS, makeRoot(MULTILINE_OBJECT)));
      const read = runHero(linkProps(READ_COLS, makeRoot(MULTILINE_OBJECT)));
      expect(editable).toEqual({ a: 1 });
      expect(read).toEqual({ a: 1 });
      expect(editable).toEqual(read);
    });
  });

  // linkProps never drops stored values or non-colliding column types.
  describe("fold is otherwise faithful", () => {
    const FIELDS: SpaceProperty[] = [
      col("hero", "object-multi"),
      col("Status", "text"),
      col("Priority", "number"),
    ];
    it("keeps non-colliding column types and the stored root value", () => {
      const linked = linkProps(FIELDS, makeRoot(MULTILINE_ARRAY));
      expect(linked.node.types?.Status).toBe("text");
      expect(linked.node.types?.Priority).toBe("number");
      expect(linked.node.props?.hero).toBe(MULTILINE_ARRAY);
    });
  });
});
