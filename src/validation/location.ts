import { isMap, isScalar, isSeq, type Node, parseDocument } from "yaml";

export function pointerToPath(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

// JSON is (practically) a subset of YAML 1.2, so one parser gives source ranges for both formats.
export function locate(text: string, path: string[]): [number, number] {
  const doc = parseDocument(text);
  let node: unknown = doc.contents;
  let range = (node as Node | null)?.range;
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (p) => (isScalar(p.key) ? String(p.key.value) : String(p.key)) === segment,
      );
      if (!pair) break;
      range = (pair.key as Node | null)?.range ?? range;
      node = pair.value;
    } else if (isSeq(node)) {
      const item = node.items[Number(segment)] as Node | undefined;
      if (!item) break;
      range = item.range ?? range;
      node = item;
    } else {
      break;
    }
  }
  return range ? [range[0], range[1]] : [0, 0];
}
