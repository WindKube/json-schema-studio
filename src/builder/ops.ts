import { getAt, isObj, NAMED_GROUPS, type Path, type SchemaObject } from "./tree";

type Result = { root: unknown; path: Path };

const TYPE_KEYWORDS: Record<string, string[]> = {
  string: ["minLength", "maxLength", "pattern", "format", "contentEncoding", "contentMediaType"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  array: [
    "items",
    "prefixItems",
    "additionalItems",
    "minItems",
    "maxItems",
    "uniqueItems",
    "contains",
    "minContains",
    "maxContains",
    "unevaluatedItems",
  ],
  object: [
    "properties",
    "required",
    "additionalProperties",
    "patternProperties",
    "minProperties",
    "maxProperties",
    "propertyNames",
    "dependentRequired",
    "dependentSchemas",
    "dependencies",
    "unevaluatedProperties",
  ],
};

function edit(root: unknown, path: Path, fn: (node: SchemaObject) => void): unknown {
  const next: unknown = isObj(root) ? structuredClone(root) : {};
  if (!path.length) {
    fn(next as SchemaObject);
    return next;
  }
  const parent = getAt(next, path.slice(0, -1)) as Record<string, unknown>;
  const key = path[path.length - 1];
  if (!isObj(parent[key])) parent[key] = {};
  fn(parent[key] as SchemaObject);
  return next;
}

export function setKeys(root: unknown, path: Path, patch: Record<string, unknown>): unknown {
  return edit(root, path, (node) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete node[k];
      else node[k] = v;
    }
  });
}

export function replaceNode(root: unknown, path: Path, value: unknown): unknown {
  if (!path.length) return structuredClone(value);
  const next = structuredClone(root);
  const parent = getAt(next, path.slice(0, -1)) as Record<string, unknown>;
  parent[path[path.length - 1]] = structuredClone(value);
  return next;
}

// Drops keywords that only apply to types no longer allowed, so switching string → object
// doesn't leave a stray minLength behind.
export function setType(root: unknown, path: Path, types: string[]): unknown {
  return edit(root, path, (node) => {
    if (!types.length) {
      delete node.type;
      return;
    }
    node.type = types.length === 1 ? types[0] : types;
    const allowed = new Set(types.map((t) => (t === "integer" ? "number" : t)));
    for (const [group, keys] of Object.entries(TYPE_KEYWORDS)) {
      if (!allowed.has(group)) for (const k of keys) delete node[k];
    }
  });
}

function uniqueName(existing: object, base: string): string {
  let name = base;
  for (let i = 2; name in existing; i++) name = `${base}${i}`;
  return name;
}

export function addProperty(root: unknown, path: Path): Result {
  let name = "";
  const next = edit(root, path, (node) => {
    if (!node.type && !node.$ref) node.type = "object";
    if (!isObj(node.properties)) node.properties = {};
    name = uniqueName(node.properties as object, "newProperty");
    (node.properties as SchemaObject)[name] = { type: "string" };
  });
  return { root: next, path: [...path, "properties", name] };
}

export function addDefinition(root: unknown, path: Path): Result {
  let group = "$defs";
  let name = "";
  const next = edit(root, path, (node) => {
    if (isObj(node.definitions) && !isObj(node.$defs)) group = "definitions";
    if (!isObj(node[group])) node[group] = {};
    name = uniqueName(node[group] as object, "NewDefinition");
    (node[group] as SchemaObject)[name] = { type: "object" };
  });
  return { root: next, path: [...path, group, name] };
}

export function addPatternProperty(root: unknown, path: Path): Result {
  let name = "";
  const next = edit(root, path, (node) => {
    if (!isObj(node.patternProperties)) node.patternProperties = {};
    name = uniqueName(node.patternProperties as object, "^pattern$");
    (node.patternProperties as SchemaObject)[name] = { type: "string" };
  });
  return { root: next, path: [...path, "patternProperties", name] };
}

export function appendSubschema(root: unknown, path: Path, keyword: string): Result {
  let index = 0;
  const next = edit(root, path, (node) => {
    if (!Array.isArray(node[keyword])) node[keyword] = [];
    const list = node[keyword] as unknown[];
    list.push({});
    index = list.length - 1;
  });
  return { root: next, path: [...path, keyword, String(index)] };
}

