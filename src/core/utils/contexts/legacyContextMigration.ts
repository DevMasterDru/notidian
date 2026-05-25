import { SpaceProperty, SpaceTable } from "shared/types/mdb";

const core = require("./legacyContextMigrationCore");

export type LegacyContextColumnCategory =
  | "file"
  | "computed"
  | "already-frontmatter"
  | "frontmatter-candidate"
  | "context-only";

export type LegacyContextValueState =
  | "matching"
  | "context-only-value"
  | "frontmatter-only-value"
  | "conflict"
  | "empty";

export type LegacyContextValueIssue = {
  columnName: string;
  rowIndex: number;
  path: string;
  state: LegacyContextValueState;
  contextValue?: string;
  frontmatterValue?: string;
};

export type LegacyContextColumnClassification = {
  columnName: string;
  column: SpaceProperty;
  category: LegacyContextColumnCategory;
  observedFrontmatterCount: number;
  valueIssues: LegacyContextValueIssue[];
};

export type LegacyContextAudit = {
  tableSchemaId: string;
  columns: LegacyContextColumnClassification[];
  valueIssues: LegacyContextValueIssue[];
  blockingIssues: LegacyContextValueIssue[];
  discoveredFrontmatterColumns: SpaceProperty[];
};

export type LegacyContextMigrationPlan = {
  canApplyAutomatically: boolean;
  columnsToMarkFrontmatter: string[];
  columnsToStripFromRows: string[];
  columnsToAdd: SpaceProperty[];
  preservedContextColumns: string[];
  blockingIssues: LegacyContextValueIssue[];
  valueIssues: LegacyContextValueIssue[];
};

export type LegacyContextAuditParams = {
  table: SpaceTable;
  frontmatterByPath:
    | Record<string, Record<string, unknown>>
    | Map<string, Record<string, unknown>>;
  schemaId?: string;
  excludedFrontmatterKeys?: Iterable<string>;
};

export const auditLegacyContextTable: (
  params: LegacyContextAuditParams
) => LegacyContextAudit = core.auditLegacyContextTable;

export const createLegacyContextMigrationPlan: (
  audit: LegacyContextAudit
) => LegacyContextMigrationPlan = core.createLegacyContextMigrationPlan;

export const applyLegacyContextMigrationPlan: (
  table: SpaceTable,
  plan: LegacyContextMigrationPlan
) => SpaceTable = core.applyLegacyContextMigrationPlan;
