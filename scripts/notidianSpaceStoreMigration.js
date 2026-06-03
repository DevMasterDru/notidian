const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const DEFAULT_VAULT_PATH = "/Users/druker/Atlas Vault";
const DEFAULT_BACKUP_ROOT = path.join(os.tmpdir(), "notidian-space-store-backups");
const SOURCE_STORE_NAME = ".space";
const TARGET_STORE_NAME = ".notidian";
const LEGACY_STORE_NAMES = [SOURCE_STORE_NAME, ".makemd"];

const normalizeRelative = (value) =>
  String(value || "")
    .split(path.sep)
    .join("/");

const relativeToVault = (vaultPath, filePath) =>
  normalizeRelative(path.relative(vaultPath, filePath)) || ".";

const pathParts = (value) =>
  normalizeRelative(value)
    .split("/")
    .filter(Boolean);

const containsBlockedPathName = (value) =>
  pathParts(value).some((part) => {
    const lower = part.toLowerCase();
    return lower.includes("archive") || lower.includes("ignore");
  });

const shouldSkipDirectory = (direntName) =>
  direntName == ".trash" || containsBlockedPathName(direntName);

const pathExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code == "ENOENT") return false;
    throw error;
  }
};

const sameFileContent = async (source, target) => {
  const [sourceBuffer, targetBuffer] = await Promise.all([
    fs.readFile(source),
    fs.readFile(target),
  ]);
  return Buffer.compare(sourceBuffer, targetBuffer) == 0;
};

const rewriteLegacyStorageReferences = (value) => {
  if (typeof value == "string") {
    const rewritten = value
      .split("/")
      .map((part) =>
        LEGACY_STORE_NAMES.includes(part) ? TARGET_STORE_NAME : part
      )
      .join("/");
    return rewritten == value ? value : rewritten;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const rewritten = rewriteLegacyStorageReferences(item);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return changed ? next : value;
  }

  if (value && typeof value == "object") {
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const rewritten = rewriteLegacyStorageReferences(item);
      if (rewritten !== item) changed = true;
      next[key] = rewritten;
    }
    return changed ? next : value;
  }

  return value;
};

const rewriteJsonFileStorageReferences = async (filePath) => {
  if (!filePath.endsWith(".json")) return false;
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    return false;
  }

  const rewritten = rewriteLegacyStorageReferences(parsed);
  if (rewritten === parsed) return false;

  await fs.writeFile(filePath, JSON.stringify(rewritten, null, 2));
  return true;
};

const walkStore = async (storePath, rootPath = storePath) => {
  const entries = await fs.readdir(storePath, { withFileTypes: true });
  const files = [];
  const dirs = [];

  for (const entry of entries) {
    const fullPath = path.join(storePath, entry.name);
    const relativePath = normalizeRelative(path.relative(rootPath, fullPath));
    if (entry.isDirectory()) {
      dirs.push(relativePath);
      const child = await walkStore(fullPath, rootPath);
      dirs.push(...child.dirs);
      files.push(...child.files);
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return { files, dirs };
};

const findSourceStores = async (vaultPath) => {
  const stores = [];

  const visit = async (currentPath) => {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code == "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (shouldSkipDirectory(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      if (entry.name == SOURCE_STORE_NAME) {
        stores.push(fullPath);
        continue;
      }

      await visit(fullPath);
    }
  };

  await visit(vaultPath);
  return stores.sort((a, b) =>
    relativeToVault(vaultPath, a).localeCompare(relativeToVault(vaultPath, b))
  );
};

