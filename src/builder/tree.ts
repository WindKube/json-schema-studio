export type Path = string[];
export type SchemaObject = Record<string, unknown>;

export type NodeKind =
  | "root"
  | "property"
  | "pattern"
  | "additional"
  | "items"
  | "prefix"
  | "branch"
  | "not"
  | "conditional"
  | "def";

export type TreeNode = {
  path: Path;
  key: string;
  label: string;
  kind: NodeKind;
  schema: unknown;
  depth: number;
  required: boolean;
  hasChildren: boolean;
};

type Child = { rel: Path; label: string; kind: NodeKind; schema: unknown; required: boolean };

export const COMBINATORS = ["allOf", "anyOf", "oneOf"] as const;
export const NAMED_GROUPS = ["properties", "patternProperties", "$defs", "definitions"];

export const isObj = (v: unknown): v is SchemaObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isSchema = (v: unknown) => isObj(v) || typeof v === "boolean";

export const pathKey = (path: Path) => path.join("/");

export function getAt(root: unknown, path: Path): unknown {
  let cur = root;
  for (const seg of path) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isObj(cur)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

export function typeList(schema: unknown): string[] {
  if (!isObj(schema)) return [];
  if (typeof schema.type === "string") return [schema.type];
  return Array.isArray(schema.type) ? schema.type.filter((t) => typeof t === "string") : [];
}

export function summary(schema: unknown): string {
  if (schema === true) return "any";
  if (schema === false) return "never";
  if (!isObj(schema)) return "";
  if (typeof schema.$ref === "string") return `→ ${schema.$ref.split("/").pop()}`;
  const types = typeList(schema);
  if (types.length) return types.join(" | ");
  for (const c of COMBINATORS) if (Array.isArray(schema[c])) return c;
  if (Array.isArray(schema.enum)) return "enum";
  if ("const" in schema) return "const";
  if (isObj(schema.properties)) return "object";
  return "any";
}

export function children(schema: unknown): Child[] {
  if (!isObj(schema)) return [];
  const out: Child[] = [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const add = (rel: Path, label: string, kind: NodeKind, value: unknown, req = false) => {
    if (isSchema(value)) out.push({ rel, label, kind, schema: value, required: req });
  };
  const addSlot = (key: string, label: string, kind: NodeKind) => {
    if (isObj(schema[key])) add([key], label, kind, schema[key]);
  };
  const addMap = (key: string, label: (name: string) => string, kind: NodeKind) => {
    const map = schema[key];
    if (!isObj(map)) return;
    for (const [name, value] of Object.entries(map)) {
      add([key, name], label(name), kind, value, kind === "property" && required.includes(name));
    }
  };
  const addList = (key: string, label: (i: number) => string, kind: NodeKind) => {
    const list = schema[key];
    if (!Array.isArray(list)) return;
    for (const [i, v] of list.entries()) add([key, String(i)], label(i), kind, v);
  };

  addMap("properties", (n) => n, "property");
  addMap("patternProperties", (n) => `/${n}/`, "pattern");
  addSlot("additionalProperties", "additionalProperties", "additional");
  addList("prefixItems", (i) => `[${i}]`, "prefix");
  if (Array.isArray(schema.items)) addList("items", (i) => `[${i}]`, "prefix");
  else addSlot("items", "[items]", "items");
  for (const c of COMBINATORS) addList(c, (i) => `${c}[${i}]`, "branch");
  addSlot("not", "not", "not");
  for (const k of ["if", "then", "else"]) addSlot(k, k, "conditional");
  addMap("$defs", (n) => `$defs/${n}`, "def");
  addMap("definitions", (n) => `definitions/${n}`, "def");
  return out;
}

export const ROOT_DEF_GROUPS = ["$defs", "definitions"];

function walker(
  out: TreeNode[],
  open: Map<string, boolean>,
  filter: string,
  skipRootDefs: boolean,
) {
  const q = filter.trim().toLowerCase();
  const walk = (
    schema: unknown,
    path: Path,
    label: string,
    kind: NodeKind,
    required: boolean,
    depth: number,
  ): boolean => {
    let kids = children(schema);
    if (skipRootDefs && !path.length) kids = kids.filter((c) => c.kind !== "def");
    const key = pathKey(path);
    const start = out.length;
    out.push({ path, key, label, kind, schema, depth, required, hasChildren: kids.length > 0 });
    let matched = !q || label.toLowerCase().includes(q);
    const expanded = q ? true : (open.get(key) ?? depth < 1);
    if (expanded) {
      for (const c of kids) {
        if (walk(c.schema, [...path, ...c.rel], c.label, c.kind, c.required, depth + 1)) {
          matched = true;
        }
      }
    }
    if (!matched) out.splice(start);
    return matched;
  };
  return walk;
}

// `open` overrides the default (expanded down to depth 1); a filter expands everything and
// keeps only matches plus their ancestors.
export function flatten(
  root: unknown,
  open: Map<string, boolean>,
  filter = "",
  skipRootDefs = false,
): TreeNode[] {
  const out: TreeNode[] = [];
  walker(out, open, filter, skipRootDefs)(root, [], "(root)", "root", false, 0);
  return out;
}

// Root-level $defs/definitions as top-level nodes labelled by name only.
export function flattenDefs(root: unknown, open: Map<string, boolean>, filter = ""): TreeNode[] {
  const out: TreeNode[] = [];
  if (!isObj(root)) return out;
  const walk = walker(out, open, filter, false);
  for (const group of ROOT_DEF_GROUPS) {
    const map = root[group];
    if (!isObj(map)) continue;
    for (const [name, value] of Object.entries(map)) {
      if (isObj(value) || typeof value === "boolean")
        walk(value, [group, name], name, "def", false, 0);
    }
  }
  return out;
}

export function isExpanded(node: TreeNode, open: Map<string, boolean>) {
  return open.get(node.key) ?? node.depth < 1;
}
