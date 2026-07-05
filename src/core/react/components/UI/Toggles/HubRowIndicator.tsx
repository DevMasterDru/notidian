import { Superstate } from "makemd-core";
import React from "react";
import i18n from "shared/i18n";

// Row-as-child-hub indicator (Notidian-z21a, Atlas Method ADR-0042 D1): a
// small, purely additive affordance for a database row whose file is the
// configured hub note of a same-named sibling folder (a nested child
// database, depth 1). Rendered only by callers that have already confirmed
// `settings.enableNestedHubRows` and the hub-row relationship — this
// component itself has no gating logic, so it stays trivially testable and
// safe to reuse from any row-rendering surface (list, table, ...).
export const HubRowIndicator = (props: {
  superstate: Superstate;
  onOpen: (e: React.MouseEvent) => void;
}) => {
  return (
    <button
      className="mk-hub-row-indicator mk-inline-button mk-icon-xsmall"
      aria-label={i18n.labels.hubRowIndicator}
      title={i18n.labels.hubRowIndicator}
      onClick={(e) => {
        e.stopPropagation();
        props.onOpen(e);
      }}
      dangerouslySetInnerHTML={{
        __html: props.superstate.ui.getSticker("ui//table"),
      }}
    ></button>
  );
};
