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
  registerFrameBless,
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
  // bd Notidian-214: stable per-frame-instance key for once-per-frame-per-session
  // diagnostic de-dup + bless registration.
  const frameKey = useMemo(
    () => `${path ?? "?"}::${props.id ?? "root"}`,
    [path, props.id]
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
  // Nothing is persisted: a reload rebuilds `root` unstamped and an edit replaces
  // it, so re-bless is required BY DESIGN (a silently-rewritten frame loses trust).
  const blessFrame = () => {
    if (root) stampKitProvenanceTree(root);
    if (instance?.root) stampKitProvenanceTree(instance.root);
    runRoot();
  };

  // bd Notidian-214 — read-only diagnostic sink handed to the runner. Fires when
  // the boundary withholds $api from an untrusted node that references it. It
  // registers this frame's bless callback (for the "Trust dynamic frame code for
  // this session" command), logs which expression was no-op'd under enhancedLogs,
  // and notifies ONCE per frame per session. It is a pure notification — it NEVER
  // grants trust.
  const onApiWithheld = (info: ApiWithheldInfo) => {
    registerFrameBless(frameKey, blessFrame);
    if (props.superstate.settings?.enhancedLogs) {
      // eslint-disable-next-line no-console
      console.warn(
        `[notidian] frame hardening withheld $api from node "${
          info.nodeName ?? info.nodeId
        }" (${info.expressions.join(", ")}) in frame "${frameKey}". ` +
          `Run "Trust dynamic frame code for this session" to re-enable.`
      );
    }
    if (shouldNotifyApiWithheld(frameKey)) {
      props.superstate.ui.notify(
        'Frame hardening disabled dynamic content ($api) in a frame. Run the command "Trust dynamic frame code for this session" to re-enable it (re-required after reload or edit).'
      );
    }
  };

  // bd Notidian-214: drop this frame's session bless callback + notice state on
  // unmount so it does not leak or fire for a dead instance.
  useEffect(() => () => unregisterFrame(frameKey), [frameKey]);

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
  }, [props.id, linkedProps, hoverNode, instance, saveState, fastSaveState]);

  return (
    <FrameInstanceContext.Provider value={contextValue}>
      {props.children}
    </FrameInstanceContext.Provider>
  );
};
