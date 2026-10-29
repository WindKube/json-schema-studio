import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Inspector } from "./Inspector";
import { Outline } from "./Outline";
import { addDefinition, addProperty } from "./ops";
import { SidePanel } from "./SidePanel";
import { getAt, isObj, type Path, pathKey, typeList } from "./tree";

const isSchemaLike = (v: unknown) => isObj(v) || typeof v === "boolean";

export function Builder() {
  const schemaText = useStore((s) => s.schemaText);
  const editSchema = useStore((s) => s.editSchema);
  const setSchemaView = useStore((s) => s.setSchemaView);
  const [selected, setSelected] = useState<Path>([]);
  const [open, setOpen] = useState(new Map<string, boolean>());

  const parsed = useMemo(() => {
    try {
      return { root: JSON.parse(schemaText) as unknown };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [schemaText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      e.preventDefault();
      const { undo, redo } = useStore.getState();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if ("error" in parsed || !isSchemaLike(parsed.root)) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-red-600">
          {"error" in parsed
            ? `The schema isn't valid JSON: ${parsed.error}`
            : "The root of a schema must be an object or a boolean."}
        </p>
        <button type="button" className="btn" onClick={() => setSchemaView("source")}>
          Fix it in Source view
        </button>
      </div>
    );
  }

  const root = parsed.root;
  let sel = selected;
  while (sel.length && !isSchemaLike(getAt(root, sel))) sel = sel.slice(0, -1);

  const select = (path: Path) => {
    setSelected(path);
    setOpen((m) => {
      const next = new Map(m);
      for (let i = 0; i < path.length; i++) next.set(pathKey(path.slice(0, i)), true);
      return next;
    });
  };

  const commit = (next: unknown, path?: Path) => {
    editSchema(`${JSON.stringify(next, null, 2)}\n`);
    if (path) select(path);
  };

  const addPropertyToSelection = () => {
    const node = getAt(root, sel);
    const types = typeList(node);
    const target = isObj(node) && (!types.length || types.includes("object")) ? sel : [];
    const r = addProperty(root, target);
    commit(r.root, r.path);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <Outline
        root={root}
        selected={sel}
        open={open}
        onToggle={(key, isOpen) => setOpen((m) => new Map(m).set(key, isOpen))}
        onSelect={select}
        onAddProperty={addPropertyToSelection}
        onAddDefinition={() => {
          const r = addDefinition(root, []);
          commit(r.root, r.path);
        }}
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        <Inspector key={pathKey(sel)} root={root} path={sel} onChange={commit} onSelect={select} />
      </main>
      <SidePanel root={root} selected={sel} onSelect={select} />
    </div>
  );
}
