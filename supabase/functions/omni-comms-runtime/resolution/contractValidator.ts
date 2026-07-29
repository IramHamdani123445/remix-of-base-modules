// Bounded JSON Schema validator — supports the subset used by Omni-Comms
// event contracts. Deterministic. Never echoes rejected values.
import type { RuntimeValidationIssue } from "./resolutionTypes.ts";

type Schema = Record<string, unknown>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(schemaType: unknown, value: unknown): boolean {
  const t = typeOf(value);
  if (typeof schemaType === "string") {
    if (schemaType === "number") return t === "number" || t === "integer";
    return t === schemaType;
  }
  if (Array.isArray(schemaType)) {
    return schemaType.some((st) => typeMatches(st, value));
  }
  return true;
}

function validateNode(
  schema: Schema,
  value: unknown,
  path: string,
  issues: RuntimeValidationIssue[],
): void {
  if (schema.type !== undefined && !typeMatches(schema.type, value)) {
    issues.push({ path, code: "type_mismatch" });
    return;
  }

  if (Array.isArray(schema.enum)) {
    // Enum equality by JSON canonical string.
    const target = JSON.stringify(value);
    const ok = (schema.enum as unknown[]).some((e) => JSON.stringify(e) === target);
    if (!ok) issues.push({ path, code: "enum_mismatch" });
  }

  const t = typeOf(value);
  if (t === "string" && typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < (schema.minLength as number)) {
      issues.push({ path, code: "min_length" });
    }
    if (typeof schema.maxLength === "number" && value.length > (schema.maxLength as number)) {
      issues.push({ path, code: "max_length" });
    }
    if (typeof schema.pattern === "string") {
      try {
        const re = new RegExp(schema.pattern as string);
        if (!re.test(value)) issues.push({ path, code: "pattern_mismatch" });
      } catch {
        issues.push({ path, code: "pattern_invalid" });
      }
    }
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      issues.push({ path, code: "format_email" });
    }
  }

  if ((t === "number" || t === "integer") && typeof value === "number") {
    if (typeof schema.minimum === "number" && value < (schema.minimum as number)) {
      issues.push({ path, code: "minimum" });
    }
    if (typeof schema.maximum === "number" && value > (schema.maximum as number)) {
      issues.push({ path, code: "maximum" });
    }
  }

  if (t === "array" && Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < (schema.minItems as number)) {
      issues.push({ path, code: "min_items" });
    }
    if (typeof schema.maxItems === "number" && value.length > (schema.maxItems as number)) {
      issues.push({ path, code: "max_items" });
    }
    if (schema.items && typeof schema.items === "object") {
      value.forEach((el, i) => validateNode(schema.items as Schema, el, `${path}[${i}]`, issues));
    }
  }

  if (t === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) issues.push({ path: `${path}/${key}`, code: "required" });
      }
    }
    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, sub] of Object.entries(schema.properties as Record<string, unknown>)) {
        if (key in obj && sub && typeof sub === "object") {
          validateNode(sub as Schema, obj[key], `${path}/${key}`, issues);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties as object));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          issues.push({ path: `${path}/${key}`, code: "unexpected_property" });
        }
      }
    }
  }
}

const MAX_ISSUES = 32;

export function validatePayload(
  schema: unknown,
  payload: unknown,
): RuntimeValidationIssue[] {
  if (!schema || typeof schema !== "object") return [{ path: "", code: "schema_invalid" }];
  const issues: RuntimeValidationIssue[] = [];
  validateNode(schema as Schema, payload, "", issues);
  return issues.slice(0, MAX_ISSUES);
}
