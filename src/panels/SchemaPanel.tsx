import { useMemo } from "react";
import { useStore } from "../store";
import { detectDraft, validateSchema } from "../validation/ajv";
import { ProblemList } from "./ProblemList";

export function SchemaPanel() {
  const schemaText = useStore((s) => s.schemaText);

  const parsed = useMemo(() => {
    try {
      return { schema: JSON.parse(schemaText) as unknown };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [schemaText]);

  const problems = useMemo(
    () => ("schema" in parsed ? validateSchema(parsed.schema) : []),
    [parsed],
  );

  return (
    <section>
      <h2 className="panel-title">Meta-schema validation</h2>
      {"error" in parsed ? (
        <p className="px-3 py-2 text-sm text-red-600">{parsed.error}</p>
      ) : (
        <>
          <p className="px-3 pb-1 text-xs opacity-60">Ajv, {detectDraft(parsed.schema)}</p>
          <ProblemList problems={problems} text={schemaText} />
        </>
      )}
    </section>
  );
}
