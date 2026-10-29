import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { type CatalogEntry, loadCatalog, searchCatalog } from "./catalog";

type Props = { onPick?: (entry: { name: string; url: string }) => void; label?: string };

export function SchemaPicker({ onPick, label: customLabel }: Props = {}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const schema = useStore((s) => s.schema);
  const recent = useStore((s) => s.recent);
  const selectRemote = useStore((s) => s.selectRemote);
  const clearSchema = useStore((s) => s.clearSchema);
  const applyCustomSchema = useStore((s) => s.applyCustomSchema);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogEntry[]>();
  const [error, setError] = useState<string>();

  const open = () => {
    dialog.current?.showModal();
    loadCatalog().then(setCatalog, (e: Error) => setError(e.message));
  };
  const close = () => dialog.current?.close();
  const pick = (entry: { name: string; url: string }) => {
    (onPick ?? selectRemote)(entry);
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const results = useMemo(() => (catalog ? searchCatalog(catalog, query) : []), [catalog, query]);
  const isUrl = /^https?:\/\//.test(query.trim());
  const label =
    customLabel ??
    (schema?.kind === "remote" ? schema.name : schema ? "Custom schema" : "No schema");

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="btn max-w-64 truncate"
        title="Choose schema (⌘K)"
      >
        {label} <kbd className="ml-1 text-xs opacity-60">⌘K</kbd>
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click; <dialog> already closes on Escape */}
      <dialog
        ref={dialog}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        onClick={(e) => e.target === dialog.current && close()}
      >
        <input
          autoFocus
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // close() refocuses the trigger button; without this, Enter would "click" it and reopen.
            e.preventDefault();
            if (isUrl) pick({ name: query.trim(), url: query.trim() });
            else if (results[0]) pick(results[0]);
          }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search SchemaStore or paste a schema URL…"
          className="w-full border-b border-zinc-200 bg-transparent px-4 py-3 outline-none dark:border-zinc-700"
        />
        <ul className="max-h-[60vh] overflow-auto py-1 text-sm">
          {isUrl && (
            <Item
              onClick={() => pick({ name: query.trim(), url: query.trim() })}
              title="Load from URL"
              subtitle={query.trim()}
            />
          )}
          {!query && !onPick && (
            <>
              <Item
                onClick={() => {
                  applyCustomSchema();
                  close();
                }}
                title="Custom schema"
                subtitle="Use the schema written in Schema mode"
              />
              {schema && (
                <Item
                  onClick={() => {
                    clearSchema();
                    close();
                  }}
                  title="No schema"
                  subtitle="Edit without validation"
                />
              )}
              {recent.map((r) => (
                <Item
                  key={r.url}
                  onClick={() => pick(r)}
                  title={r.name}
                  subtitle={`Recent · ${r.url}`}
                />
              ))}
            </>
          )}
          {error && <li className="px-4 py-2 text-red-600">{error}</li>}
          {!catalog && !error && (
            <li className="px-4 py-2 opacity-60">Loading SchemaStore catalog…</li>
          )}
          {results.map((e) => (
            <Item key={e.url} onClick={() => pick(e)} title={e.name} subtitle={e.description} />
          ))}
        </ul>
      </dialog>
    </>
  );
}

function Item({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full px-4 py-2 text-left hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
      >
        <div className="font-medium">{title}</div>
        {subtitle && <div className="truncate text-xs opacity-60">{subtitle}</div>}
      </button>
    </li>
  );
}
