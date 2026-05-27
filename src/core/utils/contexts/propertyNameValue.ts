import type { SpaceTableColumn } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";
import { sanitizeColumnName } from "shared/utils/sanitizers";
import { isFrontmatterBackedProperty } from "../properties/allProperties";

const fieldWithAlias = (
  field: Pick<SpaceTableColumn, "name" | "type" | "value" | "source">,
  alias: string
): SpaceTableColumn => {
  const fieldValue = safelyParseJSON(field.value);
  return {
    ...field,
    value: JSON.stringify({
      ...fieldValue,
      alias,
    }),
  };
};

export const fieldForPropertyNameInput = ({
  field,
  value,
  editable,
}: {
  field: Pick<SpaceTableColumn, "name" | "type" | "value" | "source">;
  value: string;
  editable: boolean;
}): SpaceTableColumn => {
  const sanitizedName = sanitizeColumnName(value);
  if (
    sanitizedName != value ||
    !editable ||
    isFrontmatterBackedProperty(field)
  ) {
    return fieldWithAlias(field, value);
  }
  return { ...field, name: value };
};
