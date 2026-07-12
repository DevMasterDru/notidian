import { Box } from "@air/react-drag-to-select";
import { applyPropsToState } from "core/utils/frames/ast";
import {
  executableChanged,
  stateChangedForProps,
} from "core/utils/frames/frame";
import { executeTreeNode } from "core/utils/frames/runner";
import {
  reStampProvenanceFromSource,
  stampKitProvenanceTree,
} from "core/utils/frames/trust";
import {
  fingerprintFrameTree,
  isSoundFrameId,
  registerFrameBless,
  restampSessionBless,
  shouldNotifyApiWithheld,
  unregisterFrame,
} from "core/utils/frames/frameTrustSession";
import { renameKey } from "core/utils/objects";
import _, { isEqual, uniqueId } from "lodash";
import { Superstate } from "makemd-core";
import React, {
  MutableRefObject,
  PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSpaceManager } from "./SpaceManagerContext";
import { defaultStyleAst } from "schemas/kits/defaultStyleAst";
import { ApiWithheldInfo, FrameRunInstance, FrameState } from "shared/types/frameExec";
import { ActionProp, FrameTreeProp } from "shared/types/mframe";
import { Edges } from "shared/types/Pos";
import { FramesEditorRootContext } from "./FrameEditorRootContext";
import { FrameRootContext } from "./FrameRootContext";

// Define the context type
type FrameInstanceType = {
  id: string;
  // bd Notidian-pg6g: the frame TRUST identity (its path) this instance derived
  // from FrameRootContext, or null when the mount topology provides none. Never a
  // shared sentinel like "?" — that aliased DIFFERENT frames to one identity in
  // the session bless registry (the ADR 0022 2c confused deputy).
  frameId: string | null;
  hoverNode: { id: string; node: string; direction: Edges };
  setHoverNode: (node: { id: string; node: string; direction: Edges }) => void;
  selectableNodeBounds: MutableRefObject<Record<string, Box>>;
  runRoot: () => void;
  instance: FrameRunInstance;
  saveState: (state: FrameState, instance: FrameRunInstance) => void;
  fastSaveState: (state: FrameState) => void;
  linkedProps: string[];
  // bd Notidian-214 (ADR 0022 Decision 2c): user-initiated, session-scoped,
  // NON-PERSISTED bless — stamp this frame's materialized tree in memory so the
  // hardening boundary restores $api for the rest of the session. Dropped on
  // reload/edit by design.
  blessFrame: () => void;
};

// Create the context
export const FrameInstanceContext = createContext<FrameInstanceType>({
  id: "",
  frameId: null,
  hoverNode: { id: null, node: "", direction: null },
  setHoverNode: (node: { node: string; direction: Edges }) => null,
  selectableNodeBounds: { current: {} },
  runRoot: () => null,
  instance: null,
  saveState: (state: FrameState, instance: FrameRunInstance) => null,
  fastSaveState: (state: FrameState) => null,
  linkedProps: [],
  blessFrame: () => null,
});

// Create the context provider component
export const FrameInstanceProvider: React.FC<
  PropsWithChildren<{
    id: string;
    superstate: Superstate;
    props?: FrameTreeProp;
    contexts?: FrameTreeProp;
    propSetters?: {
      [key: string]: (value: any) => void;
    };
    actions?: ActionProp;
    editable: boolean;
  }>
