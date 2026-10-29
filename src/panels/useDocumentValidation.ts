import { useEffect, useState } from "react";
import { type Format, parseText } from "../format";
import type { ActiveSchema } from "../schemas/useActiveSchema";
import { type Problem, validateDocument } from "../validation/ajv";

export type Validation = { problems?: Problem[]; error?: string };

export function useDocumentValidation(
  active: ActiveSchema | null,
  docText: string,
  format: Format,
): Validation {
  const [result, setResult] = useState<Validation>({});

  useEffect(() => {
    if (!active) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        if (!docText.trim()) return setResult({});
        const problems = await validateDocument(
          active.schema,
          parseText(docText, format),
          active.uri,
        );
        if (!stale) setResult({ problems });
      } catch (e) {
        if (!stale) setResult({ error: (e as Error).message });
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [active, docText, format]);

  return result;
}
