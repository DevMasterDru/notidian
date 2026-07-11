// bd Notidian-it0j — frame ROOT-prop / context-column TYPE-collision runtime
// divergence (the distinct RUNTIME layer under the sy30/9xbn FINGERPRINT fixes,
// which are closed by cb0c196 and stay untouched here).
//
// MECHANISM (root cause, confirmed): a stored, NON-EMPTY root frame prop whose
// NAME collides with a space CONTEXT column of type 'object-multi' (or 'object')
// inherits that injected type ONLY on the EDITABLE topology — linkProps is fed
// [...tableData.cols, ...props.cols] there (FrameEditorRootContext.initiateRoot)
// but frame.cols on the READ topology (buildRootFromMDBFrame / note embed), and
// only the editable field set contains the colliding column. linkProps folds the
// injected col TYPE onto the root (`types: {...injectedColTypes, ...root types}`;
// the stored root has NO own type for this prop, so the injected one wins). Then
// executable.ts generateCodeForProp keys `isObject` off
// `type?.startsWith('object') && objectIsConst(codeBlock, type)`. For a MULTI-LINE
// array-literal value ('[\n1,\n2\n]'):
//   editable (type 'object-multi'): isObject=true  -> EXPRESSION form -> returns [1,2]
//   read     (type undefined):      isObject=false -> STATEMENT   form -> returns undefined
// So the SAME stored prop renders the array on the editable surface and undefined
// on the read/embed surface.
//
// FIX (owner triage option b, the CONTAINED one — no worker design judgment about
// which result is "correct"): make execution IGNORE injected context-column types
// on NON-COLUMN root props (a root prop the node already owns with a non-empty
// authored value and no own type), so both topologies type the prop IDENTICALLY
// (undefined) and execute IDENTICALLY. Gated behind the default-OFF kill-switch
// `settings.frameRootTypeConsistency`; OFF preserves byte-for-byte legacy
// (divergent) behavior.
//
// This suite drives the two SHARED seams the render paths converge on — linkProps
// (ast.ts, the type-basis fold) and buildExecutable (executable.ts, the compiler)
// — with the EDITABLE vs READ field sets and the flag OFF vs ON, exactly as the
// two topologies do at runtime.
import { SpaceProperty } from "shared/types/mdb";
import { FrameExecutable, FrameTreeNode } from "shared/types/frameExec";
import { FrameNode } from "shared/types/mframe";
import { linkProps } from "./ast";
import { buildExecutable } from "./executable";

// A root FrameTreeNode the way a render path holds it BEFORE linkProps folds the
// injected context columns in: one stored, code-bearing root prop `hero`, plus any
// author-supplied own types. linkProps then injects the topology's columns.
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

// The editable space view injects the FULL context table — here it contains a
// column named `hero` typed object-multi that COLLIDES with the stored root prop.
// The read surface injects frame.cols only, which does NOT contain `hero`.
const EDITABLE_COLS: SpaceProperty[] = [
  col("hero", "object-multi"),
  col("Status", "text"),
  col("Priority", "number"),
];
const READ_COLS: SpaceProperty[] = [col("Status", "text")];

// A multi-line array literal — the exact value shape that reaches the divergent
// generateCodeForProp branch (multi-line + '['-leading, not paren-wrapped).
const MULTILINE_ARRAY = "[\n1,\n2\n]";
// A multi-line object literal — paren-wrapped at generateCodeForProp:10 FIRST, so
// it is type-INDEPENDENT and must stay unchanged by this fix.
const MULTILINE_OBJECT = '{\n"a": 1\n}';

// Compile the root through buildExecutable exactly as the runner does and evaluate
// the `hero` prop. The compiled prop is `new Function("with(this){ ... }")`; call
// it with an empty scope (the literal references no identifiers).
const runHero = (linked: FrameTreeNode): unknown => {
  const exec = buildExecutable(linked) as FrameExecutable;
  const fn = (exec.execProps as Record<string, () => unknown>).hero;
  return fn.call({});
};

const typeOfHero = (linked: FrameTreeNode): string | undefined =>
  linked.node.types?.hero;

