# ADR 0063: Navigator Content Search Through a Derived Worker Index

## Status

Accepted for implementation on 2026-07-17 under the owner-pulled Feature
Finalization mission (`Notidian-tluq.4`). Implementation is pending in
`Notidian-tluq.5`.

The owner pull recorded on `Notidian-d6lk` authorizes the recommended technical
option to become the build contract. This record does not add a new durable-data
owner or resolve an owner-value question by inference: it selects the bounded
technical substrate needed to deliver the already-requested content match.

## Context

The shipped Navigator filter is deliberately synchronous. On every non-blank
query, `filterTreeByQuery` scans the already-loaded `pathsIndex`, matches display
name or full path, and builds a sparse ancestor-revealing tree without touching
the filesystem. This is why typing remains safe even when the vault is large.

Content search cannot use the same read pattern. Reading Markdown bodies on each
keystroke would put asynchronous vault I/O inside the render path and would make
response time proportional to the number and size of notes.

The current search-shaped substrates do not close that gap:

- Obsidian's public `MetadataCache` exposes parsed links, tags, headings,
  sections, list items, blocks, and frontmatter. It does not expose note bodies
  or a vault-wide full-text query API.
- Obsidian's public `prepareSimpleSearch` and `prepareFuzzySearch` functions
  match a caller-supplied string. They are matchers, not a vault index.
- Notidian's existing `Superstate.searchIndex` is a Fuse index over `name`,
  `path`, `label.preview`, and `spaceNames`. `label.preview` is populated only
  when `notesPreview` is enabled and then contains only a short prefix. It is not
  a complete or unconditional body corpus.
- Obsidian's built-in global-search implementation is private runtime state. Its
  shape, lifecycle, readiness, and mobile behavior are not part of the installed
  public API contract.

A read-only aggregate measurement of the live Atlas Vault on 2026-07-17,
excluding paths whose names contain `archive` or `ignore`, was used to size the
synthetic performance gate below. Vault counts and sizes are live state and are
intentionally not copied into this decision record. The measured query cost was
acceptable off the UI thread but not as synchronous React work.

## Decision

### 1. Use a Separate Notidian-Owned Worker Index

Content matching uses a dedicated in-memory Fuse index inside an inline Web
Worker. It reuses the repository's existing Fuse dependency and inline-worker
build mechanism, but it does **not** extend or replace `Superstate.searchIndex`.

The worker owns documents shaped as `{ path, body }`. Fuse is configured for an
exact, case-insensitive body substring (`keys: ["body"]`, `threshold: 0`,
`ignoreLocation: true`, no result-score ordering). Every match path is returned;
tree order remains the Navigator's path/ancestor order rather than relevance
rank.

The main thread may read and transfer note bodies while building or refreshing
the index, but it never scans bodies to answer a typed query. If worker creation
or search fails, Notidian does not fall back to a main-thread body scan.

### 2. Keep Markdown Canonical and the Index Ephemeral

The Markdown file remains the only content authority. The index is a rebuildable
projection:

- it is never written to frontmatter, the context MDB, `PathState`, or
  `.notidian`;
- it is discarded on plugin unload or when the Navigator filter kill-switch is
  disabled;
- it is rebuilt from public vault reads after the Notidian path index is ready;
- no body text, query text, or match excerpt is logged or sent over a network.

Only renderable Markdown paths are indexed: the current `pathsIndex` entry must
exist, have Markdown subtype, and not be hidden. Folder, synthetic, missing, and
hidden paths are removed or skipped before their bodies can become searchable.

The indexed string is `stripFrontmatter(content)`, normalized with Unicode NFKC
and lowercased. The query receives the same normalization. Frontmatter-only text
therefore does not count as a body match; Markdown body syntax remains searchable
without an HTML-render or sanitization step.

### 3. Build in the Background and Refresh Incrementally

Initial indexing starts only after `superstateUpdated` has made `pathsIndex`
usable and only while `settings.enableNavigatorTextFilter` is true. Public
`Vault.cachedRead` calls run with bounded concurrency of four and feed the worker
incrementally. The service exposes `building`, `ready`, and `unavailable` state;
the Navigator shows the non-ready state instead of silently implying that a
partial corpus is complete.

Body freshness is driven by Obsidian's public **raw vault events**, not by
derived cache equality:

- `Vault.on("modify")` is the authoritative body-change trigger; it schedules a
  fresh `cachedRead` and replacement even when frontmatter, links, preview, and
  every other derived metadata field are unchanged;
- `Vault.on("delete")` removes the path immediately;
- `Vault.on("rename")` removes the old path immediately and schedules the new
  path once its current `pathsIndex` entry proves it eligible;
- `Vault.on("create")` records the path as pending until Notidian has indexed it,
  then reads it only if it is eligible Markdown.

Superstate events have the narrower eligibility/reconciliation role:

