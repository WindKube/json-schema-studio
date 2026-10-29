import { isObj, typeList } from "../builder/tree";

export type Level = "breaking" | "minor" | "patch";
export type Change = { level: Level; path: string; text: string };

const LOWER_BOUNDS = [
  "minimum",
  "exclusiveMinimum",
  "minLength",
  "minItems",
  "minProperties",
  "minContains",
];
const UPPER_BOUNDS = [
  "maximum",
  "exclusiveMaximum",
  "maxLength",
  "maxItems",
  "maxProperties",
  "maxContains",
];
const DOCS = [
  "title",
  "description",
  "examples",
  "default",
  "$comment",
  "deprecated",
  "readOnly",
  "writeOnly",
];
const SUBSCHEMA_MAPS = ["properties", "$defs", "definitions", "patternProperties"];
const HANDLED = new Set([
  "type",
  "required",
  "enum",
  "const",
  "additionalProperties",
  "items",
  "pattern",
  "format",
  "multipleOf",
  "uniqueItems",
  ...LOWER_BOUNDS,
  ...UPPER_BOUNDS,
  ...DOCS,
  ...SUBSCHEMA_MAPS,
]);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const esc = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");
const show = (v: unknown) => JSON.stringify(v);

// Classifies how a schema change affects documents that were valid before: breaking means some
// previously valid document may now be rejected.
export function classify(before: unknown, after: unknown): Change[] {
  const out: Change[] = [];
  walk(before, after, "", out);
  return out;
}

function walk(a: unknown, b: unknown, path: string, out: Change[]) {
  const add = (level: Level, text: string, sub = "") =>
    out.push({ level, path: `${path}${sub}` || "/", text });
  if (same(a, b)) return;
  if (!isObj(a) || !isObj(b)) {
    if (b === false || a === true || a === undefined) add("breaking", "schema now rejects more");
    else add(b === true ? "minor" : "breaking", "schema replaced");
    return;
  }

  const ta = typeList(a);
  const tb = typeList(b);
  const removed = ta.length ? (tb.length ? ta.filter((t) => !tb.includes(t)) : []) : tb;
  const widened = tb.length ? tb.filter((t) => !ta.includes(t)) : ta.length ? ["any"] : [];
  if (removed.length)
    add(
      "breaking",
      ta.length
        ? `type no longer allows ${removed.join(", ")}`
        : `type restricted to ${tb.join(", ")}`,
      "/type",
    );
  if (ta.length && widened.length && !removed.length)
    add("minor", `type also allows ${widened.join(", ")}`, "/type");

  const ra = (Array.isArray(a.required) ? a.required : []) as string[];
  const rb = (Array.isArray(b.required) ? b.required : []) as string[];
  for (const r of rb.filter((r) => !ra.includes(r)))
    add("breaking", `“${r}” added to required`, "/required");
  for (const r of ra.filter((r) => !rb.includes(r)))
    add("minor", `“${r}” no longer required`, "/required");

  if (!same(a.enum, b.enum)) {
    const ea = Array.isArray(a.enum) ? a.enum : null;
    const eb = Array.isArray(b.enum) ? b.enum : null;
    if (!eb) add("minor", "enum removed", "/enum");
    else if (!ea) add("breaking", `restricted to ${eb.map(show).join(", ")}`, "/enum");
    else {
      const gone = ea.filter((v) => !eb.some((w) => same(v, w)));
      const added = eb.filter((v) => !ea.some((w) => same(v, w)));
      if (gone.length) add("breaking", `${gone.map(show).join(", ")} no longer allowed`, "/enum");
      if (added.length) add("minor", `${added.map(show).join(", ")} now allowed`, "/enum");
    }
  }
  if (!same(a.const, b.const))
    add(b.const === undefined ? "minor" : "breaking", "const changed", "/const");

  for (const k of LOWER_BOUNDS) bound(k, a[k], b[k], (x, y) => y > x);
  for (const k of UPPER_BOUNDS) bound(k, a[k], b[k], (x, y) => y < x);
  function bound(k: string, x: unknown, y: unknown, tighter: (x: number, y: number) => boolean) {
    if (same(x, y)) return;
    if (typeof y !== "number") return add("minor", `${k} removed`, `/${k}`);
    if (typeof x !== "number") return add("breaking", `${k}: ${y} added`, `/${k}`);
    add(tighter(x, y) ? "breaking" : "minor", `${k}: ${x} → ${y}`, `/${k}`);
  }

  for (const k of ["pattern", "format", "multipleOf"]) {
    if (same(a[k], b[k])) continue;
    add(
      b[k] === undefined ? "minor" : "breaking",
      b[k] === undefined ? `${k} removed` : `${k}: ${show(b[k])}`,
      `/${k}`,
    );
  }
  if (!same(a.uniqueItems, b.uniqueItems))
    add(b.uniqueItems ? "breaking" : "minor", `uniqueItems: ${!!b.uniqueItems}`, "/uniqueItems");

  for (const group of SUBSCHEMA_MAPS) {
    const ga = isObj(a[group]) ? a[group] : {};
    const gb = isObj(b[group]) ? b[group] : {};
    for (const key of new Set([...Object.keys(ga), ...Object.keys(gb)])) {
      const sub = `${path}/${group}/${esc(key)}`;
      if (!(key in gb)) {
        const closed = group !== "properties" || b.additionalProperties === false;
        out.push({ level: closed ? "breaking" : "minor", path: sub, text: `${key} removed` });
      } else if (!(key in ga)) {
        out.push({ level: "minor", path: sub, text: `${key} added` });
      } else walk(ga[key], gb[key], sub, out);
    }
  }

  if (!same(a.additionalProperties, b.additionalProperties)) {
    const x = a.additionalProperties;
    const y = b.additionalProperties;
    if (isObj(x) && isObj(y)) walk(x, y, `${path}/additionalProperties`, out);
    else
      add(
        y === false || (isObj(y) && x !== false) ? "breaking" : "minor",
        `additionalProperties: ${show(y ?? true)}`,
        "/additionalProperties",
      );
  }
  if (!same(a.items, b.items)) {
    if (isObj(a.items) && isObj(b.items)) walk(a.items, b.items, `${path}/items`, out);
    else add(b.items === undefined ? "minor" : "breaking", "items changed", "/items");
  }

  for (const k of DOCS) if (!same(a[k], b[k])) add("patch", `${k} changed`, `/${k}`);

  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (HANDLED.has(k) || same(a[k], b[k])) continue;
    add(
      k.startsWith("$") && k !== "$ref" ? "patch" : "breaking",
      `${k} changed (compatibility unknown)`,
      `/${esc(k)}`,
    );
  }
}

export function bumpFor(changes: Change[], brokenExamples = 0): Level {
  if (brokenExamples || changes.some((c) => c.level === "breaking")) return "breaking";
  return changes.some((c) => c.level === "minor") ? "minor" : "patch";
}

export function nextVersion(latest: string | null, level: Level): string {
  if (!latest) return "1.0.0";
  const [ma, mi, pa] = latest.split(".").map(Number);
  if (level === "breaking") return `${ma + 1}.0.0`;
  if (level === "minor") return `${ma}.${mi + 1}.0`;
  return `${ma}.${mi}.${pa + 1}`;
}
