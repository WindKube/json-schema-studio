import { getAt, isObj, type SchemaObject, typeList } from "../builder/tree";
import { pointerToPath } from "../validation/location";

export function mergeSchemas(a: SchemaObject, b: SchemaObject): SchemaObject {
  const merged: SchemaObject = { ...a, ...b };
  if (isObj(a.properties) || isObj(b.properties)) {
    merged.properties = { ...(a.properties as object), ...(b.properties as object) };
  }
  const required = [
    ...(Array.isArray(a.required) ? a.required : []),
    ...(Array.isArray(b.required) ? b.required : []),
  ];
  if (required.length) merged.required = [...new Set(required)];
  return merged;
}

// Follows local $refs and folds allOf into one schema, so a field only has to look at one object.
// Remote $refs can't be resolved here; such fields fall back to a raw JSON input.
export function resolve(schema: unknown, root: unknown, depth = 0): SchemaObject {
  if (!isObj(schema) || depth > 20) return {};
  let out = schema;
  if (typeof out.$ref === "string" && out.$ref.startsWith("#")) {
    const { $ref, ...rest } = out;
    const target = resolve(getAt(root, pointerToPath(($ref as string).slice(1))), root, depth + 1);
    out = mergeSchemas(target, rest);
  }
  if (Array.isArray(out.allOf)) {
    const { allOf, ...rest } = out;
    out = (allOf as unknown[]).reduce<SchemaObject>(
      (acc, part) => mergeSchemas(acc, resolve(part, root, depth + 1)),
      rest,
    );
  }
  return out;
}

export function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return isObj(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "null":
      return value === null;
    default:
      return typeof value === type;
  }
}

export function inferType(s: SchemaObject, value?: unknown): string | undefined {
  const types = typeList(s);
  if (types.length) return types.find((t) => typeMatches(t, value)) ?? types[0];
  if (isObj(s.properties) || isObj(s.patternProperties)) return "object";
  if (isObj(s.items) || Array.isArray(s.prefixItems)) return "array";
  return undefined;
}

// A cheap guess at which oneOf/anyOf branch the current value belongs to.
export function pickBranch(branches: unknown[], value: unknown, root: unknown): number {
  if (value === undefined) return 0;
  const index = branches.findIndex((b) => {
    const s = resolve(b, root);
    if ("const" in s) return JSON.stringify(s.const) === JSON.stringify(value);
    if (Array.isArray(s.enum))
      return s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
    const type = inferType(s, value);
    if (type && !typeMatches(type, value)) return false;
    if (!isObj(value)) return true;
    const required = Array.isArray(s.required) ? s.required : [];
    if (!required.every((k) => k in value)) return false;
    const props = isObj(s.properties) ? s.properties : {};
    return Object.entries(props).every(
      ([k, p]) =>
        !(isObj(p) && "const" in p && k in value) ||
        JSON.stringify(p.const) === JSON.stringify(value[k]),
    );
  });
  return Math.max(index, 0);
}

export function emptyValue(schema: unknown, root: unknown): unknown {
  const s = resolve(schema, root);
  if ("const" in s) return s.const;
  if ("default" in s) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const branches = s.oneOf ?? s.anyOf;
  if (Array.isArray(branches) && branches.length && !inferType(s))
    return emptyValue(branches[0], root);
  switch (inferType(s)) {
    case "object":
      return {};
    case "array":
      return [];
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}
