import { SpaceTreeComponent } from "core/react/components/Navigator/SpaceTree/SpaceTreeView";
import { isTouchScreen } from "core/utils/ui/screen";
import { Superstate } from "makemd-core";
import i18n from "shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { ErrorBoundary, useErrorBoundary } from "react-error-boundary";
import { NavigatorContentSearchSnapshot } from "shared/types/navigatorContentSearch";
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
  const [navigatorTextFilterEnabled, setNavigatorTextFilterEnabled] = useState(
    () => props.superstate.settings.enableNavigatorTextFilter
  );
  const [filterQuery, setFilterQuery] = useState("");
  const contentSearch = navigatorTextFilterEnabled
    ? props.superstate.navigatorContentSearch
    : null;
  const [contentSnapshot, setContentSnapshot] =
    useState<NavigatorContentSearchSnapshot>(() =>
      contentSearch?.getSnapshot() ?? { status: "unavailable", revision: 0 }
    );
  const [additionalMatchPaths, setAdditionalMatchPaths] = useState<
    ReadonlySet<string>
  >(new Set());
  const requestGeneration = useRef(0);
  const nextRequestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    const settingsChanged = () => {
      setNavigatorTextFilterEnabled(
        props.superstate.settings.enableNavigatorTextFilter
      );
    };
    props.superstate.eventsDispatcher.addListener(
      "settingsChanged",
      settingsChanged
    );
    return () => {
      props.superstate.eventsDispatcher.removeListener(
        "settingsChanged",
        settingsChanged
      );
    };
  }, [props.superstate]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!contentSearch) {
      setContentSnapshot({ status: "unavailable", revision: 0 });
      return;
    }
    setContentSnapshot(contentSearch.getSnapshot());
    return contentSearch.subscribe(setContentSnapshot);
  }, [contentSearch]);

  useEffect(() => {
    const normalizedQuery = (filterQuery ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .trim();
    const generation = ++requestGeneration.current;
    setAdditionalMatchPaths(new Set());
    if (
      !navigatorTextFilterEnabled ||
      !contentSearch ||
      normalizedQuery.length === 0 ||
      contentSnapshot.status !== "ready"
    )
      return;

    const requestId = ++nextRequestId.current;
    const revision = contentSnapshot.revision;
    const timer = setTimeout(() => {
      void contentSearch
        .search({ requestId, query: normalizedQuery, revision })
        .then((result) => {
          if (!mounted.current || requestGeneration.current !== generation)
            return;
          const currentSnapshot = contentSearch.getSnapshot();
          if (
            result.cancelled ||
            result.requestId !== requestId ||
            result.query !== normalizedQuery ||
            result.requestedRevision !== revision ||
            result.revision !== currentSnapshot.revision ||
            currentSnapshot.status !== "ready"
          )
            return;
          setAdditionalMatchPaths(new Set(result.paths));
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [
    contentSearch,
    contentSnapshot.revision,
    contentSnapshot.status,
    filterQuery,
    navigatorTextFilterEnabled,
  ]);

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
          <div className="mk-navigator-filter-container">
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
            {filterQuery.trim().length > 0 &&
              contentSnapshot.status !== "ready" && (
                <div className="mk-navigator-filter-status" role="status">
                  {contentSnapshot.status === "building"
                    ? i18n.labels.navigatorFilterBuilding
                    : i18n.labels.navigatorFilterUnavailable}
                </div>
              )}
          </div>
        )}

        <SpaceTreeComponent
          superstate={props.superstate}
          filterQuery={navigatorTextFilterEnabled ? filterQuery : undefined}
          additionalMatchPaths={
            navigatorTextFilterEnabled &&
            filterQuery.trim().length > 0 &&
            additionalMatchPaths.size > 0
              ? additionalMatchPaths
              : undefined
          }
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
