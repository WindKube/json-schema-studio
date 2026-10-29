import { lazy, Suspense, useEffect } from "react";
import { Builder } from "./builder/Builder";
import { FormView } from "./form/Form";
import { DocumentPanel } from "./panels/DocumentPanel";
import { SchemaPanel } from "./panels/SchemaPanel";
import { useDocumentValidation } from "./panels/useDocumentValidation";
import { useActiveSchema } from "./schemas/useActiveSchema";
import { useStore } from "./store";
import { importFile, Toolbar } from "./Toolbar";
import { AppHeader } from "./ui/AppHeader";

const Editor = lazy(() => import("./editor/Editor"));

export default function Playground() {
  const mode = useStore((s) => s.mode);
  const format = useStore((s) => s.format);
  const docText = useStore((s) => s.docText);
  const schemaText = useStore((s) => s.schemaText);
  const setDocText = useStore((s) => s.setDocText);
  const setSchemaText = useStore((s) => s.setSchemaText);
  const schemaView = useStore((s) => s.schemaView);
  const docView = useStore((s) => s.docView);
  const { active, error, loading } = useActiveSchema();
  const setDocView = useStore((s) => s.setDocView);
  const validation = useDocumentValidation(active, docText, format);
  const isDoc = mode === "document";

  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    // Capture phase so Monaco doesn't insert the dropped file as text.
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      importFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  return (
    <div className="flex h-full flex-col bg-white text-zinc-900">
      <AppHeader current="playground" />
      <Toolbar />
      {!isDoc && schemaView === "visual" ? (
        <Builder />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="min-h-[50vh] flex-1 md:min-h-0">
            {isDoc && docView === "form" ? (
              <FormView
                active={active}
                problems={validation.problems}
                docText={docText}
                format={format}
                onChange={setDocText}
                onShowCode={() => setDocView("code")}
              />
            ) : (
              <Suspense fallback={<p className="p-4 text-sm opacity-60">Loading editor…</p>}>
                <Editor
                  fileName={isDoc ? `document.${format}` : "schema.json"}
                  language={isDoc ? format : "json"}
                  value={isDoc ? docText : schemaText}
                  onChange={isDoc ? setDocText : setSchemaText}
                  dark={false}
                  schema={active}
                />
              </Suspense>
            )}
          </div>
          <aside className="overflow-auto border-zinc-200 md:w-88 md:border-l dark:border-zinc-800">
            {isDoc ? (
              <DocumentPanel active={active} error={error} loading={loading} result={validation} />
            ) : (
              <SchemaPanel />
            )}
          </aside>
        </main>
      )}
    </div>
  );
}
