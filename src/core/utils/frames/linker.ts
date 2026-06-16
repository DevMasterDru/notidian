import * as acorn from "acorn";
import { AncestorVisitors, ancestor } from "acorn-walk";
import { generate } from "astring";
import { ensureString } from "core/utils/strings";
import { FrameTreeNode } from "shared/types/frameExec";
import { FrameNode, FrameTreeProp } from "shared/types/mframe";



// Matches a leading top-level `return` ONLY at a statement boundary: optional
// leading whitespace, the `return` keyword as a whole word (`\b`), then the
// trailing whitespace before the returned expression. This is deliberately
// anchored (`^`) and word-bounded (`\b`) so an identifier that merely CONTAINS
// the substring "return" (e.g. `myreturn`, `returnX`, `returnable`) or a comment
// line (`// return ...`) is NOT mistaken for a return statement and mutilated.
// (Replaces the prior unanchored `.includes("return")` / `.replace("return ",…)`
// pair — the rename-corruption defect family of Notidian-5tl / 97l / gxx6.)
const TOP_LEVEL_RETURN = /^\s*return\b\s*/;

export const preprocessCode = (code: unknown, oldName: string, newName: string): string => {
  let string;
  let codeBlock: string = ensureString(code);
  const isMultiLine = codeBlock.includes('\n');

  // Detect + strip a leading top-level `return` at a STATEMENT BOUNDARY, for
  // BOTH single-line and multi-line bodies. A frame prop/action of the form
  // `return <expr>` is not legal at the top level of an acorn Program, so we
  // strip the `return` before parsing (renaming the expression) and re-prepend
  // it AFTER a SUCCESSFUL parse. Multi-line keys off the last non-blank line;
  // single-line keys off the whole string (previously skipped — the single-line
  // return was rejected by acorn and silently lost to the `"error"` fallback).
  let hadReturn = false;
  if (isMultiLine) {
      const lines = codeBlock.split('\n').filter(line => line.trim() !== '');
      const last = lines.length - 1;
      if (last >= 0 && TOP_LEVEL_RETURN.test(lines[last])) {
        hadReturn = true;
        lines[last] = lines[last].replace(TOP_LEVEL_RETURN, "");
      }
      codeBlock = lines.join('\n');
  } else if (TOP_LEVEL_RETURN.test(codeBlock)) {
      hadReturn = true;
      codeBlock = codeBlock.replace(TOP_LEVEL_RETURN, "");
  }

  // Brace-wrapped object literals (`{ ... }`) are ambiguous (block vs object), so
  // parenthesize them into an expression for acorn. This runs AFTER the return
  // strip so a single-line `return { oldName: 1 }` is also parenthesized.
  if (codeBlock.startsWith('{') && codeBlock.endsWith('}')) codeBlock = `(${codeBlock})`;

  try {
    const ast = acorn.parse(codeBlock, { ecmaVersion: 2020, locations: true });

    ancestor(ast, {
      //@ts-ignore
      Identifier(node, ancestors: AncestorVisitors) {
        const parent = ancestors[ancestors.length - 2];
        if (parent.type !== 'MemberExpression' || parent.object === node) {
//@ts-ignore
            if (node.name == oldName) {
              //@ts-ignore
                node.name = newName;
            }
        }
    }, 
    Property(node) {
      //@ts-ignore
      if (node.key.type === 'Identifier' && node.key.name === oldName) {
        //@ts-ignore
        node.key.name = newName;
      }
    },
    ObjectExpression(node) {
      //@ts-ignore
      node.properties.forEach(property => {
        //@ts-ignore
        if (property.key.type === 'Identifier' && property.key.name === oldName) {
          //@ts-ignore
          property.key.name = newName;
        }
      });
    }
    });

    if (hadReturn && ast.body.length > 0) {
      // Re-prepend `return ` STRUCTURALLY: the returned expression is the LAST
      // top-level statement (we stripped the leading `return` before parsing).
      // Generating per-statement and prefixing the last one's generated form is
      // correct even when that expression spans multiple printed lines (e.g. a
      // multi-line object literal) — the prior last-PHYSICAL-line surgery placed
      // `return` on the closing `})` of such an expression and corrupted it.
      const head = ast.body
        .slice(0, -1)
        .map((stmt) => generate(stmt).trimEnd());
      const last = `return ${generate(ast.body[ast.body.length - 1]).trimEnd()}`;
      string = [...head, last].join('\n');
    } else {
      string = generate(ast).trimEnd();
    }
  } catch (e){
    console.log(codeBlock, e)
        string = `"error"`
  }

  // NOTE: re-prepend is handled inside the parse-success branch above and keyed
  // off a SUCCESSFUL parse — so the `"error"` fallback is never wrapped into the
  // doubly-wrong `return "error"` when the body fails to parse.
  return string;
}
export const relinkProps = (oldParent: string, newParent: string, node: FrameNode, rootId: string) => {

  return {
    ...node,
    id: node.id == oldParent ? newParent : node.id,
    parentId: node.id == rootId ? node.parentId : node.parentId == oldParent ? newParent : node.parentId,
    ref: node.ref == oldParent ? newParent : node.ref,
    props: Object.keys(node?.props ?? {}).reduce((p, c) => {
      return {
        ...p,
        [c]: preprocessCode(node.props[c], oldParent, newParent),
      };
    },
     node.props),
     actions: Object.keys(node?.actions ?? {}).reduce((p, c) => {
      return {
        ...p,
        [c]: preprocessCode(node.actions[c], oldParent, newParent),
      };
    },
     node.actions),
     styles: Object.keys(node?.styles ?? {}).reduce((p, c) => {
      return {
        ...p,
        [c]: preprocessCode(node.styles[c], oldParent, newParent),
      };
    },
     node.styles),
  };
};

