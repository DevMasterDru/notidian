#!/usr/bin/env node
// One falsifiable command for the deploy -> reload -> live-verify loop (ADR 0051).
//
// WHY THIS EXISTS: "committed + gates-green" (npm test / tsc / build) is NOT
// "deployed + reloaded + owner-can-see". `npm run build` writes manifest.json/
// main.js/styles.css to the REPO ROOT only; it never touches the vault plugin
// dir. Landing a build in the running Obsidian used to take two more skip-prone
// manual acts (install:vault --allow-write, then a plugin reload), so render-path
// features shipped gate-green that the owner never saw. This collapses the whole
// recipe into one command with a fail-loud parity gate.
//
// THE CLI BINARY IS LITERALLY `obsidian` (NOT "obsidian-cli"). It lives at
// /opt/homebrew/bin/obsidian and `obsidian version` reports it. "obsidian-cli" is
// a SKILL title, not a binary — a single empty `which obsidian-cli` is never
// proof the tool is absent (ADR 0051 / Atlas Standards: resolve a capability
// through its skill, never guess the binary from the skill's name).
//
// Usage:
//   npm run deploy:vault                       # build, install, reload, verify
//   npm run deploy:vault -- --no-build         # deploy the existing build
//   npm run deploy:vault -- --no-reload        # install only (Obsidian closed)
//   npm run deploy:vault -- --verify-only      # FAIL if installed != built (no writes)
//   npm run deploy:vault -- --vault-path="/path/to/Vault"
//   npm run deploy:vault -- --obsidian-command-timeout-ms=20000

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, execFileSync } = require("child_process");
const { installPluginToVault } = require("./notidianInstallToVault");

const DEFAULT_VAULT_PATH = "/Users/druker/Atlas Vault";
const DEFAULT_PLUGIN_ID = "notidian";
const DEFAULT_OBSIDIAN_COMMAND_TIMEOUT_MS = 20000;
const ARTIFACTS = ["manifest.json", "main.js", "styles.css"];

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseArgs = (argv, env) => {
  const cfg = {
    // Prefer the env override once set; otherwise the known vault. Printed below
    // before any write so a wrong-vault clobber can never happen silently.
    vaultPath: env.NOTIDIAN_VAULT_PATH || DEFAULT_VAULT_PATH,
    pluginId: DEFAULT_PLUGIN_ID,
    sourceDir: process.cwd(),
    build: true,
    reload: true,
    verifyOnly: false,
    obsidianCommandTimeoutMs: parsePositiveInteger(
      env.NOTIDIAN_OBSIDIAN_COMMAND_TIMEOUT_MS,
      DEFAULT_OBSIDIAN_COMMAND_TIMEOUT_MS
    ),
  };
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    const key = (eq >= 0 ? arg.slice(0, eq) : arg).replace(/^--/, "");
    const value = eq >= 0 ? arg.slice(eq + 1) : "";
    switch (key) {
      case "vault-path":
      case "vault":
        cfg.vaultPath = value;
        break;
      case "plugin-id":
        cfg.pluginId = value;
        break;
      case "source-dir":
        cfg.sourceDir = value;
        break;
      case "no-build":
        cfg.build = false;
        break;
      case "no-reload":
        cfg.reload = false;
        break;
      case "verify-only":
        cfg.verifyOnly = true;
        break;
      case "obsidian-command-timeout-ms":
        cfg.obsidianCommandTimeoutMs = parsePositiveInteger(
          value,
          cfg.obsidianCommandTimeoutMs
        );
        break;
      default:
        break;
    }
  }
  return cfg;
};

const sha = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// Byte-hash parity: the installed plugin bytes MUST equal the freshly built
// bytes. Stronger than the version-string check in health:audit — it catches a
// content change with NO version bump, and a deploy that silently no-op'd.
const parityMismatches = (sourceDir, targetDir) => {
  const out = [];
  for (const a of ARTIFACTS) {
    const builtP = path.join(sourceDir, a);
    const installedP = path.join(targetDir, a);
    try {
      if (sha(builtP) !== sha(installedP)) out.push(a);
    } catch (e) {
      out.push(`${a} (${e.code || e.message})`);
    }
  }
  return out;
};

