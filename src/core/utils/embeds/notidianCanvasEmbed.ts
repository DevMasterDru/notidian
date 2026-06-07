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
): string => {
  const stem = [descriptor.target, descriptor.kind, descriptor.id]
    .join("-")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);

  return stem.length > 0 ? stem : "notidian-embed";
};

export const wrapperPathForNotidianEmbed = (
  descriptor: Pick<NotidianEmbedDescriptor, "target" | "kind" | "id">,
  root = ".notidian/embeds"
): string => `${root}/${safeNotidianEmbedFileStem(descriptor)}.md`;

export const buildNotidianWrapperNote = (
  descriptor: NotidianEmbedDescriptor
): string =>
  [
    "---",
    "notidian_embed_wrapper: true",
    "---",
    "",
    serializeNotidianEmbedBlock(descriptor),
    "",
  ].join("\n");

const nextCanvasPosition = (nodes: JsonCanvasNode[]): { x: number; y: number } => {
  if (nodes.length == 0) return { x: 0, y: 0 };

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
  while (usedIds.has(id)) {
    id = options.idFactory();
  }

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
