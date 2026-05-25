# Real Vault Smoke Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in real-vault smoke harness for Obsidian metadata-cache, frontmatter, rename, plugin reload, and developer error behavior.

**Architecture:** Create a dependency-injected Node harness under `scripts/` so unit tests can run without Obsidian. Expose a package script that invokes the harness against a selected live vault only when explicit write approval is present.

**Tech Stack:** Node.js CommonJS scripts, Obsidian CLI, Jest, existing Notidian documentation.

---

### Task 1: Harness Red Tests

**Files:**
- Create: `scripts/notidianRealVaultHarness.test.js`
- Create: `scripts/notidianRealVaultHarness.js`

- [ ] **Step 1: Write failing tests**

Add tests for:

- `parseHarnessArgs` accepting `vault=<name>`, `--allow-write`, `--keep-fixture`, `--plugin-id=<id>`, `--fixture-root=<folder>`, and `--timeout-ms=<n>`.
- `validateHarnessConfig` rejecting missing vaults and missing write approval.
- `createFixturePaths` generating timestamped fixture note paths under the fixture root without creating a per-run folder.
- `buildObsidianArgs` putting `vault=<name>` first.
- `runRealVaultSmokeHarness` reloading the plugin, creating fixtures, polling metadata, setting a property, renaming a file, checking developer errors, and deleting fixtures.
- `runRealVaultSmokeHarness` skipping cleanup when `keepFixture` is true.

- [ ] **Step 2: Verify red**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: fail because the harness module does not exist.

### Task 2: Minimal Harness Implementation

**Files:**
- Modify: `scripts/notidianRealVaultHarness.js`
- Modify: `package.json`

- [ ] **Step 1: Implement exported harness functions**

Implement:

- `parseHarnessArgs(argv, env)`
- `validateHarnessConfig(config)`
- `createFixturePaths(config, now)`
- `buildObsidianArgs(config, command, args)`
- `runRealVaultSmokeHarness(config, runner)`
- `main(argv, env)`

- [ ] **Step 2: Add package script**

Add:

```json
"test:real-vault": "node scripts/notidianRealVaultHarness.js"
```

- [ ] **Step 3: Verify green**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: the harness unit tests pass.

### Task 3: Documentation

**Files:**
- Create: `docs/real-vault-smoke-harness.md`
- Modify: `docs/README.md`
- Modify: `docs/current-state.md`
- Modify: `docs/table-database-workflows.md`

- [ ] **Step 1: Document usage and safety**

Document the opt-in command, required write flag, fixture path, cleanup behavior, and the difference between unit tests and the live harness.

- [ ] **Step 2: Update current-state gap language**

Replace the broad "real vault fixture integration tests are still needed" gap with a narrower statement: an opt-in smoke harness exists, but broader UI table automation and timing fixtures remain.

### Task 4: Verification And Delivery

**Files:**
- All changed files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

- [ ] **Step 2: Run full unit tests**

Run:

```bash
npm test -- --runInBand
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npx tsc -noEmit -skipLibCheck
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

- [ ] **Step 5: Run documentation checks**

Run:

```bash
git diff --check -- README.md docs package.json scripts
```

- [ ] **Step 6: Optionally run live smoke**

Only when Obsidian is open and a disposable or approved vault is selected:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```

- [ ] **Step 7: Commit and push**

Commit the harness, tests, docs, and package script, then push `main`.

## Self-Review

- Spec coverage: the plan covers safety gating, command construction, live scenario execution, docs, verification, and delivery.
- Placeholder scan: no placeholders remain.
- Scope check: this is one focused infrastructure phase. UI table automation is explicitly future work.
