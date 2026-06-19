import React from "react";
import { ColumnWrapMode } from "shared/types/predicate";

const wrapOptions: {
  mode: ColumnWrapMode;
  label: string;
}[] = [
  { mode: "clip", label: "Clip" },
  { mode: "wrap", label: "Wrap" },
];

export const PropertyWrapTextMenuComponent = (props: {
  wrapMode: ColumnWrapMode;
  setWrapMode: (mode: ColumnWrapMode) => void;
  hide: () => void;
}) => {
  const selectMode = (
    e: React.MouseEvent<HTMLButtonElement>,
    mode: ColumnWrapMode
  ) => {
    e.preventDefault();
    e.stopPropagation();
    props.setWrapMode(mode);
    props.hide();
  };

  return (
    <div className="mk-property-header-display-menu mk-property-wrap-menu">
      <div
        className="mk-property-header-display-options"
        role="group"
        aria-label="Wrap text"
      >
        {wrapOptions.map((option) => {
          const isActive = props.wrapMode == option.mode;
          return (
            <button
              type="button"
              key={option.mode}
              className={[
                "mk-property-header-display-option",
                isActive ? "mk-property-header-display-option--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={isActive}
              onClick={(e) => selectMode(e, option.mode)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
