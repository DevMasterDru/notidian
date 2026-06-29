/**
 * SpaceFilenameTemplateProperty (Notidian-pay5.1.3 / ADR 0054).
 *
 * Configuration UI for per-database filename templates. Allows the user to:
 * 1. Enter/edit a template string (e.g. `{board_id:02d}-ch{address:02d}-{device|slug}`)
 * 2. Preview what every file would be renamed to
 * 3. Bulk-rename after confirmation
 * 4. Clear the template
 *
 * Follows the exact same pattern as SpaceTemplateProperty.tsx.
 */

import { PathContext } from "core/react/context/PathContext";
import { SpaceContext } from "core/react/context/SpaceContext";
import { saveSpaceMetadataValue } from "core/superstate/utils/spaces";
import { spaceFilenameTemplateKey } from "core/types/space";
import {
  evaluateFilenameTemplate,
  parseFilenameTemplate,
  TemplateSegment,
} from "core/utils/contexts/filenameTemplate";
import { pageTitleFromPath } from "core/utils/contexts/pageTitle";
import { Superstate } from "makemd-core";
import React, { useCallback, useContext, useMemo, useState } from "react";
import { windowFromDocument } from "shared/utils/dom";
import { ConfirmationModal } from "../UI/Modals/ConfirmationModal";

type PreviewRow = {
  path: string;
  currentName: string;
  newName: string;
  changed: boolean;
};