const buildStorePlan = async ({
  vaultPath,
  source,
  target,
  backup,
}) => {
  const targetExists = await pathExists(target);
  const backupExists = await pathExists(backup);
  const walked = await walkStore(source);
  const filesToCopy = [];
  const dirsToCreate = [];
  const identicalFiles = [];
  const conflicts = [];

  if (backupExists) {
    conflicts.push({
      source,
      target: backup,
      reason: "backup-target-exists",
    });
  }

  for (const dir of walked.dirs) {
    if (!(await pathExists(path.join(target, dir)))) {
      dirsToCreate.push(dir);
    }
  }

  for (const file of walked.files) {
    const sourceFile = path.join(source, file);
    const targetFile = path.join(target, file);
    let targetStat = null;
    try {
      targetStat = await fs.stat(targetFile);
    } catch (error) {
      if (error?.code != "ENOENT") throw error;
    }

    if (!targetStat) {
      filesToCopy.push(file);
      continue;
    }

    const sourceStat = await fs.stat(sourceFile);
    if (!sourceStat.isFile() || !targetStat.isFile()) {
      conflicts.push({
        source: sourceFile,
        target: targetFile,
        reason: "type-conflict",
      });
      continue;
    }

    if (await sameFileContent(sourceFile, targetFile)) {
      identicalFiles.push(file);
      continue;
    }

    conflicts.push({
      source: sourceFile,
      target: targetFile,
      reason: "different-content",
    });
  }

  return {
    source,
    target,
    backup,
    relativeSource: relativeToVault(vaultPath, source),
    relativeTarget: relativeToVault(vaultPath, target),
    relativeBackup: normalizeRelative(path.relative(path.dirname(backup), backup)),
    mode: targetExists ? "merge" : "create",
    filesToCopy,
    dirsToCreate,
    identicalFiles,
    conflicts,
  };
};

const planSpaceStoreMigration = async ({
  vaultPath = DEFAULT_VAULT_PATH,
  backupRoot = DEFAULT_BACKUP_ROOT,
  timestamp = new Date().toISOString().replace(/[:.]/g, "-"),
} = {}) => {
  const resolvedVaultPath = path.resolve(vaultPath);
  const resolvedBackupRoot = path.resolve(backupRoot);
  const sourceStores = await findSourceStores(resolvedVaultPath);
  const stores = [];

  for (const source of sourceStores) {
    const parent = path.dirname(source);
    const target = path.join(parent, TARGET_STORE_NAME);
    const backup = path.join(
      resolvedBackupRoot,
      timestamp,
      normalizeRelative(path.relative(resolvedVaultPath, source))
    );
    stores.push(await buildStorePlan({
      vaultPath: resolvedVaultPath,
      source,
      target,
      backup,
    }));
  }

  const conflicts = stores.flatMap((store) => store.conflicts);
  return {
    ok: conflicts.length == 0,
    vaultPath: resolvedVaultPath,
    backupRoot: resolvedBackupRoot,
    timestamp,
    sourceStoreName: SOURCE_STORE_NAME,
    targetStoreName: TARGET_STORE_NAME,
    stores,
    conflicts,
    summary: {
      storeCount: stores.length,
      filesToCopy: stores.reduce((sum, store) => sum + store.filesToCopy.length, 0),
      dirsToCreate: stores.reduce((sum, store) => sum + store.dirsToCreate.length, 0),
      identicalFiles: stores.reduce((sum, store) => sum + store.identicalFiles.length, 0),
      conflicts: conflicts.length,
    },
  };
};

const executeSpaceStoreMigration = async (plan, options = {}) => {
  if (!options.allowWrite) {
    throw new Error("Refusing to modify the vault without --allow-write.");
  }
  if (!plan.ok) {
    throw new Error("Refusing to migrate because the plan contains conflicts.");
  }

  for (const store of plan.stores) {
    await fs.mkdir(store.target, { recursive: true });

    for (const dir of store.dirsToCreate) {
      await fs.mkdir(path.join(store.target, dir), { recursive: true });
    }

    for (const file of store.filesToCopy) {
      const sourceFile = path.join(store.source, file);
      const targetFile = path.join(store.target, file);
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.copyFile(sourceFile, targetFile, fs.constants.COPYFILE_EXCL);
      await rewriteJsonFileStorageReferences(targetFile);
    }

    for (const file of store.identicalFiles) {
      await rewriteJsonFileStorageReferences(path.join(store.target, file));
    }

    await fs.mkdir(path.dirname(store.backup), { recursive: true });
    await fs.rename(store.source, store.backup);
  }

  return {
    migratedStores: plan.stores.length,
    backupRoot: path.join(plan.backupRoot, plan.timestamp),
  };
};

