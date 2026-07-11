import { nodeToPropValue, nodeToTypes } from "schemas/frames";
import { FrameNode, FrameTreeProp, MFrame } from "shared/types/mframe";
import { safelyParseJSON, scrubPrototypeKeys } from "shared/utils/json";

// bd Notidian-gz66 — defense-in-depth prototype-key scrub at the frame load
// boundary. Every code-bearing map here is parsed with safelyParseJSON = JSON.parse,
// which revives an own "__proto__"/"constructor"/"prototype" key from persisted
// (attacker-reachable) columns; scrubPrototypeKeys strips those own keys so they can
// never reach buildExecutable / the runner's .call() sink (see json.ts for the full
// chain). Applied to exactly the five safelyParseJSON outputs — types/propsValue are
// derived from the controlled `frame.type` string via nodeToTypes/nodeToPropValue
// (no JSON.parse, object-literal keys only), so they cannot carry a revived key and
// are not part of this attack surface. This changes no other safelyParseJSON caller.
const parseFrameMap = (json: string): FrameTreeProp =>
  scrubPrototypeKeys(safelyParseJSON(json));

export const frameToNode = (frame: MFrame): FrameNode => {
  return {
    ...frame,
    rank: parseInt(frame.rank),
    contexts: parseFrameMap(frame.contexts),
    styles: parseFrameMap(frame.styles),
    actions: parseFrameMap(frame.actions),
    props: parseFrameMap(frame.props),
    types: nodeToTypes(frame.type),
    propsValue: nodeToPropValue(frame.type),
    interactions: parseFrameMap(frame.interactions),
  } as FrameNode;
};
export const nodeToFrame = (node: FrameNode): MFrame => {
  const { contexts, styles, props, actions, interactions, ...otherProps } = node;
  return {
    id: node.id,
    schemaId: node.schemaId || node.id,
    name: node.name || "",
    type: node.type,
    parentId: node.parentId,
    rank: node.rank?.toString() ?? "0",
    ref: node.ref,
    contexts: JSON.stringify(contexts),
    styles: JSON.stringify(styles),
    actions: JSON.stringify(actions),
    props: JSON.stringify(props),
    interactions: JSON.stringify(interactions),
  };
};

export const mergePropObjects = (
  obj1: FrameTreeProp,
  obj2: FrameTreeProp
): FrameTreeProp => {
  const mergedObject: FrameTreeProp = { ...obj1, ...obj2 };

  for (const key in obj2) {
    if (obj2[key] === null) {
      delete mergedObject[key];
    }
  }
  return mergedObject;
};