export const linkNodes = (
  parent: FrameNode,
  schemaId: string,
  props: FrameTreeProp,
  flattenedTree: FrameNode[],
  uniqueID: number
): [FrameNode[], number] => {
  //assign IDs and relink props

  const assignIDs = (parent: FrameNode, nodes: FrameNode[]) => {
    const [newNodes, newID] = nodes.reduce<[FrameNode[], number]>((p, c, i) => {
      const [oldNodes, id] = p;
      const newNodeID = c.parentId ? c.id+ id : parent.id;
      const newNode: FrameNode = {
        ...(c.parentId == '' ? parent : oldNodes[i]),
        type: oldNodes[i].type,
        id: newNodeID
      };
      const returnNodes = oldNodes.map(f => f.id != c.id ? relinkProps(c.id, newNodeID, f, parent.id) : relinkProps(c.id, newNodeID, newNode, parent.id));
      return [returnNodes, id + 1];
    }, [nodes, uniqueID]);
    return [newNodes, newID] as [FrameNode[], number];
  };

  // Find the root node in the flattened tree (node with no parentId or empty parentId)
  const flattenedRoot = flattenedTree.find(node => !node.parentId || node.parentId === '');

  // Create newParent with merged styles from the flattened tree's root
  let newParent = schemaId != parent.id ? relinkProps(schemaId, parent.id, parent, parent.id) : parent;

  // Merge styles from the flattened tree's root node
  if (flattenedRoot && flattenedRoot.styles) {
    newParent = {
      ...newParent,
      styles: {
        ...flattenedRoot.styles,
        ...newParent.styles,

      }
    };
  }

  return assignIDs(newParent, flattenedTree);
};


export const linkTreeNodes = (
  parent: FrameTreeNode,
  uniqueID: number
): [FrameTreeNode, number] => {
  //assign IDs and relink props
  const relinkProps = (oldParent: string, newParent: string, treenode: FrameTreeNode) : FrameTreeNode => {

    let children;
    const node = treenode.node;
    if (treenode.children) {
      children = treenode.children.map(child => relinkProps(oldParent, newParent, child));
    }
    return {
      ...treenode,
      children,
      node: {
        ...treenode.node,
      parentId: node.parentId == oldParent ? newParent : node.parentId,
      props: Object.keys(node?.props ?? {}).reduce((p, c) => {
        return {
          ...p,
          [c]: preprocessCode(node.props[c], oldParent, newParent),
        };
      },
       node.props),
       actions: Object.keys(node?.actions ?? {}).reduce((p, c) => {
        return {
          ...p,
          [c]: preprocessCode(node.actions[c], oldParent, newParent),
        };
      },
       node.actions),
       styles: Object.keys(node?.styles ?? {}).reduce((p, c) => {
        return {
          ...p,
          [c]: preprocessCode(node.styles[c], oldParent, newParent),
        };
      },
       node.styles),
    }};
    
  };
  const assignIDs = (parent: FrameTreeNode, node: FrameTreeNode, uniqueID: number): [FrameTreeNode, number] => {
    const assignIDToTree = (parent: FrameTreeNode, node: FrameTreeNode, id: number): [FrameTreeNode, number] => {
        const newNodeID = node.node.parentId ? node.id + id : parent.id;
        let newNode: FrameTreeNode = { ...node, node: {...node.node, id: newNodeID}, id: newNodeID };

        newNode = relinkProps(node.id, newNodeID, newNode)

        if (newNode.children) {
            const [newChildren, newID] = newNode.children.reduce<[FrameTreeNode[], number]>(
                (acc, child, i) => {
                    const [newChild, nextID] = assignIDToTree(newNode, child, id + i + 1);
                    acc[0].push(newChild);
                    return [acc[0], nextID];
                },
                [[], id]
            );
            newNode.children = newChildren;
            id = newID;
        }

        return [newNode, id + 1];
    };
    return assignIDToTree(parent, node, uniqueID);
};

  return assignIDs(parent, parent, uniqueID);
};
