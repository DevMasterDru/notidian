const { Worker } = require("worker_threads");
const { performance } = require("perf_hooks");
const os = require("os");

const NOTE_COUNT = 5_000;
const MIN_CORPUS_BYTES = 15 * 1024 * 1024;
const LARGE_NOTE_BYTES = 80 * 1024;
const QUERY_WARMUPS = 5;
const QUERY_ROUNDS = 30;

const percentile = (values, percentileValue) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil((percentileValue / 100) * ordered.length) - 1];
};

const fixedBody = (length) => {
  const chunk =
    "common-token alpha beta gamma delta epsilon zeta eta theta 0123456789\n";
  return chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length);
};

const createCorpus = () => {
  const regularBytes = Math.ceil(
    (MIN_CORPUS_BYTES - LARGE_NOTE_BYTES) / (NOTE_COUNT - 1)
  );
  return Array.from({ length: NOTE_COUNT }, (_, index) => {
    const targetBytes = index === 0 ? LARGE_NOTE_BYTES : regularBytes;
    let body = fixedBody(targetBytes);
    if (index === Math.floor(NOTE_COUNT / 2)) {
      const midpoint = Math.floor(body.length / 2);
      body = `${body.slice(0, midpoint)} mid-body exact phrase ${body.slice(
        midpoint
      )}`;
    }
    if (index === NOTE_COUNT - 1) body += " rare-tail-needle";
    return { path: `Folder-${index % 100}/Note-${index}.md`, body };
  });
};

const workerSource = `
  const { parentPort } = require("worker_threads");
  const Fuse = require(${JSON.stringify(require.resolve("fuse.js"))});
  const options = {
    keys: ["body"],
    threshold: 0,
    ignoreLocation: true,
    shouldSort: false,
    isCaseSensitive: false,
  };
  let documents = new Map();
  let fuse = new Fuse([], options);
  parentPort.on("message", (message) => {
    if (message.type === "seed") {
      documents = new Map(message.documents.map((document, order) => [
        document.path,
        { ...document, order },
      ]));
      fuse = new Fuse(Array.from(documents.values()), options);
      parentPort.postMessage({ type: "ready", id: message.id });
      return;
    }
    if (message.type === "upsert") {
      const existing = documents.get(message.document.path);
      if (existing) fuse.remove((candidate) => candidate.path === message.document.path);
      const document = {
        ...message.document,
        order: existing ? existing.order : documents.size,
      };
      documents.set(document.path, document);
      fuse.add(document);
      parentPort.postMessage({ type: "mutation", id: message.id });
      return;
    }
    if (message.type === "query") {
      const paths = fuse
        .search(message.query.normalize("NFKC").toLowerCase().trim())
        .map((result) => result.item)
        .sort((left, right) => left.order - right.order)
        .map((document) => document.path);
      parentPort.postMessage({ type: "result", id: message.id, paths });
    }
  });
`;

class WorkerClient {
  constructor(worker) {
    this.worker = worker;
    this.nextId = 0;
    this.waiters = new Map();
    this.queryListener = null;
    worker.on("message", (message) => {
      if (message.type === "result" && this.queryListener) {
        this.queryListener(message);
        return;
      }
      const waiter = this.waiters.get(message.id);
      if (!waiter) return;
      this.waiters.delete(message.id);
      waiter(message);
    });
  }

  request(message) {
    const id = ++this.nextId;
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      this.worker.postMessage({ ...message, id });
    });
  }
}

class LatestOnlyQueryScheduler {
  constructor(client) {
    this.client = client;
    this.active = null;
    this.pending = null;
    this.posts = 0;
    client.queryListener = (message) => this.onResult(message);
  }

  search(query) {
    return new Promise((resolve) => {
      const request = { query, resolve, id: 0 };
      if (!this.active) {
        this.active = request;
        this.post(request);
        return;
      }
      if (this.pending) this.pending.resolve({ cancelled: true, paths: [] });
      this.pending = request;
    });
  }

  post(request) {
    request.id = ++this.client.nextId;
    this.posts += 1;
    this.client.worker.postMessage({
      type: "query",
      id: request.id,
      query: request.query,
    });
  }

  onResult(message) {
    if (!this.active || message.id !== this.active.id) return;
    this.active.resolve({ cancelled: false, paths: message.paths });
    this.active = null;
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      this.active = next;
      this.post(next);
    }
  }
}

const projectPaths = (paths, query, additionalMatches) => {
  const normalized = query.toLowerCase();
  const included = new Set();
  for (const path of paths) {
    if (!path.toLowerCase().includes(normalized) && !additionalMatches.has(path))
      continue;
    let current = path;
    while (current) {
      included.add(current);
      const separator = current.lastIndexOf("/");
      current = separator < 0 ? "" : current.slice(0, separator);
    }
  }
  return included;
};

const formatMs = (value) => `${value.toFixed(2)} ms`;

