import React, { useMemo, useState } from "react";
import { defaultContextSchemaID } from "shared/schemas/context";
import { CrossDatabaseSourceDefinition } from "shared/types/mframe";
import { Filter } from "shared/types/predicate";
import {
  crossDatabaseSourceFilterIssue,
  normalizeCrossDatabaseSources,
} from "core/utils/contexts/crossDatabaseView";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import { filterFnLabels } from "core/utils/contexts/predicate/filterFns/filterFnLabels";

export type CrossDatabaseSourceContextOption = {
  path: string;
  name: string;
  schemas: Array<{
    id: string;
    name: string;
    fields?: Array<{ name: string; type: string }>;
  }>;
};

export const buildCrossDatabaseSourceContextOptions = (
  contextsIndex: Map<string, any>,
  spacesIndex: Map<string, any>
): CrossDatabaseSourceContextOption[] =>
  Array.from(contextsIndex.entries())
    .filter(([, context]) => (context?.schemas?.length ?? 0) > 0)
    .map(([path, context]) => ({
      path,
      name: spacesIndex.get(path)?.name ?? path,
      schemas: context.schemas.map((schema: { id: string; name: string }) => {
        const table =
          context.mdb?.[schema.id] ??
          (context.contextTable?.schema?.id == schema.id
            ? context.contextTable
            : undefined);
        return {
          id: schema.id,
          name: schema.name,
          fields: (table?.cols ?? []).map(
            (field: { name: string; type: string }) => ({
              name: field.name,
              type: field.type,
            })
          ),
        };
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

const blankSource = (): CrossDatabaseSourceDefinition => ({
  context: "",
  db: defaultContextSchemaID,
  label: "",
  fields: {},
});

const operatorsForField = (field: { name: string; type: string }): string[] =>
  Object.keys(filterFnTypes).filter((operator) => {
    const definition = filterFnTypes[operator];
    return (
      definition.type.includes(field.type) &&
      (!definition.scopedFields?.length ||
        definition.scopedFields.includes(field.name.toLowerCase()))
    );
  });

const blankFilter = (
  fields: Array<{ name: string; type: string }>
): Filter | undefined => {
  const field = fields.find((candidate) => operatorsForField(candidate).length > 0);
  if (!field) return undefined;
  const fn = operatorsForField(field)[0];
  return {
    field: field.name,
    fn,
    value: "",
    fType: filterFnTypes[fn].valueType,
  };
};

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
          ...(Array.isArray(source.filters)
            ? {
                filters: source.filters.map((filter) =>
                  filter && typeof filter == "object"
                    ? { ...filter }
                    : filter
                ) as Filter[],
              }
            : source.filters === undefined
              ? {}
              : { filters: source.filters }),
        }))
      : [blankSource()]
  );
  const normalized = useMemo(
    () => normalizeCrossDatabaseSources(drafts),
    [drafts]
  );
  const invalidFilters = normalized.some((source) => {
    const context = props.contexts.find(
      (candidate) => candidate.path == source.context
    );
    const schema = context?.schemas.find((candidate) => candidate.id == source.db);
    return !!crossDatabaseSourceFilterIssue(source, {
      cols: (schema?.fields ?? []).map((field) => ({
        ...field,
        schemaId: source.db,
      })),
    });
  });
  const canSave = normalized.length >= 2 && !invalidFilters;
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
        const fields =
          schemas.find((schema) => schema.id == source.db)?.fields ?? [];
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
            <div className="mk-layout-column mk-gap-4 mk-cross-database-source-filters">
              <span>Source filters</span>
              {(Array.isArray(source.filters) ? source.filters : []).map(
                (filter, filterIndex) => {
                  const selectedField = fields.find(
                    (field) => field.name == filter.field
                  );
                  const operators = selectedField
                    ? operatorsForField(selectedField)
                    : [];
                  return (
                    <div
                      key={filterIndex}
                      className="mk-layout-row mk-gap-4 mk-cross-database-source-filter"
                    >
                      <label>
                        Field
                        <select
                          className="mk-input"
                          aria-label={`Source ${index + 1} filter ${filterIndex + 1} field`}
                          value={filter.field}
                          onChange={(event) => {
                            const field = fields.find(
                              (candidate) => candidate.name == event.target.value
                            );
                            const fn = field
                              ? operatorsForField(field)[0]
                              : undefined;
                            if (!field || !fn) return;
                            update(index, {
                              filters: source.filters!.map((candidate, candidateIndex) =>
                                candidateIndex == filterIndex
                                  ? {
                                      ...candidate,
                                      field: field.name,
                                      fn,
                                      fType: filterFnTypes[fn].valueType,
                                    }
                                  : candidate
                              ),
                            });
                          }}
                        >
                          <option value="" disabled>
                            Select field
                          </option>
                          {fields
                            .filter(
                              (candidate) =>
                                operatorsForField(candidate).length > 0
                            )
                            .map((field) => (
                              <option key={field.name} value={field.name}>
                                {field.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Operator
                        <select
                          className="mk-input"
                          aria-label={`Source ${index + 1} filter ${filterIndex + 1} operator`}
                          value={filter.fn}
                          onChange={(event) => {
                            const fn = event.target.value;
                            update(index, {
                              filters: source.filters!.map((candidate, candidateIndex) =>
                                candidateIndex == filterIndex
                                  ? {
                                      ...candidate,
                                      fn,
                                      fType: filterFnTypes[fn].valueType,
                                    }
                                  : candidate
                              ),
                            });
                          }}
                        >
                          <option value="" disabled>
                            Select operator
                          </option>
                          {operators.map((operator) => (
                            <option key={operator} value={operator}>
                              {filterFnLabels[operator] ?? operator}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Value
                        <input
                          className="mk-input"
                          aria-label={`Source ${index + 1} filter ${filterIndex + 1} value`}
                          value={filter.value}
                          onChange={(event) =>
                            update(index, {
                              filters: source.filters!.map((candidate, candidateIndex) =>
                                candidateIndex == filterIndex
                                  ? { ...candidate, value: event.target.value }
                                  : candidate
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove source ${index + 1} filter ${filterIndex + 1}`}
                        onClick={() => {
                          const filters = source.filters!.filter(
                            (_, candidateIndex) => candidateIndex != filterIndex
                          );
                          update(index, {
                            ...(filters.length > 0
                              ? { filters }
                              : { filters: undefined }),
                          });
                        }}
                      >
                        Remove filter
                      </button>
                    </div>
                  );
                }
              )}
              <button
                type="button"
                disabled={!blankFilter(fields)}
                onClick={() => {
                  const filter = blankFilter(fields);
                  if (!filter) return;
                  update(index, {
                    filters: [...(source.filters ?? []), filter],
                  });
                }}
              >
                Add filter
              </button>
            </div>
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
      {invalidFilters && (
        <div className="mk-view-config-warning">
          Every source filter must use a field and operator supported by its selected database.
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
