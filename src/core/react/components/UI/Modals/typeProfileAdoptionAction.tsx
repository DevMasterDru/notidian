import { TypeProfileAdoptionModal } from "core/react/components/UI/Modals/TypeProfileAdoptionModal";
import {
  applyTypeProfileAdoptionDraft,
  buildTypeProfileAdoptionDraft,
  resolveAdoptionTargetFolder,
} from "core/superstate/utils/typeProfileAdoption";
import { Superstate } from "makemd-core";
import React from "react";

// Shared UI entry point for "Adopt schema for this database" (Notidian-loan.3,
// ADR-0056 D9), wired from BOTH surfaces the bead asks for: the command
// palette (openTypeProfileAdoptionModalForActivePath, commands.tsx) and the
// hub-note affordance (openTypeProfileAdoptionModalForFolder, SpaceHeaderBar's
// "+" menu — the folder already known, no activePath resolution needed).
//
// The confirm-gate invariant lives HERE: the modal is opened with the draft
// already computed, and `applyTypeProfileAdoptionDraft` — the only function
// in this whole feature that writes — is invoked exclusively from
// `onConfirm`, never on open, never on cancel/dismiss.
export const openTypeProfileAdoptionModalForFolder = (
  superstate: Superstate,
  folder: string,
  win: Window
): void => {
  const draft = buildTypeProfileAdoptionDraft(superstate, folder);
  if (!draft) {
    superstate.ui.notify(
      "Open a live Notidian database before adopting a schema."
    );
    return;
  }

  superstate.ui.openModal(
    "Adopt schema for this database",
    <TypeProfileAdoptionModal
      draft={draft}
      onConfirm={() => {
        void applyTypeProfileAdoptionDraft(superstate, folder, draft).then(
          (result) => {
            if (!result.ok) return; // applyTypeProfileAdoptionDraft already notified this failure (every ok:false reason notifies).
            superstate.ui.notify(
              result.addedFieldNames.length > 0
                ? `Adopted ${result.addedFieldNames.length} field${
                    result.addedFieldNames.length == 1 ? "" : "s"
                  } into ${folder}'s Type Profile.`
                : "No new fields to adopt."
            );
          }
        );
      }}
    />,
    win
  );
};

// Command-palette entry point: resolves the target folder from the active
// path (the folder itself, its hub note, or a row file inside it) since a
// palette command has no space context handed to it directly.
export const openTypeProfileAdoptionModalForActivePath = (
  superstate: Superstate,
  activePath: string | undefined | null,
  win: Window
): void => {
  const folder = resolveAdoptionTargetFolder(superstate, activePath);
  if (!folder) {
    superstate.ui.notify(
      "Open a Notidian database (or a row inside one) before adopting a schema."
    );
    return;
  }
  openTypeProfileAdoptionModalForFolder(superstate, folder, win);
};
