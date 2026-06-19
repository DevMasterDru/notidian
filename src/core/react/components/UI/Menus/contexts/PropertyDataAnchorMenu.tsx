import React from "react";
import i18n from "shared/i18n";
import { ColumnDataAnchorMode } from "shared/types/predicate";

const dataAnchorOptions: {
  mode: ColumnDataAnchorMode;
  label: string;
}[] = [
  { mode: "auto", label: i18n.menu.dataAnchorAuto },
  { mode: "left", label: i18n.menu.dataAnchorLeft },
  { mode: "center", label: i18n.menu.dataAnchorCenter },
  { mode: "right", label: i18n.menu.dataAnchorRight },
];

export const PropertyDataAnchorMenuComponent = (props: {
  dataAnchorMode: ColumnDataAnchorMode;
  setDataAnchorMode: (mode: ColumnDataAnchorMode) => void;
  hide: () => void;
}) => {
  const selectMode = (
    e: React.MouseEvent<HTMLButtonElement>,
    mode: ColumnDataAnchorMode
  ) => {
    e.preventDefault();
    e.stopPropagation();
    props.setDataAnchorMode(mode);
    props.hide();
  };

  return (
    <div className="mk-property-header-display-menu mk-property-data-anchor-menu">
      <div
        className="mk-property-header-display-options"
        role="group"
        aria-label={i18n.menu.dataAnchor}
      >
        {dataAnchorOptions.map((option) => {
          const isActive = props.dataAnchorMode == option.mode;
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
