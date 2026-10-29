import { applyPatch, compare, deepClone, type Operation } from "fast-json-patch";
import { isMap, isSeq, parse, parseDocument, stringify } from "yaml";

export type Format = "json" | "yaml";
export type { Operation };

export function parseSource(text: string, format: Format): unknown {
  return format === "json" ? JSON.parse(text) : parse(text);
}

export function serialize(value: unknown, format: Format): string {
  return format === "json" ? `${JSON.stringify(value, null, 2)}\n` : stringify(value);
}

export function diffSources(from: unknown, to: unknown): Operation[] {
  return compare(from as object, to as object);
}

const segments = (pointer: string) =>
  pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));

// Throws when the patch doesn't apply, so callers can report a conflict instead of a silent merge.
export function applySuggestion(text: string, format: Format, patch: Operation[]): string {
  const data = parseSource(text, format);
  const patched = applyPatch(deepClone(data), patch, true, false).newDocument;
  if (format === "json") return serialize(patched, "json");

  // YAML goes through the document tree so comments outside the changed nodes survive.
  const doc = parseDocument(text);
  for (const op of patch) {
    const path: (string | number)[] = segments(op.path);
    const parentPath = path.slice(0, -1);
    const parent = parentPath.length ? doc.getIn(parentPath, true) : doc.contents;
    const last = path[path.length - 1];
    if (isSeq(parent)) {
      const index = last === "-" ? parent.items.length : Number(last);
      if (op.op === "add") {
        parent.items.splice(index, 0, doc.createNode((op as { value: unknown }).value) as never);
        continue;
      }
      path[path.length - 1] = index;
    }
    if (op.op === "remove") doc.deleteIn(path);
    else if (op.op === "add" || op.op === "replace") {
      if (!path.length) doc.contents = doc.createNode(op.value) as never;
      else doc.setIn(path, doc.createNode(op.value));
    } else {
      return serialize(patched, "yaml");
    }
    if (isMap(parent) && parent.flow && op.op === "add") parent.flow = false;
  }
  return String(doc);
}

export function appliesCleanly(text: string, format: Format, patch: Operation[]): boolean {
  try {
    applySuggestion(text, format, patch);
    return true;
  } catch {
    return false;
  }
}
