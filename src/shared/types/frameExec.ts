import { ScreenType } from "shared/types/ui";
import { IAPI } from "./api";
import { FrameNode, FrameTreeProp } from "./mframe";


export type FrameExecutable = FrameTreeNode & {
  execPropsOptions?: {
    props?: FrameExecPropCache[];
    deps?: string[][];
    children?: string[];
    template?: FrameExecutable[];
  };
  execProps?: FrameExecProp;
  execStyles?: FrameExecProp;
  execActions?: FrameExecProp;
  children: FrameExecutable[];
};

export type FrameExecutableContext = {
  runID: string;
  root: FrameTreeNode;
  exec: FrameExecutable;
  saveState: (state: FrameState, instance: FrameRunInstance) => void;
  api: IAPI;
  contexts: FrameContexts;
  selectedSlide: string;
  styleAst?: StyleAst;
  // bd Notidian-vke: when true, the frame-execution trust boundary is active —
  // $api is withheld from prop/style evaluation of user/imported (non-default-
  // kit) frame nodes. Default-OFF (resolved from settings.hardenFrameExecution
  // by callers); undefined/false preserves the legacy behaviour.
  hardenFrameExecution?: boolean;
  // bd Notidian-214 (ADR 0022 read-only diagnostic): called when the boundary
  // withholds $api from an untrusted node whose props/styles reference $api, so
  // the render layer can surface WHICH frame/expression was no-op'd and offer a
  // session-scoped bless. It is a pure notification sink — NEVER a trust signal.
  onApiWithheld?: (info: ApiWithheldInfo) => void;
};
// bd Notidian-214: what the read-only frame-hardening diagnostic reports.
export type ApiWithheldInfo = {
  nodeId: string;
  nodeName?: string;
  // Dotted keys of the prop/style expressions that referenced $api and were
  // therefore no-op'd (e.g. "props.value", "styles.background").
  expressions: string[];
};
export type FrameRunInstance = {
  id: string;
  state: FrameState;
  prevState?: FrameState;
  slides: FrameState;
  root: FrameTreeNode;
  exec: FrameExecutable;
  newState?: FrameState;
  contexts: FrameContexts;
  styleAst?: StyleAst;
};
export type FrameContexts = { [key: string]: FrameTreeProp; };
export type FrameStateKeys = 'props' | 'actions' | 'styles';
export type FrameNodeState = Partial<{ props: FrameTreeProp; actions: FrameTreeProp; styles: FrameTreeProp; interactions: FrameTreeProp }>;
export type FrameState = { [key: string]: FrameNodeState; } & { $contexts?: FrameContexts; $api?: IAPI; };
export type FrameStateUpdate = { newState: FrameState; updatedState: FrameState; };
export enum FrameEditorResizeMode {
  ResizeNever,
  ResizeSelected,
  ResizeAlways
}

export enum FrameEditorMode {
  Read = 0,
  Page = 1,
  Frame = 2,
  Group = 3
}

export enum FrameResizeMode {
  ResizeNever,
  ResizeSelected,
  ResizeColumn,
  ResizeAlways
}
export enum FrameSelectMode {
  SelectNever,
  SelectManual,
  SelectDrag,
  SelectClick
}

export enum FrameDragMode {
  DragNever,
  DragHandle,
  DragSelected,
  DragAlways
}
export enum FrameDropMode {
  DropModeNone,
  DropModeRowColumn,
  DropModeRowOnly,
  DropModeColumnOnly
}


export type FrameEditorProps = { rootId?: string; editMode: FrameEditorMode; parentType?: string; parentLastChildID?: string; dragMode?: FrameDragMode; selectMode?: FrameSelectMode; resizeMode?: FrameResizeMode; dropMode?: FrameDropMode; linkedNode?: LinkedNode; screenType?: ScreenType; };
export const defaultFrameEditorProps: FrameEditorProps = { editMode: 0 };
export type FrameExecPropCache = {
  name: string;
  isConst: boolean;
  deps: string[][];
};

export type LinkedNode = {
  node: string;
  prop: string;
};

export type LinkedContext = {
  context: string;
  prop: string;
};

export type FrameExecProp = {
  [key: string]: any;
};
export type FrameTreeNode = {
  id: string;
  node: FrameNode;
  isRef: boolean;
  children: FrameTreeNode[];
  editorProps: FrameEditorProps;
  parent: FrameTreeNode | null;
};
export type StyleAst = {
    sem: string;
    type: string;
    selector: string;
    styles: FrameTreeProp;
    children: StyleAst[];
};

