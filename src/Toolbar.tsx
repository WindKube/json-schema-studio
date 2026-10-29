import { useRef, useState } from "react";
import { type Format, formatFromFileName } from "./format";
import { loadCatalog, matchFileName } from "./schemas/catalog";
import { fetchSchema } from "./schemas/loader";
import { SchemaPicker } from "./schemas/SchemaPicker";
import { encodeShare } from "./share";
import { useStore } from "./store";

export async function importFile(file: File) {
  const text = await file.text();
  const { mode, editSchema, selectRemote, schema } = useStore.getState();
  if (mode === "schema") return editSchema(text);
  useStore.setState({ format: formatFromFileName(file.name), docText: text });
  if (schema) return;
  const match = matchFileName(await loadCatalog().catch(() => []), file.name);
  if (match) selectRemote(match);
}

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const format = useStore((s) => s.format);
  const setMode = useStore((s) => s.setMode);
  const setFormat = useStore((s) => s.setFormat);
  const schemaView = useStore((s) => s.schemaView);
  const docView = useStore((s) => s.docView);
  const setDocView = useStore((s) => s.setDocView);
  const setSchemaView = useStore((s) => s.setSchemaView);
  const applyCustomSchema = useStore((s) => s.applyCustomSchema);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string>();

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(undefined), 2500);
  };

  const switchFormat = (to: Format) => {
    try {
      setFormat(to);
    } catch (e) {
      flash(`Can't convert: ${(e as Error).message}`);
    }
  };

  const exportFile = () => {
    const { docText, schemaText } = useStore.getState();
    const [name, text] =
      mode === "schema" ? ["schema.json", schemaText] : [`document.${format}`, docText];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const loadIntoBuilder = async ({ name, url }: { name: string; url: string }) => {
    flash(`Loading ${name}…`);
    try {
      useStore.getState().editSchema(`${JSON.stringify(await fetchSchema(url), null, 2)}\n`);
      flash(`Loaded ${name}`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const share = async () => {
    const { mode, format, docText, schemaText, schema } = useStore.getState();
    const url = `${location.origin}${location.pathname}#s=${encodeShare({ mode, format, docText, schemaText, schema })}`;
    await navigator.clipboard.writeText(url);
    flash("Share link copied");
  };

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <h1 className="mr-2 font-semibold">Playground</h1>
      <Segmented
        value={mode}
        options={[
          ["document", "Document"],
          ["schema", "Schema"],
        ]}
        onChange={setMode}
      />
      {mode === "document" && (
        <>
          <Segmented
            value={docView}
            options={[
              ["form", "Form"],
              ["code", "Code"],
            ]}
            onChange={setDocView}
          />
          <SchemaPicker />
          <Segmented
            value={format}
            options={[
              ["yaml", "YAML"],
              ["json", "JSON"],
            ]}
            onChange={switchFormat}
          />
        </>
      )}
      {mode === "schema" && (
        <>
          <Segmented
            value={schemaView}
            options={[
              ["visual", "Visual"],
              ["source", "Source"],
            ]}
            onChange={setSchemaView}
          />
          {schemaView === "visual" && (
            <>
              <button
                type="button"
                className="btn"
                aria-label="Undo"
                title="Undo (⌘Z)"
                disabled={!canUndo}
                onClick={undo}
              >
                ↶
              </button>
              <button
                type="button"
                className="btn"
                aria-label="Redo"
                title="Redo (⇧⌘Z)"
                disabled={!canRedo}
                onClick={redo}
              >
                ↷
              </button>
            </>
          )}
          <SchemaPicker onPick={loadIntoBuilder} label="Load from SchemaStore" />
          <button type="button" className="btn" onClick={applyCustomSchema}>
            Test in Document mode
          </button>
        </>
      )}
      {notice && <span className="text-sm text-zinc-500">{notice}</span>}
      <div className="ml-auto flex gap-2">
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.yaml,.yml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importFile(file);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn" onClick={exportFile}>
          Export
        </button>
        <button type="button" className="btn" onClick={share}>
          Share
        </button>
      </div>
    </header>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-zinc-300 p-0.5 text-sm dark:border-zinc-700">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded px-2.5 py-1 ${v === value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
