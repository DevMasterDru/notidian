import { showColorPickerMenu } from "core/react/components/UI/Menus/properties/colorPickerMenu";
import React from "react";
import { windowFromDocument } from "shared/utils/dom";
import { TableCellProp } from "../TableView/TableView";

export const ColorCell = (props: TableCellProp) => {
  const showMenu = (e: React.MouseEvent) => {
    const handleChangeComplete = (color: string) => {
      props.saveValue(color);
    };
    // Anchor to the bound color swatch (currentTarget), not the clicked child
    // (Notidian-3txp). Synchronous read keeps currentTarget valid.
    const offset = e.currentTarget.getBoundingClientRect();
    showColorPickerMenu(
      props.superstate,
      offset,
      windowFromDocument(e.view.document),
      props.initialValue,
      handleChangeComplete
    );
  };
  return (
    <div>
      <div
        className="mk-setter-color"
        onClick={(e) => showMenu(e)}
        style={{
          backgroundColor: props.initialValue,
          width: 30,
          height: 30,
        }}
      ></div>
    </div>
  );
};
