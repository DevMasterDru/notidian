
import { serializeNotidianEmbedBlock } from "core/utils/embeds/notidianEmbed";
import type { NotidianEmbedDescriptor } from "core/utils/embeds/notidianEmbed";
import { SpaceState } from "shared/types/PathState";

const embedTargetForSpace = (space: SpaceState) =>
  space.type == "vault" ? "/" : space.path;

export const framePathForSpace = (space: SpaceState, schema: string) => {
  if (space.type == 'folder') {
    return `${space.path}/#*${schema}`
  }
  if (space.type == 'vault') {
    return `/#*${schema}`
  }
  return `${space.path}/#*${schema}`
}

export const actionPathForSpace = (space: SpaceState, schema: string) => {
  if (space.type == 'folder') {
    return `${space.path}/#;${schema}`
  }
  if (space.type == 'vault') {
    return `/#;${schema}`
  }
  return `${space.path}/#;${schema}`
}

export const contextPathForSpace = (space: SpaceState, schema: string) => {
  if (space.type == 'folder') {
    return `${space.path}/#^${schema}`
  }
  if (space.type == 'vault') {
    return `/#^${schema}`
  }
  return `${space.path}/#^${schema}`
}

export const contextViewEmbedStringFromContext = (space: SpaceState, schema: string) => `![![${framePathForSpace(space, schema)}]]`

export const contextEmbedStringFromContext = (space: SpaceState, schema: string) => `![![${contextPathForSpace(space, schema)}]]`

export const notidianEmbedBlockFromParts = (
  descriptor: NotidianEmbedDescriptor
) => serializeNotidianEmbedBlock(descriptor);

export const notidianTableEmbedBlockFromContext = (
  space: SpaceState,
  schema: string
) =>
  notidianEmbedBlockFromParts({
    target: embedTargetForSpace(space),
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
    target: embedTargetForSpace(space),
    kind: "view",
    id: schema,
    title: true,
    editable: false,
  });