const parseArgs = (argv = process.argv.slice(2), env = process.env) => {
  const config = {
    vaultPath: env.NOTIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH,
    backupRoot: env.NOTIDIAN_SPACE_BACKUP_ROOT ?? DEFAULT_BACKUP_ROOT,
    allowWrite: false,
    json: false,
  };

  for (const arg of argv) {
    if (arg == "--allow-write") {
      config.allowWrite = true;
      continue;
    }
    if (arg == "--json") {
      config.json = true;
      continue;
    }
    if (arg == "--help" || arg == "-h") {
      config.help = true;
      continue;
    }

    const separator = arg.indexOf("=");
    if (separator < 0) continue;

    const key = arg.slice(0, separator).replace(/^--/, "");
    const value = arg.slice(separator + 1);
    switch (key) {
      case "vault":
      case "vault-path":
        config.vaultPath = value;
        break;
      case "backup-root":
        config.backupRoot = value;
        break;
      case "timestamp":
        config.timestamp = value;
        break;
    }
  }

  return config;
};

const usage = () => [
  "Usage:",
  '  node scripts/notidianSpaceStoreMigration.js --vault-path="/Users/druker/Atlas Vault"',
  '  node scripts/notidianSpaceStoreMigration.js --vault-path="/Users/druker/Atlas Vault" --allow-write',
  "",
  "Options:",
  "  --vault-path=<path>   Vault root. Defaults to NOTIDIAN_VAULT_PATH or /Users/druker/Atlas Vault.",
  "  --backup-root=<path>  External backup root. Defaults to NOTIDIAN_SPACE_BACKUP_ROOT or /tmp/notidian-space-store-backups.",
  "  --timestamp=<value>   Stable backup folder name for repeatable dry-runs.",
  "  --allow-write         Copy data into .notidian and move original .space stores to backup.",
  "  --json                Emit JSON.",
].join("\n");

const formatPlan = (plan, writeResult) => {
  const lines = [];
  lines.push(`${plan.ok ? "OK" : "CONFLICT"} ${plan.summary.storeCount} store(s), ${plan.summary.filesToCopy} file(s) to copy, ${plan.summary.identicalFiles} identical file(s).`);
  for (const store of plan.stores) {
    lines.push(
      `- ${store.relativeSource} -> ${store.relativeTarget} (${store.mode}, ${store.filesToCopy.length} copy, ${store.identicalFiles.length} identical)`
    );
  }
  for (const conflict of plan.conflicts) {
    lines.push(`CONFLICT ${conflict.reason}: ${conflict.source} -> ${conflict.target}`);
  }
  if (writeResult) {
    lines.push(`Migrated ${writeResult.migratedStores} store(s). Backup: ${writeResult.backupRoot}`);
  } else {
    lines.push("Dry run only. Re-run with --allow-write to migrate.");
  }
  return lines.join("\n");
};

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const config = parseArgs(argv, env);
  if (config.help) {
    console.log(usage());
    return;
  }

  try {
    const plan = await planSpaceStoreMigration(config);
    let writeResult = null;
    if (config.allowWrite) {
      writeResult = await executeSpaceStoreMigration(plan, { allowWrite: true });
    }

    if (config.json) {
      console.log(JSON.stringify({ plan, writeResult }, null, 2));
    } else {
      console.log(formatPlan(plan, writeResult));
    }

    if (!plan.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_BACKUP_ROOT,
  DEFAULT_VAULT_PATH,
  SOURCE_STORE_NAME,
  TARGET_STORE_NAME,
  executeSpaceStoreMigration,
  findSourceStores,
  parseArgs,
  planSpaceStoreMigration,
  rewriteLegacyStorageReferences,
};