export function setSlot(root: unknown, path: Path, keyword: string, value: unknown): Result {
  return { root: setKeys(root, path, { [keyword]: value }), path: [...path, keyword] };
}

export function setRequired(root: unknown, propertyPath: Path, on: boolean): unknown {
  const name = propertyPath[propertyPath.length - 1];
  return edit(root, propertyPath.slice(0, -2), (node) => {
    const list = Array.isArray(node.required) ? node.required.filter((r) => r !== name) : [];
    if (on) list.push(name);
    if (list.length) node.required = list;
    else delete node.required;
  });
}

function rewriteRefs(value: unknown, from: string, to: string): void {
  if (Array.isArray(value)) {
    for (const v of value) rewriteRefs(v, from, to);
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "$ref" && typeof v === "string" && (v === from || v.startsWith(`${from}/`))) {
        value[k] = to + v.slice(from.length);
      } else {
        rewriteRefs(v, from, to);
      }
    }
  }
}

const escapePointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

// Renames a key in properties/patternProperties/$defs/definitions, keeping key order, the
// required list and (for definitions) every $ref that points at it.
export function renameNode(root: unknown, path: Path, newName: string): Result | string {
  const group = path[path.length - 2];
  const oldName = path[path.length - 1];
  const parentPath = path.slice(0, -2);
  if (!NAMED_GROUPS.includes(group)) return "This node can't be renamed.";
  if (!newName) return "Name can't be empty.";
  if (newName === oldName) return { root, path };
  const map = getAt(root, [...parentPath, group]);
  if (isObj(map) && newName in map) return `"${newName}" already exists.`;
  const next = edit(root, parentPath, (node) => {
    node[group] = Object.fromEntries(
      Object.entries(node[group] as SchemaObject).map(([k, v]) => [k === oldName ? newName : k, v]),
    );
    if (group === "properties" && Array.isArray(node.required)) {
      node.required = node.required.map((r) => (r === oldName ? newName : r));
    }
  });
  if (group === "$defs" || group === "definitions") {
    const base = `#/${[...parentPath, group].map(escapePointer).join("/")}`;
    rewriteRefs(next, `${base}/${escapePointer(oldName)}`, `${base}/${escapePointer(newName)}`);
  }
  return { root: next, path: [...parentPath, group, newName] };
}

export function removeNode(root: unknown, path: Path): unknown {
  if (!path.length) return root;
  const next = structuredClone(root);
  const containerPath = path.slice(0, -1);
  const container = getAt(next, containerPath);
  const key = path[path.length - 1];
  if (Array.isArray(container)) {
    container.splice(Number(key), 1);
    if (!container.length) {
      const owner = getAt(next, containerPath.slice(0, -1)) as SchemaObject;
      delete owner[containerPath[containerPath.length - 1]];
    }
    return next;
  }
  delete (container as SchemaObject)[key];
  if (path[path.length - 2] === "properties") return setRequired(next, path, false);
  return next;
}

export function canMove(path: Path): boolean {
  return path.length >= 2;
}

export function moveNode(root: unknown, path: Path, delta: -1 | 1): Result {
  const containerPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const next = structuredClone(root);
  const container = getAt(next, containerPath);
  if (Array.isArray(container)) {
    const i = Number(key);
    const j = i + delta;
    if (j < 0 || j >= container.length) return { root, path };
    [container[i], container[j]] = [container[j], container[i]];
    return { root: next, path: [...containerPath, String(j)] };
  }
  if (!isObj(container)) return { root, path };
  const entries = Object.entries(container);
  const i = entries.findIndex(([k]) => k === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= entries.length) return { root, path };
  [entries[i], entries[j]] = [entries[j], entries[i]];
  const owner = containerPath.length
    ? (getAt(next, containerPath.slice(0, -1)) as SchemaObject)
    : null;
  const reordered = Object.fromEntries(entries);
  if (!owner) return { root: reordered, path };
  owner[containerPath[containerPath.length - 1]] = reordered;
  return { root: next, path };
}
