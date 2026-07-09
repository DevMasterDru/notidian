import { SpaceTreeComponent } from "core/react/components/Navigator/SpaceTree/SpaceTreeView";
import { isTouchScreen } from "core/utils/ui/screen";
import { Superstate } from "makemd-core";
import i18n from "shared/i18n";
import React, { useEffect, useState } from "react";
import { ErrorBoundary, useErrorBoundary } from "react-error-boundary";
import { FocusSelector } from "./Focuses/FocusSelector";
import { MainMenu } from "./MainMenu";

export const MainList = (props: { superstate: Superstate }) => {
  const [indexing, setIndexing] = React.useState(false);
  // const [error, resetError] = useErrorBoundary();
  // if (error) props.superstate.ui.error(error);

  // Vault file-tree text filter (bd Notidian-nrjb). Local, ephemeral UI state
  // only -- not persisted, so reopening the sidebar always starts unfiltered.
  // Gated end-to-end by settings.enableNavigatorTextFilter (DEFAULT-ON
  // kill-switch): when false, neither the box below nor a filterQuery prop are
  // ever rendered/passed, so SpaceTreeComponent's render path is byte-for-byte
  // the pre-feature one.
  const navigatorTextFilterEnabled =
    props.superstate.settings.enableNavigatorTextFilter;
  const [filterQuery, setFilterQuery] = useState("");

  useEffect(() => {
    const reindex = async () => {
      setIndexing(true);
    };
    const finishedIndex = async () => {
      setIndexing(false);
    };
    props.superstate.eventsDispatcher.addListener("superstateReindex", reindex);
    props.superstate.eventsDispatcher.addListener(
      "superstateUpdated",
      finishedIndex
    );
    return () => {
      props.superstate.eventsDispatcher.removeListener(
        "superstateReindex",
        reindex
      );
      props.superstate.eventsDispatcher.removeListener(
        "superstateUpdated",
        finishedIndex
      );
    };
  }, []);
  return (
    <>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <div className="mk-progress-bar">
          {indexing && <div className="mk-progress-bar-value"></div>}
        </div>
        {!isTouchScreen(props.superstate.ui) && (
          <MainMenu superstate={props.superstate}></MainMenu>
        )}
        <FocusSelector superstate={props.superstate}></FocusSelector>
        {navigatorTextFilterEnabled && (
          <div className="mk-navigator-filter">
            <input
              type="text"
              className="mk-navigator-filter-input"
              placeholder={i18n.labels.navigatorFilterPlaceholder}
              aria-label={i18n.labels.navigatorFilterPlaceholder}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            ></input>
            {filterQuery.length > 0 && (
              <button
                className="mk-toolbar-button mk-navigator-filter-clear"
                aria-label={i18n.labels.navigatorFilterClear}
                onClick={() => setFilterQuery("")}
                dangerouslySetInnerHTML={{
                  __html: props.superstate.ui.getSticker("ui//clear"),
                }}
              ></button>
            )}
          </div>
        )}

        <SpaceTreeComponent
          superstate={props.superstate}
          filterQuery={navigatorTextFilterEnabled ? filterQuery : undefined}
        />
      </ErrorBoundary>
    </>
  );
};

export function ErrorFallback({ error }: { error: Error }) {
  const { resetBoundary } = useErrorBoundary();

  const copyError = () => {
    navigator.clipboard.writeText(error.message);
  };
  return (
    <div role="alert">
      <p>{i18n.notice.somethingWentWrong}</p>
      <p style={{ color: "red" }}>{error.message}</p>
      <button onClick={copyError}>{i18n.notice.copyError}</button>
      <button onClick={resetBoundary}>{i18n.notice.reload}</button>
    </div>
  );
}
