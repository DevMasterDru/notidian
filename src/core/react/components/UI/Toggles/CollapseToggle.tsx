import { Superstate } from "makemd-core";
import React from "react";
export const CollapseToggle = (props: {
  superstate: Superstate;
  collapsed: boolean;
  onToggle?: (collapsed: boolean, e: React.MouseEvent) => void;
  // Optional aria-label/title (same string, house idiom — see HubRowIndicator)
  // and an extra class hook, so individual call sites can label/distinguish
  // their chevron (e.g. Notidian-ul4t) without changing every other caller of
  // this shared toggle.
  ariaLabel?: string;
  className?: string;
}) => {
  return (
    <button
      className={[
        "mk-collapse",
        props.className,
        props.collapsed ? "mk-collapsed" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={props.ariaLabel}
      title={props.ariaLabel}
      onClick={(e) => {
        if (!props.onToggle) return;
        e.stopPropagation();
        props.onToggle(!props.collapsed, e);
      }}
      dangerouslySetInnerHTML={{
        __html: props.superstate.ui.getSticker("ui//collapse"),
      }}
    ></button>
  );
};
