import { useEffect, useRef } from "react";
import { stringify } from "yaml";
import { generateSample } from "../builder/sample";
import { focusField } from "../form/Form";
import type { ActiveSchema } from "../schemas/useActiveSchema";
import { useStore } from "../store";
import { detectDraft } from "../validation/ajv";
import { ProblemList } from "./ProblemList";
import type { Validation } from "./useDocumentValidation";

type Props = {
  active: ActiveSchema | null;
  error: string | null;
  loading: boolean;
  result: Validation;
};

export function DocumentPanel({ active, error, loading, result }: Props) {
  const docText = useStore((s) => s.docText);
  const format = useStore((s) => s.format);
  const docView = useStore((s) => s.docView);
  const sampledFor = useRef<string>(null);

  // A freshly picked schema with an empty document would otherwise show nothing at all.
  useEffect(() => {
    if (!active || sampledFor.current === active.uri) return;
    sampledFor.current = active.uri;
    const { docText, setDocText } = useStore.getState();
    const sample = generateSample(active.schema);
    if (docText.trim() || sample === null) return;
    setDocText(format === "json" ? `${JSON.stringify(sample, null, 2)}\n` : stringify(sample));
  }, [active, format]);

  const openSchema = () => {
    if (!active) return;
    const { schema, editSchema, setMode } = useStore.getState();
    if (schema?.kind !== "custom") editSchema(`${JSON.stringify(active.schema, null, 2)}\n`);
    setMode("schema");
  };

  return (
    <section>
      <div className="flex items-center justify-between pr-3">
        <h2 className="panel-title">Validation</h2>
        {active && (
          <button
            type="button"
            className="btn mt-2"
            onClick={openSchema}
            title="Load this schema into Schema mode (replaces the schema there; undo restores it)"
          >
            Open schema
          </button>
        )}
      </div>
      {loading && <p className="px-3 py-2 text-sm opacity-60">Loading schema…</p>}
      {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
      {!active && !loading && !error && (
        <p className="px-3 py-2 text-sm opacity-60">
          Pick a schema (⌘K) to validate this document.
        </p>
      )}
      {active && (
        <>
          <p className="px-3 pb-1 text-xs opacity-60">
            Ajv, {detectDraft(active.schema)} · <span className="break-all">{active.uri}</span>
          </p>
          {!docText.trim() && (
            <p className="px-3 py-2 text-sm opacity-60">The document is empty.</p>
          )}
          {result.error && <p className="px-3 py-2 text-sm text-red-600">{result.error}</p>}
          {docText.trim() && result.problems && (
            <ProblemList
              problems={result.problems}
              text={docText}
              onSelect={docView === "form" ? (p) => focusField(p.path) : undefined}
            />
          )}
        </>
      )}
    </section>
  );
}