export const SpaceFilenameTemplateProperty = (props: {
  superstate: Superstate;
}) => {
  const { pathState } = useContext(PathContext);
  const { spaceState } = useContext(SpaceContext);

  const currentTemplate = spaceState?.metadata?.filenameTemplate ?? "";
  const [templateValue, setTemplateValue] = useState(currentTemplate);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewResults, setPreviewResults] = useState<PreviewRow[]>([]);
  const [renaming, setRenaming] = useState(false);

  // Validate and save on blur/enter
  const saveTemplate = useCallback(
    (value: string) => {
      if (!pathState?.path) return;

      const trimmed = value.trim();
      if (trimmed === "") {
        // Clear the template
        setError(null);
        saveSpaceMetadataValue(
          props.superstate,
          pathState.path,
          "filenameTemplate",
          ""
        );
        setShowPreview(false);
        setPreviewResults([]);
        return;
      }

      try {
        parseFilenameTemplate(trimmed);
        setError(null);
        saveSpaceMetadataValue(
          props.superstate,
          pathState.path,
          "filenameTemplate",
          trimmed
        );
      } catch (e: any) {
        setError(e.message ?? "Invalid template");
      }
    },
    [pathState?.path, props.superstate]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveTemplate(templateValue);
      }
    },
    [templateValue, saveTemplate]
  );

  // Compute preview
  const computePreview = useCallback(() => {
    if (!spaceState?.path || !templateValue.trim()) return;

    let segments: TemplateSegment[];
    try {
      segments = parseFilenameTemplate(templateValue.trim());
    } catch (e: any) {
      setError(e.message ?? "Invalid template");
      return;
    }

    const results: PreviewRow[] = [];
    const spacePath = spaceState.path;

    // Find all files in this space
    for (const [filePath, pathEntry] of props.superstate.pathsIndex) {
      if (!pathEntry.spaces?.includes(spacePath)) continue;
      if (!filePath.endsWith(".md")) continue;

      const currentName = pageTitleFromPath(filePath);
      const frontmatter: Record<string, any> =
        pathEntry.metadata?.property ?? {};

      let newName: string;
      try {
        newName = evaluateFilenameTemplate(segments, frontmatter);
      } catch {
        newName = currentName; // keep current name on eval failure
      }

      results.push({
        path: filePath,
        currentName,
        newName,
        changed: currentName !== newName,
      });
    }

    // Sort: changed files first, then alphabetical
    results.sort((a, b) => {
      if (a.changed !== b.changed) return a.changed ? -1 : 1;
      return a.currentName.localeCompare(b.currentName);
    });

    setPreviewResults(results);
    setShowPreview(true);
    setError(null);
  }, [spaceState?.path, templateValue, props.superstate]);

  const changedCount = useMemo(
    () => previewResults.filter((r) => r.changed).length,
    [previewResults]
  );

  // Bulk rename
  const handleApply = useCallback(
    (e: React.MouseEvent) => {
      const win = windowFromDocument(e.view.document);
      props.superstate.ui.openModal(
        "Confirm Bulk Rename",
        <ConfirmationModal
          confirmAction={async () => {
            setRenaming(true);
            let renamed = 0;
            let failed = 0;
            const toRename = previewResults.filter((r) => r.changed);

            for (const row of toRename) {
              const parentDir = row.path.includes("/")
                ? row.path.slice(0, row.path.lastIndexOf("/"))
                : "";
              const newPath = parentDir
                ? `${parentDir}/${row.newName}.md`
                : `${row.newName}.md`;

              try {
                await props.superstate.spaceManager.renamePath(
                  row.path,
                  newPath
                );
                renamed++;
              } catch (err) {
                console.warn(
                  `[Notidian] Bulk rename failed for ${row.path}:`,
                  err
                );
                failed++;
              }
            }

            const msg =
              failed > 0
                ? `Renamed ${renamed} files (${failed} failed).`
                : `Renamed ${renamed} files to match template.`;
            props.superstate.ui.notify(msg, "notice");
            setRenaming(false);
            setShowPreview(false);
            setPreviewResults([]);
          }}
          confirmLabel="Rename All"
          message={`Rename ${changedCount} file${changedCount !== 1 ? "s" : ""} to match the filename template? This cannot be undone.`}
        />,
        win
      );
    },
    [previewResults, changedCount, props.superstate]
  );

  return (
    <div className="mk-space-editor-smart">
      <div className="mk-space-editor-smart-header">
        <div
          className="mk-icon-small"
          dangerouslySetInnerHTML={{
            __html: props.superstate.ui.getSticker("ui//file-text"),
          }}
        ></div>
        <span>Filename Template</span>
      </div>

      <div className="mk-space-editor-filename-template">
        <input
          className="mk-input"
          type="text"
          placeholder="{field}, {field:02d}, {field|slug}"
          value={templateValue}
          onChange={(e) => setTemplateValue(e.target.value)}
          onBlur={() => saveTemplate(templateValue)}
          onKeyDown={handleKeyDown}
        />
        <div className="mk-space-editor-filename-template-hint">
          {"Use {field}, {field:02d}, {field|slug}, {field|slug:30}"}
        </div>

        {error && (
          <div className="mk-space-editor-filename-template-error">
            {error}
          </div>
        )}

        <div className="mk-button-group mk-space-editor-filename-template-actions">
          <button
            className="mk-toolbar-button"
            onClick={computePreview}
            disabled={!templateValue.trim()}
          >
            Preview
          </button>
          {currentTemplate && (
            <button
              className="mk-toolbar-button"
              onClick={() => {
                setTemplateValue("");
                saveTemplate("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        {showPreview && previewResults.length > 0 && (
          <div className="mk-space-editor-filename-template-preview">
            <div className="mk-space-editor-filename-template-preview-summary">
              {changedCount} of {previewResults.length} file
              {previewResults.length !== 1 ? "s" : ""} would be renamed
            </div>
            <div className="mk-space-editor-filename-template-preview-list">
              {previewResults.map((row) => (
                <div
                  key={row.path}
                  className={`mk-space-editor-filename-template-preview-row${row.changed ? " mk-changed" : ""}`}
                >
                  <span className="mk-filename-current">
                    {row.currentName}
                  </span>
                  {row.changed && (
                    <>
                      <span className="mk-filename-arrow">{"→"}</span>
                      <span className="mk-filename-new">{row.newName}</span>
                    </>
                  )}
                </div>
              ))}
            </div>

            {changedCount > 0 && (
              <button
                className="mk-toolbar-button mod-cta"
                onClick={handleApply}
                disabled={renaming}
              >
                {renaming ? "Renaming..." : "Apply Template"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
