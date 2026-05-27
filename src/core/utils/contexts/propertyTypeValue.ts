import { fieldTypeForType } from "schemas/mdb";
import type { SpaceTableColumn } from "shared/types/mdb";
import { serializeOptionValue } from "../serializer";

export const valueForPropertyTypeChange = ({
  field,
  nextType,
  observedOptions,
}: {
  field: Pick<SpaceTableColumn, "name" | "type" | "value">;
  nextType: string;
  observedOptions?: string[];
}): string => {
  const fieldType = fieldTypeForType(field.type, field.name);
  const sameTypeFamily =
    nextType == field.type ||
    nextType == fieldType?.type ||
    nextType == fieldType?.multiType;

  if (sameTypeFamily) {
    return field.value ?? "";
  }

  if (nextType.startsWith("option")) {
    const options = [...new Set((observedOptions ?? []).filter(Boolean))].map(
      (option) => ({
        name: option,
        value: option,
      })
    );

    return serializeOptionValue(options, {});
  }

  return "";
};
