import { useEffect, useState } from "react";
import type { Example } from "../../shared/api";
import { parseSource } from "../../shared/patch";
import { type Problem, validateDocument } from "../validation/ajv";

export type Target = { label: string; schema: unknown };
export type Cell = { valid: boolean; meets: boolean; problems: Problem[] } | { error: string };
export type Matrix = Record<number, Record<string, Cell>>;

export const meets = (cell: Cell | undefined) => !!cell && "meets" in cell && cell.meets;

export async function runContract(
  examples: Pick<Example, "id" | "text" | "format" | "expect">[],
  targets: Target[],
): Promise<Matrix> {
  const out: Matrix = {};
  for (const ex of examples) {
    out[ex.id] = {};
    let data: unknown;
    try {
      data = parseSource(ex.text, ex.format);
    } catch (e) {
      for (const t of targets)
        out[ex.id][t.label] = { error: `Example doesn't parse: ${(e as Error).message}` };
      continue;
    }
    for (const t of targets) {
      if (!t.schema || typeof t.schema !== "object") {
        out[ex.id][t.label] = { error: "Schema doesn't parse" };
        continue;
      }
      try {
        const problems = await validateDocument(t.schema, data);
        const valid = !problems.length;
        out[ex.id][t.label] = { valid, meets: valid === (ex.expect === "valid"), problems };
      } catch (e) {
        out[ex.id][t.label] = { error: (e as Error).message };
      }
    }
  }
  return out;
}

export function useContract(
  examples: Pick<Example, "id" | "text" | "format" | "expect">[] | undefined,
  targets: Target[],
): Matrix | undefined {
  const [matrix, setMatrix] = useState<Matrix>();
  useEffect(() => {
    if (!examples) return;
    let stale = false;
    const timer = setTimeout(() => {
      runContract(examples, targets).then((m) => !stale && setMatrix(m));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [examples, targets]);
  return matrix;
}

export function parseOrNull(text: string, format: "json" | "yaml"): unknown {
  try {
    return parseSource(text, format);
  } catch {
    return null;
  }
}