const targetDirFor = (vaultPath, pluginId) =>
  path.join(vaultPath, ".obsidian", "plugins", pluginId);

// The binary is `obsidian`. A login-interactive shell resolves the homebrew PATH
// the same way an interactive terminal does (a non-interactive shell may miss it).
const runObsidian = (args, timeoutMs) =>
  execFileSync("zsh", ["-ilc", `obsidian ${args}`], {
    encoding: "utf8",
    timeout: parsePositiveInteger(
      timeoutMs,
      DEFAULT_OBSIDIAN_COMMAND_TIMEOUT_MS
    ),
  });

const main = async () => {
  const cfg = parseArgs(process.argv.slice(2), process.env);
  const targetDir = targetDirFor(cfg.vaultPath, cfg.pluginId);
  console.log(`[deploy:vault] vault: ${cfg.vaultPath}`);
  console.log(`[deploy:vault] plugin: ${cfg.pluginId}  source: ${cfg.sourceDir}`);

  if (cfg.verifyOnly) {
    const mism = parityMismatches(cfg.sourceDir, targetDir);
    if (mism.length) {
      console.error(
        `[deploy:vault] STALE: installed != built for: ${mism.join(", ")}. ` +
          `Run \`npm run deploy:vault\` to land the current build.`
      );
      process.exit(1);
    }
    console.log(`[deploy:vault] parity OK — vault is current (${ARTIFACTS.join(", ")})`);
    return;
  }

  if (cfg.build) {
    console.log("[deploy:vault] building (npm run build)...");
    execSync("npm run build", { cwd: cfg.sourceDir, stdio: "inherit" });
  } else {
    console.log("[deploy:vault] --no-build: using existing build artifacts");
  }

  await installPluginToVault({
    sourceDir: cfg.sourceDir,
    vaultPath: cfg.vaultPath,
    pluginId: cfg.pluginId,
    allowWrite: true, // forced: the deploy must never silently no-op
  });
  console.log(`[deploy:vault] installed to ${targetDir}`);

  const mism = parityMismatches(cfg.sourceDir, targetDir);
  if (mism.length) {
    console.error(
      `[deploy:vault] FAIL: installed bytes != built bytes for: ${mism.join(", ")}`
    );
    process.exit(1);
  }
  console.log(`[deploy:vault] byte-hash parity OK (${ARTIFACTS.join(", ")})`);

  if (cfg.reload) {
    try {
      const out = runObsidian(
        `plugin:reload id=${cfg.pluginId}`,
        cfg.obsidianCommandTimeoutMs
      );
      console.log(`[deploy:vault] reloaded: ${out.trim()}`);
    } catch (e) {
      console.error(
        "[deploy:vault] FAIL: `obsidian plugin:reload` failed or timed out — is Obsidian open? " +
          "The build IS installed and will load on next Obsidian start. " +
          (e.stderr ? String(e.stderr).trim() : e.message || "")
      );
      process.exit(2);
    }
    // Best-effort: surface any captured plugin errors (non-fatal).
    try {
      const errs = runObsidian(
        "dev:errors limit=20",
        cfg.obsidianCommandTimeoutMs
      ).trim();
      console.log(`[deploy:vault] obsidian dev:errors:\n${errs || "(none)"}`);
    } catch (e) {
      console.log(
        `[deploy:vault] (dev:errors unavailable or timed out — skipping: ${
          e.message || e
        })`
      );
    }
  } else {
    console.log("[deploy:vault] --no-reload: skipped plugin reload");
  }

  console.log("[deploy:vault] done — the current build is live in the running vault.");
};

main().catch((e) => {
  console.error(`[deploy:vault] error: ${e.message || e}`);
  process.exit(1);
});
