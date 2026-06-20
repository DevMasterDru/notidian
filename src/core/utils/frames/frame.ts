import * as acorn from "acorn";
import { simple } from "acorn-walk";
import _ from "lodash";
import { Superstate } from "makemd-core";
import { defaultFrameSchema } from "schemas/frames";
import { fieldSchema } from "shared/schemas/fields";
import { FrameExecutable, LinkedContext, LinkedNode } from "shared/types/frameExec";
import { DBTables, SpaceTable } from "shared/types/mdb";
import { FrameRoot, FrameTreeProp, MDBFrames, MFrame } from "shared/types/mframe";
import { SpaceInfo } from "shared/types/spaceInfo";
import { deepOmit } from "../objects";
import { flattenToFrameNodes } from "./ast";
import { stringIsConst } from "./frames";
import { relinkProps } from "./linker";
import { nodeToFrame } from "./nodes";

export const executableChanged = (a: FrameExecutable, b: FrameExecutable) => {
  return !_.isEqual(
    deepOmit(a, [
      "execPropsOptions",
      "execProps",
      "execStyles",
      "execActions",
      "parent",
    ]),
    deepOmit(b, [
      "execPropsOptions",
      "execProps",
      "execStyles",
      "execActions",
      "parent",
    ])
  )
}

export const stateChangedForProps = (
  propSetters: string[],
  props: FrameTreeProp,
  newState: FrameTreeProp,
  schemaID: string
) => {
  return propSetters.filter(
    (f) => newState[schemaID]?.props[f] && !_.isEqual(newState[schemaID].props[f], props?.[f])
  );
};

export const parseLinkedPropertyToValue = (property: string) => {
  if (!property || typeof property !== 'string') return null;
  if (property.startsWith("$contexts")) {
    // parseContextNode returns null for any short/malformed `$contexts`-prefixed
    // string (the `path.length < 3` guard, the acorn try/catch, the stringIsConst
    // guard). A bare destructure of that null throws on the render path
    // (`Cannot destructure property 'context' of null`) — frame property strings
    // like `$contexts.ctx` reach here. Optional-chain instead, mirroring the
    // symmetric `linkedNode?.prop` branch below. (bd Notidian-eeoa)
    const linkedContext = parseContextNode(property);
    return linkedContext?.prop;
  } else {
    const linkedNode = parseLinkedNode(property);
    return linkedNode?.prop;
  }
};

export const parseContextNode = (pathString: string) : LinkedContext => {
  // `typeof !== 'string'` makes the guard's intent (reject non-usable input)
  // robust to a non-string slipping past `!pathString` — stringIsConst returns
  // false for non-strings, so without this a number/object would hit
  // `.includes`/`.split` and throw on the render path. (bd Notidian-eeoa)
  if (!pathString || typeof pathString !== 'string' || stringIsConst(pathString)) return null;
  const path : string[] = [];
  const isMultiLine = pathString.includes('\n');
  if (isMultiLine) {
      // If the code block is multi-line, prepend the last line with `return`.
      const lines = pathString.split('\n').filter(line => line.trim() !== '');
      // A multi-line string of ONLY blank lines filters to []; `lines[-1]` is
      // then undefined and `.replace` throws on the render path. Only rewrite
      // the last line when there is one. (bd Notidian-eeoa)
      if (lines.length > 0) {
        lines[lines.length - 1] = `${lines[lines.length - 1].replace("return ", "")}`;
      }
      pathString = lines.join('\n');

  }
  try {
  const ast = acorn.parse(pathString, {ecmaVersion: 2020});
  


  simple(ast, {
      MemberExpression(node) {
        //@ts-ignore
        if (node.object.type === 'Identifier' && !path.includes(node.object.name)) {
          //@ts-ignore
          path.push(node.object.name);
      }
        //@ts-ignore
          if (node.computed) {
              // Handle bracket notation
              // This is simplistic and assumes a simple literal inside brackets
              //@ts-ignore
              path.push(node.property.value);
          } else {
              // Handle dot notation
              //@ts-ignore
              path.push(node.property.name);
          }
      }
  });
} catch  (e){
  }
  if (path.length < 3) return null;
  return {
    context: path[1],
    prop: path[2],
  }
}

export const parseLinkedNode = (pathString: string) : LinkedNode => {
  // See parseContextNode: reject non-strings before `.includes`/`.split` to keep
  // the render path crash-proof. (bd Notidian-eeoa)
  if (!pathString || typeof pathString !== 'string' || stringIsConst(pathString)) return null;
  const path : string[] = [];
  const isMultiLine = pathString.includes('\n');
  if (isMultiLine) {
      // If the code block is multi-line, prepend the last line with `return`.
      const lines = pathString.split('\n').filter(line => line.trim() !== '');
      // Blank-only multi-line input filters to []; guard `lines[-1].replace`.
      // (bd Notidian-eeoa)
      if (lines.length > 0) {
        lines[lines.length - 1] = `${lines[lines.length - 1].replace("return ", "")}`;
      }
      pathString = lines.join('\n');

  }
  try {
  const ast = acorn.parse(pathString, {ecmaVersion: 2020});
  


  simple(ast, {
      MemberExpression(node) {
        //@ts-ignore
        if (node.object.type === 'Identifier' && !path.includes(node.object.name)) {
          //@ts-ignore
          path.push(node.object.name);
      }
        //@ts-ignore
          if (node.computed) {
              // Handle bracket notation
              // This is simplistic and assumes a simple literal inside brackets
              //@ts-ignore
              path.push(node.property.value);
          } else {
              // Handle dot notation
              //@ts-ignore
              path.push(node.property.name);
          }
      }
  });
} catch  (e){
  }
  if (path.length < 3) return null;
  return {
    node: path[0],
    prop: path[2],
  }
}

const saveFrameRoot = async (superstate: Superstate, tableData: SpaceTable, space: SpaceInfo, frameRoot: FrameRoot) => {

  if (!tableData) return;
  
const treeNodes = flattenToFrameNodes(frameRoot, tableData.schema.id);

  const newTable = {
    ...tableData,
    cols: tableData.cols ?? [],
    rows: [
      ...treeNodes,
    ].map((f) => nodeToFrame(relinkProps('$root', tableData.schema.id, f, tableData.schema.id))) as MFrame[],
  };

  await superstate.spaceManager.saveFrame(space.path, newTable)
};

export const replaceFrameWithFrameRoot = async (superstate: Superstate, space: SpaceInfo, schema: string, root: FrameRoot) => {
  
  return superstate.spaceManager
  .readFrame(space.path, schema).then((tagDB) =>
  saveFrameRoot(superstate, tagDB, space, root)
  );

};
export const mdbFrameToDBTables = (tables: MDBFrames, uniques?: { [x: string]: string[]; }): DBTables => {
  return Object.keys(tables).reduce((p, c) => {
    return {
      ...p,
      [c]: {
        uniques: defaultFrameSchema.uniques,
        cols: defaultFrameSchema.cols,
        rows: tables[c].rows
      },
    };
  }, {
    m_fields: {
      uniques: fieldSchema.uniques,
      cols: fieldSchema.cols,
      rows: Object.values(tables).flatMap(f => f.cols),
    }
  }) as DBTables;

};

