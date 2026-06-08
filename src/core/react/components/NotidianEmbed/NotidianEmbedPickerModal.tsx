import type { Superstate } from "makemd-core";
import React, { useMemo, useState } from "react";
import type { NotidianEmbedDescriptor } from "core/utils/embeds/notidianEmbed";

export const NotidianEmbedPickerModal = (props: {
  superstate: Superstate;
  saveLabel: string;
  onChoose: (descriptor: NotidianEmbedDescriptor) => void;
}) => {
  const spaces = useMemo(
    () =>
      Array.from((props.superstate as any).spacesIndex?.values?.() ?? [])
        .filter((space: any) => space?.path)
        .map((space: any) => ({
          path: space.path,
          name: space.name || space.path,
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [props.superstate]
  );
  const [target, setTarget] = useState(spaces[0]?.path ?? "");

  return (
    <div className="mk-notidian-embed-picker">
      <label>
        <div>Database</div>
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {spaces.map((space) => (
            <option key={space.path} value={space.path}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!target}
        onClick={() =>
          props.onChoose({
            target,
            kind: "view",
            id: "filesView",
            title: true,
            editable: false,
          })
        }
      >
        {props.saveLabel}
      </button>
    </div>
  );
};
