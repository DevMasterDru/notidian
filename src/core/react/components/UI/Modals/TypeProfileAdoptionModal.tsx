import { TypeProfileAdoptionDraft } from "core/utils/contexts/typeProfileAdopt";
import React from "react";
import { default as i18n } from "shared/i18n";

// Preview-and-confirm modal for "Adopt schema for this database" (Notidian-loan.3,
// ADR-0056 D9). Pure presentation over an already-computed draft: nothing is
// written until the owner clicks Adopt — the caller wires onConfirm to the
// confirm-gated write (core/superstate/utils/typeProfileAdoption.ts's
// applyTypeProfileAdoptionDraft). Mirrors the CsvImportModal preview/confirm
// shape (ADR-0015 doctrine): show the full draft, write only on explicit
// confirm, never auto-apply.
export const TypeProfileAdoptionModal = (props: {
  draft: TypeProfileAdoptionDraft;
  onConfirm: () => void;
  hide?: () => void;
}) => {
  const { draft, onConfirm, hide } = props;
  const fieldCount = draft.fields.length;

  const confirm = () => {
    if (fieldCount == 0) return;
    onConfirm();
    if (hide) hide();
  };

  return (
    <div className="mk-layout-column mk-gap-8 mk-type-profile-adoption">
      <div className="mk-modal-message">
        {draft.database} · {draft.rowCount} row
        {draft.rowCount == 1 ? "" : "s"} scanned
        {draft.alreadyDeclaredFieldNames.length > 0
          ? ` · ${draft.alreadyDeclaredFieldNames.length} field${
              draft.alreadyDeclaredFieldNames.length == 1 ? "" : "s"
            } already declared, left untouched`
          : ""}
      </div>

      {fieldCount == 0 ? (
        <div className="mk-type-profile-adoption-empty">
          Every field discovered on this database's rows is already declared
          in its Type Profile. Nothing to adopt.
        </div>
      ) : (
        <div className="mk-type-profile-adoption-fields">
          {draft.fields.map((fieldDraft) => {
            const { field, enumCandidate, foreignKeyCandidates, emptyEncoding } =
              fieldDraft;
            const topForeignKey = foreignKeyCandidates[0];
            return (
              <div
                className="mk-type-profile-adoption-field"
                key={field.name}
              >
                <div className="mk-type-profile-adoption-field-header">
                  <span className="mk-type-profile-adoption-field-name">
                    {field.name}
                  </span>
                  <span className="mk-type-profile-adoption-field-kind">
                    {field.kind}
                  </span>
                </div>
                {enumCandidate ? (
                  <div className="mk-type-profile-adoption-field-detail">
                    Suggested vocabulary (advisory, not enforced):{" "}
                    {enumCandidate.values.join(", ")}
                  </div>
                ) : null}
                {topForeignKey ? (
                  <div className="mk-type-profile-adoption-field-detail">
                    Looks like a reference to {topForeignKey.targetFolder} ·{" "}
                    {topForeignKey.targetKey} ({topForeignKey.overlapCount}/
                    {topForeignKey.candidateCount} values match)
                  </div>
                ) : null}
                {emptyEncoding.suggested ? (
                  <div className="mk-type-profile-adoption-field-detail">
                    Empty-value policy: {emptyEncoding.suggested} (
                    {emptyEncoding.suggested == "absent"
                      ? emptyEncoding.absentCount
                      : emptyEncoding.emptyStringCount}
                    /{draft.rowCount} rows)
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="mk-modal-actions">
        {fieldCount > 0 ? (
          <button onClick={confirm}>
            Adopt {fieldCount} field{fieldCount == 1 ? "" : "s"}
          </button>
        ) : null}
        <button onClick={() => hide && hide()}>{i18n.buttons.cancel}</button>
      </div>
    </div>
  );
};
