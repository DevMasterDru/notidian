import React, { useState } from "react";
import { BaseExportPreview } from "core/utils/bases/baseExportWorkflow";

export const BaseExportPreviewModal = (props: {
  preview: BaseExportPreview;
  exportAction: () => Promise<void>;
  hide?: () => void;
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");

  const exportBase = async () => {
    setIsExporting(true);
    setError("");
    try {
      await props.exportAction();
      props.hide?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="mk-modal-contents">
      <div className="mk-modal-message">
        Export path: <code>{props.preview.outputPath}</code>
      </div>
      {props.preview.unsupported.length > 0 && (
        <div className="mk-modal-card">
          <div className="mk-modal-heading">Unsupported Notidian semantics</div>
          <div className="mk-modal-description">
            These items are not included in the `.base` file.
          </div>
          <ul>
            {props.preview.unsupported.map((item, index) => (
              <li key={`${item.column ?? "global"}-${index}`}>
                {item.column ? <code>{item.column}</code> : "View"}:{" "}
                {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <textarea
        readOnly
        value={props.preview.yaml}
        className="mk-input"
        style={{
          boxSizing: "border-box",
          fontFamily: "var(--font-monospace)",
          minHeight: "260px",
          resize: "vertical",
          whiteSpace: "pre",
          width: "100%",
        }}
      />
      {error && <div className="mk-modal-message">{error}</div>}
      <div className="mk-button-group">
        <button onClick={() => exportBase()} disabled={isExporting}>
          {isExporting ? "Exporting..." : "Export .base"}
        </button>
        <button onClick={() => props.hide?.()} disabled={isExporting}>
          Cancel
        </button>
      </div>
    </div>
  );
};
