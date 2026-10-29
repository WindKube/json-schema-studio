import { isCollection, parseDocument } from "yaml";
import { isObj } from "../builder/tree";
import type { Format } from "../format";

export type FormPath = (string | number)[];

// YAML edits go through the document tree so comments and formatting elsewhere survive.
export function applyEdit(text: string, format: Format, path: FormPath, value: unknown): string {
  if (format === "yaml") {
    const doc = parseDocument(text);
    // An empty `[]`/`{}` is flow style; without this, items added through the form stay inline.
    for (let i = 0; i < path.length; i++) {
      const node = doc.getIn(path.slice(0, i), true);
      if (isCollection(node) && node.flow && !node.items.length) node.flow = false;
    }
    if (!path.length) doc.contents = value === undefined ? null : (doc.createNode(value) as never);
    else if (value === undefined) doc.deleteIn(path);
    else doc.setIn(path, doc.createNode(value));
    return doc.contents === null ? "" : String(doc);
  }
  const next = setIn(text.trim() ? JSON.parse(text) : undefined, path, value);
  return next === undefined ? "" : `${JSON.stringify(next, null, 2)}\n`;
}

function setIn(data: unknown, path: FormPath, value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const container: Record<string | number, unknown> | unknown[] = Array.isArray(data)
    ? [...data]
    : isObj(data)
      ? { ...data }
      : typeof head === "number"
        ? []
        : {};
  const child = setIn((container as Record<string | number, unknown>)[head], rest, value);
  if (child === undefined) {
    if (Array.isArray(container)) container.splice(Number(head), 1);
    else delete container[head];
  } else {
    (container as Record<string | number, unknown>)[head] = child;
  }
  return container;
}
