import { Superstate } from "makemd-core";
import React, { useEffect } from "react";
import i18n from "shared/i18n";

export const SearchBar = (props: {
  superstate: Superstate;
  setSearchString: (str: string) => void;
  closeSearch?: () => void;
}) => {
  const clearSearch = () => {
    props.setSearchString("");
  };
  const ref = React.useRef<HTMLInputElement>(null);
  // Focus the input on mount. SearchBar is mounted only when the view search is
  // being opened (the magnifier toggle, or Cmd/Ctrl+F via TableView.onKeyDown ->
  // setSearchActive, ADR 0041/Notidian-z8q), so the user can type immediately
  // instead of having to click into the field first. (The previous gate on an
  // internal, never-set searchActive state meant this focus never fired.)
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="mk-view-search">
      <button
        className="mk-toolbar-button"
        dangerouslySetInnerHTML={{
          __html: props.superstate.ui.getSticker("ui//search"),
        }}
      ></button>
      <>
        <input
          onChange={(e) => props.setSearchString(e.target.value)}
          placeholder={i18n.labels.searchPlaceholder}
          className="mk-search-bar"
          ref={ref}
        ></input>
        {props.closeSearch && (
          <button
            className="mk-toolbar-button"
            dangerouslySetInnerHTML={{
              __html: props.superstate.ui.getSticker("ui//clear"),
            }}
            onClick={(e) => {
              e.stopPropagation();
              clearSearch();
              props.closeSearch();
            }}
          ></button>
        )}
      </>
    </div>
  );
};
