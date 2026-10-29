import { pointerToPath } from "../validation/location";
import { getAt, isObj, typeList } from "./tree";

const FORMAT_SAMPLES: Record<string, string> = {
  "date-time": "2026-01-01T00:00:00Z",
  date: "2026-01-01",
  time: "00:00:00Z",
  email: "user@example.com",
  uri: "https://example.com",
  "uri-reference": "https://example.com",
  iri: "https://example.com",
  url: "https://example.com",
  uuid: "00000000-0000-4000-8000-000000000000",
  hostname: "example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
};

export function generateSample(schema: unknown, root: unknown = schema, depth = 0): unknown {
  if (!isObj(schema) || depth > 12) return null;
  const next = (s: unknown) => generateSample(s, root, depth + 1);

  if ("const" in schema) return schema.const;
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#")) {
    return next(getAt(root, pointerToPath(schema.$ref.slice(1))));
  }

  const type =
    typeList(schema)[0] ??
    (isObj(schema.properties)
      ? "object"
      : schema.items || schema.prefixItems
        ? "array"
        : undefined);
  const branches = (schema.oneOf ?? schema.anyOf) as unknown;
  if (!type && Array.isArray(branches) && branches.length) return next(branches[0]);

  let value: unknown = null;
  if (type === "object") {
    const obj: Record<string, unknown> = {};
    if (isObj(schema.properties)) {
      for (const [k, v] of Object.entries(schema.properties)) obj[k] = next(v);
    }
    value = obj;
  } else if (type === "array") {
    if (Array.isArray(schema.prefixItems)) value = schema.prefixItems.map(next);
    else if (Array.isArray(schema.items)) value = schema.items.map(next);
    else value = isObj(schema.items) ? [next(schema.items)] : [];
  } else if (type === "string") {
    const min = typeof schema.minLength === "number" ? schema.minLength : 0;
    value = FORMAT_SAMPLES[String(schema.format)] ?? "string".padEnd(min, "x");
  } else if (type === "number" || type === "integer") {
    if (typeof schema.minimum === "number") value = schema.minimum;
    else if (typeof schema.exclusiveMinimum === "number") value = schema.exclusiveMinimum + 1;
    else value = 0;
  } else if (type === "boolean") {
    value = false;
  }

  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const p = next(part);
      if (value === null) value = p;
      else if (isObj(value) && isObj(p)) value = { ...p, ...value };
    }
  }
  return value;
}