> = (
  props: PropsWithChildren<{
    id: string;
    superstate: Superstate;
    props?: FrameTreeProp;
    contexts?: FrameTreeProp;
    propSetters?: {
      [key: string]: (value: any) => void;
    };
    actions?: ActionProp;
    editable: boolean;
  }>
) => {
  const spaceManager = useSpaceManager() || props.superstate.spaceManager;
  const [hoverNode, setHoverNode] = useState(null);
  const [instance, setInstance] = useState<FrameRunInstance>({
    state: {},
    id: null,
    root: null,
    exec: null,
    slides: {},
    contexts: {},
  });
  const [rootProps, setRootProps] = useState<FrameTreeProp>(props.props);
  
  useEffect(() => {
    setRootProps((p) => {
      if (_.isEqual(p, props.props)) return p;
      return props.props;
    });
  }, [props.props]);
  const { selectedSlide: _selectedSlide } = useContext(FramesEditorRootContext);
  const selectedSlide = props.editable ? _selectedSlide : null;
  const { root: editableRoot } = useContext(FramesEditorRootContext);
  const { root: nonEditableRoot, path } = useContext(FrameRootContext);
  const root = useMemo(
    () => (props.editable ? editableRoot : nonEditableRoot),
    [props.editable, editableRoot, nonEditableRoot]
  );
  // bd Notidian-214: the frame IDENTITY (its path) de-dupes the once-per-frame
  // diagnostic notice AND keys the per-frame bless consent. A list renders one
  // FrameInstance PER ROW that all share this path, so keying the notice on
  // identity (not the per-row instance) shows ONE notice for the whole view.
  //
  // bd Notidian-pg6g: every render topology must provide this via
  // FrameRootContext (FrameRootProvider on the read/kit paths; the editor branch
  // of FrameContainerView provides it directly). When absent (an unforeseen
  // mount) the identity is null — NEVER a shared "?" fallback, which aliased
  // EVERY editable space's main frame to one identity so a single bless gesture
  // could trust a frame the user never reviewed (ADR 0022 2c confused deputy).
  const frameId = useMemo(() => path ?? null, [path]);
  // bd Notidian-214/pg6g: the per-INSTANCE key registers this row's bless
  // callback, so blessing the chosen frame re-runs every one of its rows. The
  // per-mount unique suffix guarantees two live instances can never collide in
  // the registry (a shared key silently REPLACED the other instance's callback
  // and dropped it on the first unmount).
  const instanceUid = useRef(uniqueId("frame-instance-")).current;
  const instanceKey = useMemo(
    () => `${frameId ?? "?"}::${props.id ?? "root"}::${instanceUid}`,
    [frameId, props.id, instanceUid]
  );

  const activeRunID = useRef(null);
  const currentRoot = useRef(null);
  const linkedProps = useMemo(() => {
    return Object.keys(props.propSetters || {});
  }, [props.propSetters]);

  const saveState = (newState: FrameState, instance: FrameRunInstance) => {
    const { root: _root, exec: _exec, id: runID, state } = instance;
    renameKey(newState, "$root", _exec.id);

    if (activeRunID.current != runID) {
      return;
    }

    const { $api, ...prevState } = state;
    if (props.actions) newState[_exec.id].actions = props.actions;
    const appliedState = applyPropsToState(newState, rootProps, _exec.id);

    executeTreeNode(
      _exec,
      {
        state,
        newState: appliedState,
        prevState: _.cloneDeep(prevState),
        slides: {},
      },
      {
        api: spaceManager.api,
        saveState,
        root: _root,
        contexts: props.contexts,
        runID,
        selectedSlide,
        exec: _exec,
        styleAst: instance.styleAst,
        // bd Notidian-vke: default-OFF frame-execution trust boundary.
        hardenFrameExecution: props.superstate.settings?.hardenFrameExecution,
        // bd Notidian-214: read-only diagnostic when the boundary withholds $api.
        onApiWithheld,
      }
    ).then((s) => {
      // bd Notidian-jsvy: sibling to the Notidian-06ix runRoot race (commit
      // 636cc64). saveState's own call-time pre-check above only ran once, at
      // call time -- it says nothing about what may change WHILE this call's
      // executeTreeNode promise is still in flight. A fresher call (another
      // saveState call, or a runRoot() re-run from a rootProps/contexts
      // change or a bless re-run) can move activeRunID.current on before this
      // call settles. If THIS now-superseded call's promise settles LAST,
      // bail rather than let it unconditionally clobber the fresher call's
      // instance. Unlike runRoot's `.then`, saveState's `.then` never
      // reassigns activeRunID.current itself, so only the setInstance
      // clobber needs guarding here.
      if (activeRunID.current !== runID) {
        return;
      }

      setInstance((p) => {
        return s;
      });
    });
  };
  useEffect(() => {
    if (instance?.root && props.propSetters)
      stateChangedForProps(
        Object.keys(props.propSetters),
        rootProps,
        instance.state,
        instance.root.id
      ).forEach((f) => {
        props.propSetters[f](instance.state[instance.root.id].props[f]);
      });
  }, [instance]);
  // useEffect(() => {
  //   if (instance && root) saveState(null, { ...instance, state: {} });
  // }, [selectedSlide]);
  const selectableNodeBounds = useRef<Record<string, Box>>({});
  const fastSaveState = (newState: FrameState) => {
    setInstance((p) => {
      return { ...p, state: newState };
    });
  };
  useEffect(
    () => () => {
      activeRunID.current = null;
    },
    []
  );

  const runRoot = () => {
    if (root) {
      // bd Notidian-kcgt: a view remount rebuilds `root` UNSTAMPED (both root
      // providers build a fresh tree), which made the session bless mount-scoped
      // — clicking away and back silently dropped trust and mis-fired the "code
      // changed" re-arm. Re-extend the bless HERE, before execution: the stamp is
      // re-applied IFF this identity was blessed this session AND the rebuilt
      // tree's code-bearing fields fingerprint byte-identically to the code the
      // user blessed (in-memory registry only — an edit changes the fingerprint
      // and a reload clears the registry, so both still drop trust by design).
      restampSessionBless(frameId, root);
      const newRoot = _.cloneDeep(root);
      // bd Notidian-214: _.cloneDeep drops the non-enumerable kit-provenance
      // marker (the same property that makes it unforgeable), which would strip
      // $api from genuine kit subtrees — and from a user tree the owner blessed
      // this session — under hardenFrameExecution. Re-apply provenance FROM the
      // source tree so the boundary sees it. Trust still derives only from the
      // source's genuine marker, never from any persisted value.
      reStampProvenanceFromSource(newRoot, root);
      const runID = uniqueId();
      activeRunID.current = runID;

      executeTreeNode(
        newRoot,
        {
          prevState: {},
          state: {},
          newState: applyPropsToState(
            props.actions ? { [newRoot.id]: { actions: props.actions } } : {},
            rootProps,
            newRoot.id
          ),
          slides: {},
        },
        {
          api: spaceManager.api,
          contexts: props.contexts,
          saveState,
          root: root,
          exec: newRoot,
          runID,
          selectedSlide,
          styleAst: defaultStyleAst,
          // bd Notidian-vke: default-OFF frame-execution trust boundary.
          hardenFrameExecution: props.superstate.settings?.hardenFrameExecution,
          // bd Notidian-214: read-only diagnostic when the boundary withholds $api.
          onApiWithheld,
        }
      ).then((s) => {
        // bd Notidian-06ix: a second runRoot() can start (rootProps/contexts
        // change, or a bless re-run) while this run is still in flight. If
        // THAT fresher run's promise settles first, activeRunID.current has
        // already moved on to its runID by the time this (superseded) run's
        // promise settles — mirror the saveState guard above and bail rather
        // than let whichever promise settles LAST unconditionally clobber the
        // fresher run's instance/activeRunID (which would also silently drop
        // the fresh run's own saveState writes, since those are gated on this
        // same ref matching their runID).
        if (activeRunID.current !== runID) {
          return;
        }

        setInstance((p) => {
          return s;
        });
        activeRunID.current = s.id;
      });
    }
  };

  // bd Notidian-214 (ADR 0022 Decision 2c) — user-initiated, session-scoped,
  // NON-PERSISTED bless. Stamp this frame's materialized tree (source + current
  // instance) in memory, then re-run so the hardening boundary restores $api.
  // Nothing is persisted: blessFrameById records an in-memory code fingerprint
  // so runRoot can re-extend the stamp to an IDENTICAL rebuild for the rest of
  // the session (bd Notidian-kcgt), while an EDIT (different fingerprint) or a
  // RELOAD (registry reset) still drops trust BY DESIGN — a silently-rewritten
  // frame loses trust.
  const blessFrame = () => {
    if (root) stampKitProvenanceTree(root);
    if (instance?.root) stampKitProvenanceTree(instance.root);
    runRoot();
  };

  // bd Notidian-kcgt: fingerprint of the CURRENT source tree's code-bearing
  // fields, memoized per root object (recomputing on every withhold of a 50-row
  // list would be wasted work — the fingerprint is pure in the tree).
  const rootFingerprintRef = useRef<{ tree: unknown; fp: string }>(null);
  const rootFingerprint = () => {
    if (!root) return "";
    if (rootFingerprintRef.current?.tree === root)
      return rootFingerprintRef.current.fp;
    const fp = fingerprintFrameTree(root);
    rootFingerprintRef.current = { tree: root, fp };
    return fp;
  };

  // bd Notidian-214 — read-only diagnostic sink handed to the runner. Fires when
  // the boundary withholds $api from an untrusted node that references it. It
  // registers this frame's bless callback (for the "Trust dynamic frame code for
  // this session" command), logs which expression was no-op'd under enhancedLogs,
  // and notifies ONCE per frame per session. It is a pure notification — it NEVER
  // grants trust.
  const onApiWithheld = (info: ApiWithheldInfo) => {
    // bd Notidian-pg6g: only a SOUND identity may register a bless callback — an
    // unidentified frame is un-attributable, so offering it for trust would let a
    // frame the user cannot review ride the consent surface (frameTrustSession
    // refuses unsound ids too; this is the first of two layers).
    if (isSoundFrameId(frameId)) {
      // bd Notidian-kcgt: the fingerprint registered here is what blessFrameById
      // records on the user's bless, binding the session trust to THIS code.
      registerFrameBless(frameId, instanceKey, blessFrame, rootFingerprint());
    }
    if (props.superstate.settings?.enhancedLogs) {
      // eslint-disable-next-line no-console
      console.warn(
        `[notidian] frame hardening withheld $api from node "${
          info.nodeName ?? info.nodeId
        }" (${info.expressions.join(", ")}) in frame "${
          frameId ?? "(unidentified frame)"
        }". Run "Trust dynamic frame code for this session" to re-enable.`
      );
    }
    // Notify once per FRAME IDENTITY (not per row) and NAME the frame, so the user
    // makes an attributed, per-frame trust choice (ADR 0022 2c).
    if (isSoundFrameId(frameId)) {
      if (shouldNotifyApiWithheld(frameId)) {
        props.superstate.ui.notify(
          `Frame hardening disabled dynamic content ($api) in the frame "${frameId}". Run the command "Trust dynamic frame code for this session" and choose this frame to re-enable it (re-required after reload or edit).`
        );
      }
    } else if (shouldNotifyApiWithheld("?")) {
      // Unidentified frames cannot be offered for trust (no attributable
      // identity), so say so honestly instead of pointing at a command that
      // will not list them. De-duped once per session under the "?" notice key
      // (a NOTICE key only — never a trust identity; registration above refused).
      props.superstate.ui.notify(
        `Frame hardening disabled dynamic content ($api) in a frame that could not be identified, so it cannot be trusted this session. If this persists after a reload, please report it.`
      );
    }
  };

  // bd Notidian-214: drop this INSTANCE's session bless callback on unmount so it
  // does not leak or fire for a dead instance. The frame-identity notice flag is
  // deliberately NOT cleared here (remount/pagination must not re-arm the toast).
  useEffect(() => () => unregisterFrame(instanceKey), [instanceKey]);

  useEffect(() => {
    if (
      instance.root &&
      !executableChanged(root, instance.root) &&
      isEqual(props.contexts, instance.contexts)
    ) {
      saveState({ [instance.root.id]: { props: rootProps } }, instance);
    } else {
      runRoot();
    }
  }, [rootProps, root, props.contexts, props.actions]);

  const contextValue = useMemo(() => {
    return {
      id: props.id,
      frameId,
      linkedProps,
      hoverNode,
      setHoverNode,
      selectableNodeBounds,
      runRoot,
      instance,
      saveState,
      fastSaveState,
      blessFrame,
    };
  }, [
    props.id,
    frameId,
    linkedProps,
    hoverNode,
    instance,
    saveState,
    fastSaveState,
  ]);

  return (
    <FrameInstanceContext.Provider value={contextValue}>
      {props.children}
    </FrameInstanceContext.Provider>
  );
};
