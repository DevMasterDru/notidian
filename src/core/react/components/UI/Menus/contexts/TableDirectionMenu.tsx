import React from "react";
import i18n from "shared/i18n";
import { TableDirection } from "shared/types/predicate";

const tableDirectionOptions: {
  direction: TableDirection;
  label: string;
}[] = [
  { direction: "ltr", label: i18n.menu.leftToRight },
  { direction: "rtl", label: i18n.menu.rightToLeft },
];

export const TableDirectionMenuComponent = (props: {
  tableDirection: TableDirection;
  setTableDirection: (direction: TableDirection) => void;
  hide: () => void;
}) => {
  const selectDirection = (
    e: React.MouseEvent<HTMLButtonElement>,
    direction: TableDirection
  ) => {
    e.preventDefault();
    e.stopPropagation();
    props.setTableDirection(direction);
    props.hide();
  };

  return (
    <div className="mk-property-header-display-menu mk-table-direction-menu">
      <div
        className="mk-property-header-display-options"
        role="group"
        aria-label={i18n.menu.direction}
      >
        {tableDirectionOptions.map((option) => {
          const isActive = props.tableDirection == option.direction;
          return (
            <button
              type="button"
              key={option.direction}
              className={[
                "mk-property-header-display-option",
                isActive ? "mk-property-header-display-option--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={isActive}
              onClick={(e) => selectDirection(e, option.direction)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
