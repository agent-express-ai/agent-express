import type { ZodSchema } from "zod"

/**
 * Converts a Zod schema to a JSON Schema object for LLM tool definitions.
 *
 * Uses Zod's built-in `._def` introspection to extract the schema structure.
 * This is a minimal implementation covering common types (object, string,
 * number, boolean, array, enum, optional). For complex schemas, consider
 * using the `zod-to-json-schema` npm package.
 */
export function zodToJsonSchema(schema: ZodSchema): Record<string, unknown> {
  // Zod v3 exposes _def for introspection
  const def = (schema as any)._def

  if (!def) {
    return { type: "object" }
  }

  return convertDef(def)
}

function convertDef(def: any): Record<string, unknown> {
  const typeName = def.typeName as string | undefined

  switch (typeName) {
    case "ZodObject": {
      const shape = def.shape?.() ?? {}
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const [key, fieldSchema] of Object.entries(shape)) {
        const fieldDef = (fieldSchema as any)._def
        properties[key] = convertDef(fieldDef)

        // Check if field is optional
        if (fieldDef.typeName !== "ZodOptional" && fieldDef.typeName !== "ZodDefault") {
          required.push(key)
        }
      }

      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      }
    }

    case "ZodString":
      return { type: "string", ...(def.description ? { description: def.description } : {}) }

    case "ZodNumber":
      return { type: "number", ...(def.description ? { description: def.description } : {}) }

    case "ZodBoolean":
      return { type: "boolean" }

    case "ZodArray":
      return { type: "array", items: convertDef(def.type._def) }

    case "ZodEnum":
      return { type: "string", enum: def.values }

    case "ZodOptional":
      return convertDef(def.innerType._def)

    case "ZodDefault":
      return { ...convertDef(def.innerType._def), default: def.defaultValue() }

    case "ZodNullable":
      return { ...convertDef(def.innerType._def), nullable: true }

    default:
      return {}
  }
}