- `superstateReindex` marks the corpus incomplete while the path index rebuilds;
- `pathStateUpdated` and `pathCreated` add a missing eligible path or remove a
  path that became hidden/non-Markdown; they are not treated as proof that an
  already-indexed body changed;
- `pathDeleted` and `pathChanged` are idempotent backstops for the corresponding
  raw vault events;
- `superstateUpdated` reconciles the worker's path set with the current
  renderable Markdown set and may return the corpus to `ready` only after that
  reconciliation completes.

Every per-path read carries a generation. A late read for an older generation is
dropped, so rapid edits, rename-after-edit, delete-during-read, and hidden-state
changes cannot resurrect stale content. Worker mutations increment an index
revision; an active non-blank query is reissued after the revision settles.

### 4. Preserve the Synchronous Tree Boundary

Name and path matching remain immediate and byte-for-byte governed by
`filterTreeByQuery`. Content search is an additional set of matching paths, not a
replacement search mode.

For a non-blank query:

1. `filterTreeByQuery` synchronously includes name/path matches.
2. The UI debounces the content request by 150 ms and sends it to the worker.
3. The latest worker result supplies an `additionalMatchPaths` set.
4. The same pure tree builder ORs those paths into the matched set and applies
   its existing hidden-path, ghost-ancestor, re-parenting, DFS-order, child-count,
   and drag/collapse-inert rules.

The input therefore shows name/path results immediately. Content-only results
join when the complete current index answers. While the index is building or
unavailable, name/path search continues and the state is visible. A blank query
uses the existing expanded-tree path and issues no content query.

### 5. Suppress Stale Results and Bound Obsolete Work

Every query has a monotonically increasing request id and index revision. A new
keystroke clears the pending debounce. A result is applied only when its request
id, normalized query, and revision still equal the current request.

`Fuse.search` is synchronous inside its worker, so a message cannot interrupt a
search already executing. The service therefore enforces **single-flight,
latest-only backpressure**:

- at most one search message is executing in or queued to the worker;
- while that search is in flight, a new request replaces one main-thread
  `latestPendingQuery` slot instead of posting another worker message;
- after the in-flight result or error returns, the service posts only the latest
  still-current pending query, after applying any coalesced index mutations;
- per-path index updates are coalesced by path generation before they are posted.

An obsolete search can therefore delay the current query by at most one search,
not by the number of intervening keystrokes. Result generation still prevents
that obsolete answer from rendering. Disabling the flag, clearing the input,
unmounting `MainList`, or unloading the plugin invalidates the pending slot and
all results. No state update may land after unmount.

### 6. Reuse the Existing Kill-Switch

`settings.enableNavigatorTextFilter` remains the single feature gate. No second
runtime flag is added.

- **ON (default):** the current name/path filter renders and the content-index
  service may start.
- **OFF:** the filter UI remains absent as today, no content worker is created,
  no note body is read for this feature, and no content result enters the tree.

This is a stronger rollback than a content-only toggle: it restores the complete
pre-Navigator-filter render path and releases the derived corpus.

## Options Considered

### A. Call Obsidian Global Search Internals — Rejected

There is no supported public full-text query API in the installed Obsidian
typings. Reaching through `app.internalPlugins` or a core-plugin view would bind
Notidian to private desktop runtime state, with no stable readiness, lifecycle,
or mobile contract.

### B. Put Full Bodies in `PathState` and the Existing Fuse Index — Rejected

This would turn a lightweight, persisted path/metadata projection into a body
corpus, duplicate complete note text into surfaces used throughout the plugin,
and rebuild the whole shared index after ordinary path changes. It would also
conflate the optional short-preview feature with complete content search.

### C. Read Every Candidate Body Per Query — Rejected

Debouncing reduces frequency but not the cost or race surface of a query. It
would still perform thousands of vault reads after typing pauses and would
require cancellation across asynchronous I/O in the render path.

### D. Dedicated Ephemeral Worker Index — Chosen

This keeps file authority unchanged, isolates memory and compute, supports
incremental freshness, makes stale-result suppression explicit, reuses installed
dependencies, and leaves the synchronous tree projection intact.

## S5 Implementation Brief

`Notidian-tluq.5` implements this contract at these seams:

1. **Pure corpus and worker protocol**
   - Add `src/core/superstate/workers/navigatorContentSearch/impl.ts` for body
     normalization plus add/replace/remove/search behavior.
   - Add
     `src/core/superstate/workers/navigatorContentSearch/navigatorContentSearch.worker.ts`
     with explicit build, upsert, remove, reconcile, query, and dispose messages
     and request/revision echoes.
   - Modify `esbuild.config.mjs` to name the worker; no Obsidian import may enter
     the worker bundle.
2. **Obsidian lifecycle adapter**
   - Add `src/adapters/obsidian/NavigatorContentSearchService.ts` to own bounded
     `cachedRead` scheduling, path generations, single-flight/latest-only query
     flow, worker lifecycle, status, raw public vault events, and the narrower
     Superstate eligibility/reconciliation events.
   - Expose a narrow nullable service interface through
     a new `src/shared/types/navigatorContentSearch.ts` and modify
     `src/shared/types/superstate.ts` plus `src/core/superstate/superstate.ts` to
     carry it. Modify `src/main.ts` to construct, register, start, and dispose the
     service. Settings OFF must terminate it and clear its corpus; Settings ON
     rebuilds it.
