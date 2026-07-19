const POST_PHYSICAL_LIFECYCLE_FAILURE: unique symbol = Symbol.for(
  "notidian.postPhysicalLifecycleFailure",
) as unknown as typeof POST_PHYSICAL_LIFECYCLE_FAILURE;

export interface PostPhysicalLifecycleFailure extends Error {
  readonly [POST_PHYSICAL_LIFECYCLE_FAILURE]: true;
  readonly cause: unknown;
  readonly errors?: readonly unknown[];
}

class PostPhysicalLifecycleError extends Error implements PostPhysicalLifecycleFailure {
  readonly [POST_PHYSICAL_LIFECYCLE_FAILURE] = true as const;
  readonly cause: unknown;
  readonly errors?: readonly unknown[];

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "PostPhysicalLifecycleError";
    this.cause = cause;
    if (cause instanceof AggregateError) this.errors = [...cause.errors];
  }
}

export const postPhysicalLifecycleFailure = (
  message: string,
  cause: unknown,
): PostPhysicalLifecycleFailure => new PostPhysicalLifecycleError(message, cause);

export const isPostPhysicalLifecycleFailure = (
  error: unknown,
): error is PostPhysicalLifecycleFailure => {
  if (!((typeof error === "object" && error !== null) || typeof error === "function")) {
    return false;
  }
  const candidate = error as Partial<PostPhysicalLifecycleFailure>;
  return candidate[POST_PHYSICAL_LIFECYCLE_FAILURE] === true
    && "cause" in candidate
    && (candidate.errors === undefined || Array.isArray(candidate.errors));
};

export const runBulkAsync = async <T>(
  values: T[],
  operation: (value: T) => Promise<unknown>,
): Promise<void> => {
  const results = await Promise.allSettled(
    values.map(value => Promise.resolve().then(() => operation(value)))
  );
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, `${failures.length} operation(s) failed`);
};

export const dispatchBestEffort = (
  operation: Promise<unknown>,
  report: (error: unknown) => void,
): void => {
  void operation.catch(report);
};
