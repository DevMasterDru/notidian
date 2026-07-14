import React, { useMemo, useState } from "react";
import { defaultContextSchemaID } from "shared/schemas/context";
import { CrossDatabaseSourceDefinition } from "shared/types/mframe";
import { normalizeCrossDatabaseSources } from "core/utils/contexts/crossDatabaseView";

export type CrossDatabaseSourceContextOption = {
  path: string;
  name: string;
  schemas: Array<{ id: string; name: string }>;
};

const blankSource = (): CrossDatabaseSourceDefinition => ({
  context: "",
  db: defaultContextSchemaID,
  label: "",
  fields: {},
});

export const parseCrossDatabaseFieldMappings = (
  value: string
): Record<string, string> =>
  value.split(/\r?\n/).reduce<Record<string, string>>((result, line) => {
    const separator = line.indexOf("=");
    if (separator < 1) return result;
    const canonical = line.slice(0, separator).trim();
    const source = line.slice(separator + 1).trim();
    if (canonical && source) result[canonical] = source;
    return result;
  }, {});

export const formatCrossDatabaseFieldMappings = (
  fields: Record<string, string>
): string =>
  Object.entries(fields)
    .map(([canonical, source]) => `${canonical}=${source}`)
    .join("\n");

export const CrossDatabaseSourcesModal = (props: {
  sources: CrossDatabaseSourceDefinition[];
  contexts: CrossDatabaseSourceContextOption[];
  onSave: (sources: CrossDatabaseSourceDefinition[]) => void;
  hide?: () => void;
}) => {
  const [drafts, setDrafts] = useState<CrossDatabaseSourceDefinition[]>(() =>
    props.sources.length > 0
      ? props.sources.map((source) => ({
          ...source,
          fields: { ...source.fields },
        }))
      : [blankSource()]
  );
  const normalized = useMemo(
    () => normalizeCrossDatabaseSources(drafts),
    [drafts]
  );
  const canSave = normalized.length >= 2;
  const contextListId = "notidian-cross-database-contexts";

  const update = (
    index: number,
    patch: Partial<CrossDatabaseSourceDefinition>
  ) =>
    setDrafts((current) =>
      current.map((source, sourceIndex) =>
        sourceIndex == index ? { ...source, ...patch } : source
      )
    );

  return (
    <div className="mk-layout-column mk-gap-8 mk-cross-database-sources">
      <p>
        Combine rows from two or more Notidian databases. Map each canonical
        view field to the property name used by that source, one mapping per
        line as canonical=sourceField.
      </p>
      <datalist id={contextListId}>
        {props.contexts.map((context) => (
          <option key={context.path} value={context.path}>
            {context.name}
          </option>
        ))}
      </datalist>

      {drafts.map((source, index) => {
        const context = props.contexts.find(
          (candidate) => candidate.path == source.context.trim()
        );
        const schemas = context?.schemas ?? [];
        return (
          <section
            key={index}
            className="mk-layout-column mk-gap-4 mk-cross-database-source"
          >
            <strong>Source {index + 1}</strong>
            <label>
              Context
              <input
                className="mk-input"
                aria-label={`Source ${index + 1} context`}
                list={contextListId}
                value={source.context}
                onChange={(event) => {
                  const nextContext = event.target.value;
                  const option = props.contexts.find(
                    (candidate) => candidate.path == nextContext.trim()
                  );
                  update(index, {
                    context: nextContext,
                    db:
                      option?.schemas.some((schema) => schema.id == source.db)
                        ? source.db
                        : (option?.schemas[0]?.id ?? defaultContextSchemaID),
                    label:
                      source.label || option?.name || nextContext.trim(),
                  });
                }}
              />
            </label>
            <label>
              Database
              <select
                className="mk-input"
                aria-label={`Source ${index + 1} database`}
                value={source.db || defaultContextSchemaID}
                onChange={(event) => update(index, { db: event.target.value })}
              >
                {(schemas.length > 0
                  ? schemas
                  : [{ id: defaultContextSchemaID, name: "Items" }]
                ).map((schema) => (
                  <option key={schema.id} value={schema.id}>
                    {schema.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source label
              <input
                className="mk-input"
                aria-label={`Source ${index + 1} label`}
                value={source.label ?? ""}
                onChange={(event) => update(index, { label: event.target.value })}
              />
            </label>
            <label>
              Shared-field mappings
              <textarea
                className="mk-input"
                aria-label={`Source ${index + 1} field mappings`}
                value={formatCrossDatabaseFieldMappings(source.fields)}
                onChange={(event) =>
                  update(index, {
                    fields: parseCrossDatabaseFieldMappings(event.target.value),
                  })
                }
                rows={5}
                placeholder={"priority=priority_num\nstatus=state"}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setDrafts((current) =>
                  current.filter((_, sourceIndex) => sourceIndex != index)
                )
              }
            >
              Remove source
            </button>
          </section>
        );
      })}

      <button
        type="button"
        onClick={() => setDrafts((current) => [...current, blankSource()])}
      >
        Add source
      </button>
      {normalized.length < 2 && (
        <div className="mk-view-config-warning">
          Add at least two valid source contexts.
        </div>
      )}
      <div className="mk-modal-actions">
        <button
          type="button"
          disabled={!canSave}
          aria-disabled={!canSave}
          onClick={() => {
            if (!canSave) return;
            props.onSave(normalized);
            props.hide?.();
          }}
        >
          Save sources
        </button>
        <button type="button" onClick={() => props.hide?.()}>
          Cancel
        </button>
      </div>
    </div>
  );
};