describe("Notidian-it0j: root-prop / context-column TYPE-collision runtime divergence", () => {
  describe("multi-line ARRAY literal colliding with an object-multi column", () => {
    it("flag OFF: preserves the LEGACY divergence (editable=[1,2], read=undefined)", () => {
      const editable = linkProps(EDITABLE_COLS, makeRoot(MULTILINE_ARRAY), false);
      const read = linkProps(READ_COLS, makeRoot(MULTILINE_ARRAY), false);

      // The type basis itself diverges by topology on the legacy path.
      expect(typeOfHero(editable)).toBe("object-multi");
      expect(typeOfHero(read)).toBeUndefined();

      const editableResult = runHero(editable);
      const readResult = runHero(read);

      expect(editableResult).toEqual([1, 2]); // expression form
      expect(readResult).toBeUndefined(); // statement form
      // The defect, pinned: SAME stored prop, DIFFERENT result across topology.
      expect(editableResult).not.toEqual(readResult);
    });

    it("flag ON: normalizes the type basis so BOTH topologies execute IDENTICALLY", () => {
      const editable = linkProps(EDITABLE_COLS, makeRoot(MULTILINE_ARRAY), true);
      const read = linkProps(READ_COLS, makeRoot(MULTILINE_ARRAY), true);

      // The injected object-multi type is IGNORED on the editable path for this
      // non-column root prop, so both topologies leave `hero` untyped.
      expect(typeOfHero(editable)).toBeUndefined();
      expect(typeOfHero(read)).toBeUndefined();

      const editableResult = runHero(editable);
      const readResult = runHero(read);

      // Identical execution on both topologies — the acceptance criterion.
      expect(editableResult).toEqual(readResult);
      expect(editableResult).toBeUndefined();
    });
  });

  describe("multi-line OBJECT literal ({...}) stays TYPE-INDEPENDENT (unchanged)", () => {
    // Object literals are paren-wrapped BEFORE the type check, forcing the
    // expression form regardless of type — so they never reached the divergent
    // branch and must not be perturbed by the fix, flag ON or OFF.
    const OBJECT_COLS: SpaceProperty[] = [
      col("hero", "object"),
      col("Status", "text"),
    ];

    it.each([false, true])(
      "flag=%s: editable and read both return the object on both topologies",
      (flag) => {
        const editable = runHero(
          linkProps(OBJECT_COLS, makeRoot(MULTILINE_OBJECT), flag)
        );
        const read = runHero(
          linkProps(READ_COLS, makeRoot(MULTILINE_OBJECT), flag)
        );
        expect(editable).toEqual({ a: 1 });
        expect(read).toEqual({ a: 1 });
        expect(editable).toEqual(read);
      }
    );
  });

  describe("fix is SURGICAL — only non-column authored props lose the injected type", () => {
    it("flag ON: a GENUINE column binding (empty root value) STILL inherits the injected type", () => {
      // A root prop with an EMPTY stored value IS the column binding (not authored
      // code); it must keep the injected object-multi type even with the flag ON.
      const genuine = linkProps(EDITABLE_COLS, makeRoot(""), true);
      expect(genuine.node.types?.hero).toBe("object-multi");
    });

    it("flag ON: a root prop with its OWN type is unaffected (own type always wins)", () => {
      // If the author typed the root prop themselves, that type wins on BOTH
      // topologies already (no divergence) — the fix must leave it intact.
      const editable = linkProps(
        EDITABLE_COLS,
        makeRoot(MULTILINE_ARRAY, { hero: "text" }),
        true
      );
      const read = linkProps(
        READ_COLS,
        makeRoot(MULTILINE_ARRAY, { hero: "text" }),
        true
      );
      expect(editable.node.types?.hero).toBe("text");
      expect(read.node.types?.hero).toBe("text");
    });

    it("flag ON: non-colliding injected columns keep their types (no over-skip)", () => {
      // Only the colliding `hero` type is dropped; Status/Priority are real,
      // non-authored column bindings and must retain their injected types.
      const editable = linkProps(EDITABLE_COLS, makeRoot(MULTILINE_ARRAY), true);
      expect(editable.node.types?.Status).toBe("text");
      expect(editable.node.types?.Priority).toBe("number");
      // The stored value is preserved regardless (linkProps never drops values).
      expect(editable.node.props?.hero).toBe(MULTILINE_ARRAY);
    });
  });
});
