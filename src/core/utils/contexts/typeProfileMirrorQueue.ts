import { Superstate } from "makemd-core";
import { TypeProfileSchemaChange } from "core/utils/contexts/typeProfile";
import {
  mirrorSchemaChangeToTypeProfile,
  TypeProfileSchemaState,
} from "core/utils/contexts/typeProfileMirror";

// Per-provider serializer for Type Profile mirror writes (Notidian-miy).
//
// The mirror writes the hub note's `fields` map. ContextEditorContext fires
// mirror calls un-awaited — and add-option fires one per new option in a loop —
// so two writes could both read the same pre-write `fields` map and the second
// would clobber the first (lost update, the same class as the Notidian-lg1
// context-edit race).
//
// This runs mirror calls strictly in order on a tail promise and threads each
// write's resulting map into the next call for the same hub, so consecutive
// writes build on each other regardless of metadata-cache lag. The threaded map
// is held only while a hub's chain is in flight; once it drains, the next fresh
// mirror re-reads from the metadata cache and picks up any external edit.
export type TypeProfileMirrorQueueState = {
  tail: Promise<unknown>;
  threaded: Map<string, TypeProfileSchemaState>;
  depth: Map<string, number>;
};

export const createTypeProfileMirrorQueue = (): TypeProfileMirrorQueueState => ({
  tail: Promise.resolve(),
  threaded: new Map(),
  depth: new Map(),
});

export const runSerializedTypeProfileMirror = (
  state: TypeProfileMirrorQueueState,
  superstate: Superstate,
  contextPath: string,
  change: TypeProfileSchemaChange
): Promise<boolean> => {
  // depth is bumped at enqueue time (synchronously) so that a burst of calls
  // for the same hub all see depth > 0 and keep the threaded map alive between
  // them; it is the count of not-yet-settled calls for this hub.
  state.depth.set(contextPath, (state.depth.get(contextPath) ?? 0) + 1);

  const exec = async (): Promise<boolean> => {
    const base = state.threaded.get(contextPath) ?? null;
    const result = await mirrorSchemaChangeToTypeProfile(
      superstate,
      contextPath,
      change,
      base
    );
    if (result.state) state.threaded.set(contextPath, result.state);
    return result.ok;
  };

  const settle = () => {
    const remaining = (state.depth.get(contextPath) ?? 1) - 1;
    if (remaining <= 0) {
      state.depth.delete(contextPath);
      state.threaded.delete(contextPath);
    } else {
      state.depth.set(contextPath, remaining);
    }
  };

  // Chain on the tail so writes run one at a time; settle after each so the
  // threaded map clears the moment this hub's burst finishes.
  const next = state.tail.then(exec, exec).then(
    (ok) => {
      settle();
      return ok;
    },
    () => {
      settle();
      return false;
    }
  );
  state.tail = next.catch(() => {});
  return next;
};