3. **Navigator composition**
   - Extend `filterTreeByQuery` in `src/core/superstate/utils/spaces.ts` with an
     optional read-only set of additional match paths.
   - Keep
     `src/core/react/components/Navigator/SpaceTree/SpaceTreeView.tsx`
     synchronous: it receives the latest set and invokes the pure tree builder.
   - Modify `src/core/react/components/Navigator/MainList.tsx` to own the 150 ms
     debounce, request generation, status, and stale-result guard.
   - Update the existing flag contract comments in
     `src/core/schemas/settings.ts` and `src/shared/types/settings.ts`; the value,
     type, and default remain unchanged, so no settings migration or defaults
     snapshot change is expected.
   - Add localized `building` and `unavailable` text in `src/shared/en.ts` and
     scoped status styling in `src/css/Panels/Navigator/Navigator.css`; do not
     render body excerpts or add an HTML sink.
4. **Focused correctness tests**
   - Add
     `src/core/superstate/workers/navigatorContentSearch/impl.test.ts` for case
     folding, NFKC, contiguous phrases, body-only matches, frontmatter-only
     non-matches, replace/delete/rename, and all-match return behavior.
   - Add `src/adapters/obsidian/NavigatorContentSearchService.test.ts` for a
     metadata-neutral body edit received through `Vault.on("modify")`, rapid
     A->B edits with A resolving last, delete during read, rename during read,
     hidden transition, read failure isolation, active-query refresh after
     revision, worker failure, and a 20-query burst that proves the worker sees
     at most the in-flight query plus the final pending query.
   - Extend `src/core/superstate/utils/spaces.filterTreeByQuery.test.ts` so a
     content-only descendant reveals the same ancestors as a name match; hidden
     and ghost ancestors remain excluded and re-parented; DFS order, child
     counts, and drag/collapse guards do not regress.
   - Add `src/core/react/components/Navigator/MainList.contentSearch.dom.test.tsx`
     for immediate name/path fallback, visible building/unavailable state,
     latest-query-wins, blank-query no-op, unmount safety, and flag-OFF zero
     worker/read/render behavior. Extend
     `src/core/react/components/Navigator/MainList.filterKillSwitch.dom.test.tsx`
     only where its existing OFF-contract fixture needs the new service seam.
5. **Performance and live gates**
   - Add `scripts/notidianNavigatorSearchBenchmark.js` and modify `package.json`
     to expose `npm run benchmark:navigator-search`.
   - The deterministic benchmark prints Node version, platform, architecture,
     and CPU model; seeds at least 5,000 notes and 15 MiB of normalized bodies,
     including an 80 KiB note; warms each query shape five times; then measures
     30 rounds each of rare-tail, common, mid-body phrase, and miss queries over
     a real `worker_threads` round trip. It must measure ready time at most 5 s,
     worker round-trip p95 at most 250 ms, per-note main-thread dispatch p95 at
     most 16 ms, a 10,000-path projection p95 at most 50 ms, and final-query
     latency at most 500 ms for a 20-query burst. The burst must post at most two
     search messages to the worker. The script exits non-zero on any breach.
   - Tests and the benchmark assert that querying performs zero vault reads.
     Run the exact focused gate `npm run benchmark:navigator-search` before the
     repository pre-commit chain.
   - Run the repository pre-commit chain, then `npm run deploy:vault`. Live
     verification must prove a body-only token reveals its file and ancestors,
     a metadata-neutral body edit refreshes without retyping, a rapid old/new
     query cannot flash stale results or build an obsolete queue, OFF restores
     the legacy Navigator, and `obsidian dev:errors` remains clean.

## Consequences

- Content search is local, rebuildable, and independent of private Obsidian
  internals.
- Plugin startup performs bounded background reads while the flag is on; the UI
  is honest until the corpus is complete.
- The worker holds a derived copy/index of body text in memory for the session.
  This costs memory, but it does not create a durable authority and is released
  by the kill-switch or plugin unload.
- A plugin reload rebuilds the corpus rather than trusting a stale persistent
  index. Persistence may be considered later only with an explicit versioned
  invalidation contract and measured need.
- Name/path behavior, ancestor projection, and hidden-path rules remain the
  stable fallback and do not depend on content-index availability.

## Cross-Links

- Feature packet: [Feature Finalization](../streams/Feature%20Finalization.md)
- Base Navigator filter: `Notidian-nrjb`
- Superseded parked feature: `Notidian-d6lk`
- Architecture verdict: `Notidian-tluq.4`
- Implementation: `Notidian-tluq.5`
- Render deployment contract: [ADR 0051](0051-deploy-and-live-verify-contract.md)
