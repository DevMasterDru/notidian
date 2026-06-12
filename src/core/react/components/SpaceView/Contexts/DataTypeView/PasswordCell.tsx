import React, { useEffect, useRef, useState } from "react";
import { CellEditMode, TableCellProp } from "../TableView/TableView";

// Masked secret cell (Notidian-k6e, Atlas Method ADR-0009). Masking is a UI
// concern only — the value is plain frontmatter. Fixed-length dots avoid
// leaking the secret's length; the value itself is never logged or rendered
// through innerHTML.
const MASK = "••••••";

export const PasswordCell = (props: TableCellProp) => {
  const { initialValue, saveValue } = props;
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const editing = props.editMode > CellEditMode.EditModeView;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (!editing) setRevealed(false);
  }, [editing]);

  const copyValue = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!initialValue) return;
    navigator.clipboard.writeText(initialValue).then(() => {
      props.superstate.ui.notify("Copied to clipboard");
    });
  };

  const toggleReveal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRevealed((p) => !p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key == "Enter") {
      (e.target as HTMLInputElement).blur();
      props.setEditMode(null);
    }
    if (e.key == "Escape") {
      inputRef.current.value = initialValue;
      (e.target as HTMLInputElement).blur();
      props.setEditMode(null);
    }
  };

  if (editing) {
    return (
      <div
        className="mk-cell-password"
        onClick={(e) => e.stopPropagation()}
        onMouseLeave={() => setRevealed(false)}
      >
        <input
          ref={inputRef}
          type={revealed ? "text" : "password"}
          className="mk-cell-text"
          defaultValue={initialValue}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (e.target.value != initialValue) saveValue(e.target.value);
          }}
        />
        <button
          className="mk-cell-password-button"
          aria-label={revealed ? "Hide value" : "Reveal value"}
          onClick={toggleReveal}
          dangerouslySetInnerHTML={{
            __html: props.superstate.ui.getSticker(
              revealed ? "ui//eye-off" : "ui//eye"
            ),
          }}
        ></button>
      </div>
    );
  }

  return (
    <div
      className="mk-cell-password"
      onMouseLeave={() => setRevealed(false)}
      onKeyDown={(e) => {
        if (e.key == "Escape") setRevealed(false);
      }}
    >
      <span className="mk-cell-password-value">
        {initialValue ? (revealed ? initialValue : MASK) : ""}
      </span>
      {initialValue && (
        <>
          <button
            className="mk-cell-password-button"
            aria-label={revealed ? "Hide value" : "Reveal value"}
            onClick={toggleReveal}
            dangerouslySetInnerHTML={{
              __html: props.superstate.ui.getSticker(
                revealed ? "ui//eye-off" : "ui//eye"
              ),
            }}
          ></button>
          <button
            className="mk-cell-password-button"
            aria-label="Copy value"
            onClick={copyValue}
            dangerouslySetInnerHTML={{
              __html: props.superstate.ui.getSticker("ui//copy"),
            }}
          ></button>
        </>
      )}
    </div>
  );
};
