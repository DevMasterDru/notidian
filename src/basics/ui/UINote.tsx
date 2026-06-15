import MakeBasicsPlugin from "basics/basics";
import React, { forwardRef, useEffect, useRef, useState } from "react";
import i18n from "shared/i18n";
// Single source of truth for path->display-name reduction. The previous local
// copy was a verbatim clone of the PRE-FIX pathToString and carried the
// dotted-parent + extensionless-leaf substring arg-swap defect (Notidian-uuco,
// fixed canonically in commit 27a3a1b): the slash branch stripped an
// "extension" whenever ANY "." existed in the path, so pathToString("a.b/c")
// called substring(start>end), which String.substring SWAPS, leaking a
// "/"-bearing garbage display name (".b/"). Importing the canonical guarded
// version kills the duplicate and the defect together (Notidian-eakd).
import { pathToString } from "utils/path";

export interface NoteViewProps {
  plugin: MakeBasicsPlugin;
  source?: string;
  path: string;
  load: boolean;
  properties?: Record<string, any>;
  classname?: string;
  forceNote?: boolean;
}

export const UINote = forwardRef((props: NoteViewProps, ref) => {
  const flowRef = useRef<HTMLDivElement>(null);
  const [existsPas, setExistsPas] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadPath = async (force?: boolean) => {
    const div = flowRef.current;

    const path = props.plugin.enactor.uriByString(props.path, props.source);

    const pathExists = await props.plugin.enactor.pathExists(path.basePath);
    const isFolder = props.plugin.enactor.isSpace(path.basePath);
    const filePath =
      isFolder && props.forceNote
        ? props.plugin.enactor.spaceNotePath(props.path)
        : pathExists
        ? path.fullPath
        : null;

    if (!filePath) {
      if (!force) {
        setExistsPas(true);
        setLoaded(false);
        return;
      } else {
        const parent = isFolder
          ? props.plugin.enactor.spaceFolderPath(props.path)
          : props.plugin.enactor.parentPath(path.basePath);
        if (!parent) return;
        const newPath = await props.plugin.enactor.createNote(
          parent,
          pathToString(props.path)
        );
        setExistsPas(false);
        await props.plugin.enactor.openPath(newPath, div);
      }
    } else {
      setExistsPas(false);
      props.plugin.enactor.openPath(filePath, div);
    }

    setLoaded(true);
  };

  const toggleFlow = () => {
    if (props.load) {
      loadPath();
    } else {
      if (flowRef?.current) flowRef.current.innerHTML = "";
    }
  };

  useEffect(() => {
    toggleFlow();
  }, [props.load, props.path]);

  useEffect(() => {
    const reloadFlow = () => {
      if (
        flowRef.current &&
        !flowRef.current.hasChildNodes() &&
        props.load &&
        !existsPas
      ) {
        loadPath();
      }
    };
    props.plugin.enactor.addActiveStateListener(reloadFlow);

    return () => {
      flowRef.current = null;
      props.plugin.enactor.removeActiveStateListener(reloadFlow);
    };
  }, []);

  return (
    <>
      <div
        className={`${props.classname ?? ""} mk-flowspace-editor`}
        ref={flowRef}
        onMouseDown={(e) => {
          // Only stop propagation for clicks directly on the container, not on editor content
          if (e.target === e.currentTarget) {
            e.stopPropagation();
          }
        }}
      ></div>

      {existsPas ? (
        <div
          onClick={() => loadPath(true)}
          className="mk-placeholder"
          style={{ color: "var(--mk-ui-text-tertiary)" }}
        >
          {i18n.labels.notePlaceholder.replace(
            "${1}",
            pathToString(props.path)
          )}
        </div>
      ) : (
        <></>
      )}
    </>
  );
});
UINote.displayName = "UINote";
