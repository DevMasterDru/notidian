import { Superstate } from "makemd-core";
import React from "react";
import i18n from "shared/i18n";

// Inline "+ Add sub-item" affordance (ADR 0050). Low-emphasis, hover-revealed
// (see .mk-subitem-add CSS); sits inside the first-column .mk-subitem-affordance
// next to the collapse chevron. The icon is a trusted sticker (getSticker), the
// same pattern CollapseToggleSmall uses — not a user-data sink.
export const SubItemAddButton = (props: {
  superstate: Superstate;
  onAdd: () => void;
}) => {
  return (
    <button
      className="mk-subitem-add mk-inline-button mk-icon-xsmall"
      aria-label={i18n.menu.addSubItem}
      title={i18n.menu.addSubItem}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onAdd();
      }}
      dangerouslySetInnerHTML={{
        __html: props.superstate.ui.getSticker("ui//plus"),
      }}
    ></button>
  );
};
