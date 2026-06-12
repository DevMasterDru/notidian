import { Superstate } from "makemd-core";
import React, { useEffect, useRef } from "react";

// Floating quick-find bar (Notidian-r20). Presentational only: it owns no match
// state, just renders the input + count + navigation and reports intent back to
// TableView through callbacks.
export const QuickFindBar = (props: {
  superstate: Superstate;
  query: string;
  matchCount: number;
  activeOrdinal: number; // 1-based position of the active match, 0 when none
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key == "Enter") {
      e.preventDefault();
      if (e.shiftKey) props.onPrev();
      else props.onNext();
    } else if (e.key == "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  const empty = props.query.trim().length == 0;
  const countLabel = empty
    ? ""
    : props.matchCount == 0
    ? "0/0"
    : `${props.activeOrdinal}/${props.matchCount}`;
  const noMatches = props.matchCount == 0;

  return (
    <div
      className="mk-quick-find"
      // Keep clicks inside the bar from starting a table marquee/selection.
      onMouseDown={(e) => e.stopPropagation()}
      // Isolate the bar's keystrokes from the table shortcut handler on the
      // mk-table container — otherwise Enter/Backspace/Delete/Cmd+V typed into
      // the find input would trigger table edit/new-row/clear/paste actions.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        className="mk-quick-find-input"
        placeholder="Find in view"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="mk-quick-find-count">{countLabel}</span>
      <button
        className="mk-quick-find-button"
        aria-label="Previous match"
        disabled={noMatches}
        onClick={props.onPrev}
      >
        ↑
      </button>
      <button
        className="mk-quick-find-button"
        aria-label="Next match"
        disabled={noMatches}
        onClick={props.onNext}
      >
        ↓
      </button>
      <button
        className="mk-quick-find-button mk-quick-find-close"
        aria-label="Close find"
        onClick={props.onClose}
      >
        ✕
      </button>
    </div>
  );
};