const main = async () => {
  const cpu = os.cpus()[0]?.model ?? "unknown";
  console.log(
    `Navigator search benchmark | Node ${process.version} | ${process.platform} | ${process.arch} | ${cpu}`
  );

  const corpus = createCorpus();
  const corpusBytes = corpus.reduce(
    (total, document) => total + Buffer.byteLength(document.body),
    0
  );
  if (corpus.length < NOTE_COUNT || corpusBytes < MIN_CORPUS_BYTES)
    throw new Error("Deterministic corpus does not meet the ADR floor");

  const worker = new Worker(workerSource, { eval: true });
  const client = new WorkerClient(worker);
  const failures = [];
  try {
    let vaultReadCount = 0;
    const seededCorpus = corpus.map((document) => {
      vaultReadCount += 1;
      return { path: document.path, body: document.body };
    });
    const readyStart = performance.now();
    for (const document of seededCorpus)
      await client.request({ type: "upsert", document });
    const readyMs = performance.now() - readyStart;

    const dispatchSamples = [];
    for (let index = 0; index < QUERY_ROUNDS; index++) {
      const size = index < 3 ? LARGE_NOTE_BYTES : corpus[index + 1].body.length;
      const document = {
        path: `Dispatch-${index}.md`,
        body: fixedBody(size),
      };
      const id = ++client.nextId;
      const acknowledgement = new Promise((resolve) =>
        client.waiters.set(id, resolve)
      );
      const start = performance.now();
      worker.postMessage({ type: "upsert", id, document });
      dispatchSamples.push(performance.now() - start);
      await acknowledgement;
    }

    const scheduler = new LatestOnlyQueryScheduler(client);
    const vaultReadsBeforeQueries = vaultReadCount;
    const queryShapes = {
      rareTail: "rare-tail-needle",
      common: "common-token",
      midBodyPhrase: "mid-body exact phrase",
      miss: "definite-missing-content-token",
    };
    const queryP95 = {};
    for (const [name, query] of Object.entries(queryShapes)) {
      for (let warmup = 0; warmup < QUERY_WARMUPS; warmup++)
        await scheduler.search(query);
      const samples = [];
      for (let round = 0; round < QUERY_ROUNDS; round++) {
        const start = performance.now();
        await scheduler.search(query);
        samples.push(performance.now() - start);
      }
      queryP95[name] = percentile(samples, 95);
    }

    const projectionPaths = Array.from(
      { length: 10_000 },
      (_, index) => `Root-${index % 50}/Branch-${index % 500}/Note-${index}.md`
    );
    const projectionMatches = new Set(
      projectionPaths.filter((_, index) => index % 997 === 0)
    );
    const projectionSamples = [];
    for (let round = 0; round < QUERY_ROUNDS; round++) {
      const start = performance.now();
      projectPaths(projectionPaths, "non-matching-query", projectionMatches);
      projectionSamples.push(performance.now() - start);
    }
    const projectionP95 = percentile(projectionSamples, 95);

    const postsBeforeBurst = scheduler.posts;
    const burstStart = performance.now();
    const burst = Array.from({ length: 20 }, (_, index) =>
      scheduler.search(index === 19 ? "rare-tail-needle" : `obsolete-${index}`)
    );
    const finalBurstResult = await burst[19];
    await Promise.all(burst);
    const burstMs = performance.now() - burstStart;
    const burstPosts = scheduler.posts - postsBeforeBurst;

    const dispatchP95 = percentile(dispatchSamples, 95);
    console.log(
      `Corpus: ${corpus.length} notes, ${(corpusBytes / 1024 / 1024).toFixed(2)} MiB, largest ${(LARGE_NOTE_BYTES / 1024).toFixed(0)} KiB`
    );
    console.log(`Ready: ${formatMs(readyMs)} (limit 5000 ms)`);
    for (const [name, value] of Object.entries(queryP95))
      console.log(`Query ${name} p95: ${formatMs(value)} (limit 250 ms)`);
    console.log(`Per-note dispatch p95: ${formatMs(dispatchP95)} (limit 16 ms)`);
    console.log(`10k path projection p95: ${formatMs(projectionP95)} (limit 50 ms)`);
    console.log(
      `20-query burst: ${formatMs(burstMs)}, ${burstPosts} worker posts (limits 500 ms / 2 posts)`
    );
    const queryVaultReads = vaultReadCount - vaultReadsBeforeQueries;
    console.log(`Vault reads during queries: ${queryVaultReads}`);

    if (readyMs > 5_000) failures.push(`ready ${formatMs(readyMs)}`);
    for (const [name, value] of Object.entries(queryP95))
      if (value > 250) failures.push(`${name} query p95 ${formatMs(value)}`);
    if (dispatchP95 > 16) failures.push(`dispatch p95 ${formatMs(dispatchP95)}`);
    if (projectionP95 > 50)
      failures.push(`projection p95 ${formatMs(projectionP95)}`);
    if (burstMs > 500) failures.push(`burst latency ${formatMs(burstMs)}`);
    if (burstPosts > 2) failures.push(`burst worker posts ${burstPosts}`);
    if (queryVaultReads !== 0)
      failures.push("query phase performed a vault read");
    if (finalBurstResult.cancelled || finalBurstResult.paths.length !== 1)
      failures.push("final burst query did not return the rare-tail document");
  } finally {
    await worker.terminate();
  }

  if (failures.length > 0) {
    console.error(`Benchmark failed: ${failures.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("Benchmark passed");
  }
};

main().catch((error) => {
  console.error(`Benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
