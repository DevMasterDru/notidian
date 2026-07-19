import React, { useCallback, useEffect, useRef, useState } from "react";
import i18n from "shared/i18n";

export const ConfirmationModal = (props: {
  hide?: () => void;
  confirmAction: () => void | Promise<void>;
  reportError: (error: unknown) => void;
  message: string;
  confirmLabel: string;
}) => {
  const { hide, confirmAction, reportError, message, confirmLabel } = props;
  const inFlight = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const confirm = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setConfirming(true);
    try {
      await confirmAction();
      hide?.();
    } catch (error) {
      reportError(error);
      inFlight.current = false;
      setConfirming(false);
    }
  }, [confirmAction, hide, reportError]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        confirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirm]);
  return (
    <div className="mk-modal-contents">
      <div className="mk-modal-message">{message}</div>
      <div className="mk-button-group">
        <button onClick={() => void confirm()} disabled={confirming} tabIndex={0} className="mod-warning">
          {confirmLabel}
        </button>
        <button onClick={() => hide && hide()} tabIndex={0}>
          {i18n.buttons.cancel}
        </button>
      </div>
    </div>
  );
};
