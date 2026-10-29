import {
  children,
  getAt,
  isObj,
  type Path,
  ROOT_DEF_GROUPS,
  summary,
  typeList,
} from "../builder/tree";

export type GraphNode = {
  id: string;
  path: Path | null;
  label: string;
  type: string;
  rows: [string, string][];
  required: boolean;
  kind: "schema" | "defs";
};

export type GraphEdge = { id: string; source: string; target: string; ref?: boolean };

export const DEFS_ID = "defs";
const MAX_NODES = 400;
const SHOWN = [
  "format",
  "pattern",
  "enum",
  "const",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
];

export const idOf = (path: Path) => `/${path.join("/")}`;

export function refTarget(ref: string): Path | null {
  if (!ref.startsWith("#")) return null;
  const pointer = decodeURIComponent(ref.slice(1));
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return null;
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 32 ? `${s.slice(0, 31)}…` : s;
};

function rows(schema: unknown): [string, string][] {
  if (!isObj(schema)) return [];
  const out: [string, string][] = SHOWN.filter((k) => k in schema).map((k) => [
    k,
    short(schema[k]),
  ]);
  if (typeof schema.$ref === "string" && !refTarget(schema.$ref)) {
    out.unshift(["$ref", short(schema.$ref)]);
  }
  if (schema.additionalProperties === false) out.push(["additionalProperties", "false"]);
  return out;
}

export function buildGraph(root: unknown) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let truncated = false;

  const visit = (
    schema: unknown,
    path: Path,
    label: string,
    required: boolean,
    parent?: string,
  ) => {
    if (nodes.length >= MAX_NODES) {
      truncated = true;
      return;
    }
    const id = idOf(path);
    const type = typeList(schema)[0] ?? (schema === true || schema === false ? String(schema) : "");
    nodes.push({ id, path, label, type, rows: rows(schema), required, kind: "schema" });
    if (parent) edges.push({ id: `${parent}>${id}`, source: parent, target: id });
    for (const c of children(schema)) {
      if (!path.length && c.kind === "def") continue;
      visit(c.schema, [...path, ...c.rel], c.label, c.required, id);
    }
  };

  visit(root, [], "(root)", false);

  if (isObj(root)) {
    const defs = ROOT_DEF_GROUPS.flatMap((group) =>
      isObj(root[group]) ? Object.entries(root[group]).map(([n, v]) => [group, n, v] as const) : [],
    );
    if (defs.length) {
      nodes.push({
        id: DEFS_ID,
        path: null,
        label: "Definitions",
        type: "",
        rows: [],
        required: false,
        kind: "defs",
      });
      edges.push({ id: `${idOf([])}>${DEFS_ID}`, source: idOf([]), target: DEFS_ID });
      for (const [group, name, value] of defs) visit(value, [group, name], name, false, DEFS_ID);
    }
  }

  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const schema = n.path && getAt(root, n.path);
    if (!isObj(schema) || typeof schema.$ref !== "string") continue;
    const target = refTarget(schema.$ref);
    if (target && ids.has(idOf(target))) {
      edges.push({ id: `${n.id}~>${idOf(target)}`, source: n.id, target: idOf(target), ref: true });
    }
  }

  return { nodes, edges, truncated };
}

export const typeLabel = (n: GraphNode, root: unknown) =>
  n.path ? summary(getAt(root, n.path)) : "";
