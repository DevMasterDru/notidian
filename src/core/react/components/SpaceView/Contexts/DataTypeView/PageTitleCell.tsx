import { PathCrumb } from "core/react/components/UI/Crumbs/PathCrumb";
import {
  pageTitleFromPath,
  validatePageTitle,
} from "core/utils/contexts/pageTitle";
import React, { useEffect, useRef, useState } from "react";
import i18n from "shared/i18n";
import { CellEditMode, TableCellProp } from "../TableView/TableView";

export const PageTitleCell = (
  props: TableCellProp & {
    renameValue?: (value: string) => Promise<string | null>;
    startEditing?: () => void;
  }
) => {
  const currentTitle = pageTitleFromPath(props.initialValue ?? "");
  const [displayTitle, setDisplayTitle] = useState(currentTitle);
  const editRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    setDisplayTitle(currentTitle);
    if (editRef.current) editRef.current.innerText = currentTitle;
  }, [currentTitle]);

  useEffect(() => {
    if (props.editMode == CellEditMode.EditModeActive && editRef.current) {
      editRef.current.focus();
      const selection = window.getSelection();
      selection.selectAllChildren(editRef.current);
      selection.collapseToEnd();
    }
  }, [props.editMode]);

  const resetEditText = () => {
    if (editRef.current) editRef.current.innerText = displayTitle;
  };

  const commit = async (rawValue: string) => {
    const validation = validatePageTitle(rawValue);
    if (validation.ok == false) {
      await props.renameValue?.(rawValue);
      resetEditText();
      props.setEditMode(null);
      return;
    }

    if (validation.title == displayTitle) {
      resetEditText();
      props.setEditMode(null);
      return;
    }

    const renamedPath = await props.renameValue?.(validation.title);
    if (!renamedPath) {
      resetEditText();
      props.setEditMode(null);
      return;
    }

    const nextTitle = pageTitleFromPath(renamedPath);
    setDisplayTitle(nextTitle);
    if (editRef.current) editRef.current.innerText = nextTitle;
    props.setEditMode(null);
  };

  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    commit(e.currentTarget.innerText);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key == "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key == "Escape") {
      e.preventDefault();
      cancelledRef.current = true;
      resetEditText();
      e.currentTarget.blur();
      props.setEditMode(null);
    }
  };

  const onViewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      e.metaKey ||
      e.ctrlKey ||
      props.editMode <= CellEditMode.EditModeReadOnly ||
      !props.startEditing
    ) {
      props.superstate.ui.openPath(props.initialValue, false);
      return;
    }
    props.startEditing?.();
  };

  if (props.editMode > CellEditMode.EditModeView) {
    return (
      <div
        className="mk-cell-file-item mk-page-title-cell mk-page-title-cell-editing"
        contentEditable={true}
        data-ph={props.compactMode ? props.property.name : i18n.labels.empty}
        onBlur={onBlur}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        ref={editRef}
        suppressContentEditableWarning={true}
      >
        {displayTitle}
      </div>
    );
  }

  return (
    <div className="mk-cell-file-item mk-page-title-cell">
      <PathCrumb
        superstate={props.superstate}
        path={props.initialValue}
        hideName={true}
        onClick={onViewClick}
      >
        <span className="mk-cell-file-name">{displayTitle}</span>
      </PathCrumb>
    </div>
  );
};
