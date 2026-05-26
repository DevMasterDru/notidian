import { SpaceTable } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";
import {
  BaseDocument,
  BaseUnsupportedFeature,
  notidianTableToBaseDocument,
  serializeBaseDocumentToYaml,
} from "./notidianBaseAdapter";

export type BaseExportPreview = {
  folderPath: string;
  outputPath: string;
  document: BaseDocument;
  yaml: string;
  unsupported: BaseUnsupportedFeature[];
};

export type BuildBaseExportPreviewOptions = {
  folderPath: string;
  outputPath: string;
  table: SpaceTable;
  predicate?: Predicate;
  viewName?: string;
};

export type WriteBaseExportFileOptions = {
  folderPath: string;
  table: SpaceTable;
  predicate?: Predicate;
  viewName?: string;
  pathExists: (path: string) => Promise<boolean> | boolean;
  writeText: (path: string, content: string) => Promise<void> | void;
};

const basename = (path: string): string => {
  const cleaned = path.replace(/\/+$/, "");
  const slash = cleaned.lastIndexOf("/");
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
};

const parentPath = (path: string): string => {
  const cleaned = path.replace(/\/+$/, "");
  const slash = cleaned.lastIndexOf("/");
  return slash === -1 ? "" : cleaned.slice(0, slash);
};

export const defaultBaseExportPathForFolder = (folderPath: string): string => {
  const name = basename(folderPath) || "Vault";
  const parent = parentPath(folderPath);
  return parent ? `${parent}/${name}.base` : `${name}.base`;
};

const numberedBaseExportPathForFolder = (
  folderPath: string,
  index: number
): string => {
  const name = basename(folderPath) || "Vault";
  const parent = parentPath(folderPath);
  const filename = index === 0 ? `${name}.base` : `${name} ${index}.base`;
  return parent ? `${parent}/${filename}` : filename;
};

export const uniqueBaseExportPathForFolder = async (
  folderPath: string,
  pathExists: (path: string) => Promise<boolean> | boolean
): Promise<string> => {
  for (let index = 0; index < 1000; index += 1) {
    const candidate = numberedBaseExportPathForFolder(folderPath, index);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("Unable to find an available .base export path.");
};

export const buildBaseExportPreview = (
  options: BuildBaseExportPreviewOptions
): BaseExportPreview => {
  const result = notidianTableToBaseDocument(options.table, {
    folder: options.folderPath,
    predicate: options.predicate,
    viewName: options.viewName,
  });
  return {
    folderPath: options.folderPath,
    outputPath: options.outputPath,
    document: result.document,
    yaml: serializeBaseDocumentToYaml(result.document),
    unsupported: result.unsupported,
  };
};

export const writeBaseExportFile = async (
  options: WriteBaseExportFileOptions
): Promise<BaseExportPreview> => {
  const outputPath = await uniqueBaseExportPathForFolder(
    options.folderPath,
    options.pathExists
  );
  const preview = buildBaseExportPreview({
    folderPath: options.folderPath,
    outputPath,
    table: options.table,
    predicate: options.predicate,
    viewName: options.viewName,
  });
  await options.writeText(preview.outputPath, preview.yaml);
  return preview;
};
