import React from "react";
import i18n from "shared/i18n";
import { ColumnHeaderDisplayMode } from "shared/types/predicate";

const headerDisplayModeOptions: {
  mode: ColumnHeaderDisplayMode;
  label: string;
}[] = [
  { mode: "adaptive", label: i18n.menu.headerDisplayAdaptive },
  { mode: "full", label: "Icon+Text" },
  { mode: "text", label: "Text" },
  { mode: "icon", label: "Icon" },
];

export const PropertyHeaderDisplayModeMenuComponent = (props: {
  headerDisplayMode: ColumnHeaderDisplayMode;
  setHeaderDisplayMode: (mode: ColumnHeaderDisplayMode) => void;
  hide: () => void;
}) => {
  const selectMode = (
    e: React.MouseEvent<HTMLButtonElement>,
    mode: ColumnHeaderDisplayMode
  ) => {
    e.preventDefault();
    e.stopPropagation();
    props.setHeaderDisplayMode(mode);
    props.hide();
  };

  return (
    <div className="mk-property-header-display-menu">
      <div
        className="mk-property-header-display-options"
        role="group"
        aria-label={i18n.menu.headerDisplay}
      >
        {headerDisplayModeOptions.map((option) => {
          const isActive = props.headerDisplayMode == option.mode;
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
