import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { CatalogSource } from "../../shared/api";
import { api, queryClient } from "../api";
import { isObj } from "../builder/tree";
import { type CatalogEntry, loadCatalog, searchCatalog } from "../schemas/catalog";
import { cachedJson, fetchSchema } from "../schemas/loader";
import { AppHeader } from "../ui/AppHeader";
import { ErrorText } from "../ui/ui";
import { createSchema } from "./Home";

const SCHEMASTORE = {
  id: 0,
  name: "SchemaStore",
  url: "schemastore.org/api/json/catalog.json",
  kind: "catalog",
} as const;

async function loadEntries(source: CatalogSource | typeof SCHEMASTORE): Promise<CatalogEntry[]> {
  if (source.id === 0) return loadCatalog();
  if (source.kind === "schema")
    return [{ name: source.name, url: source.url, description: source.url }];
  return (await cachedJson<{ schemas: CatalogEntry[] }>(source.url)).schemas ?? [];
}

// Top level only: big SchemaStore schemas would otherwise drown the preview.
function previewText(schema: unknown): string {
  if (!isObj(schema)) return JSON.stringify(schema, null, 2);
  const shallow = Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [
      k,
      isObj(v)
        ? Object.fromEntries(Object.keys(v).map((p) => [p, "…"]))
        : Array.isArray(v) && v.length > 6
          ? [...v.slice(0, 6), "…"]
          : v,
    ]),
  );
  return JSON.stringify(shallow, null, 2);
}

const selectedClass = (on: boolean) =>
  `flex w-full flex-col items-start gap-0.5 rounded-[10px] px-3 py-2.5 text-left text-ink ${on ? "border-[1.5px] border-accent bg-accent-soft" : "border border-line bg-surface"}`;

export function Catalog() {
  const [, navigate] = useLocation();
  const sources = useQuery({
    queryKey: ["catalog-sources"],
    queryFn: () => api<CatalogSource[]>("/api/catalog/sources"),
  });
  const [sourceId, setSourceId] = useState(0);
  const source =
    sourceId === 0 ? SCHEMASTORE : (sources.data?.find((s) => s.id === sourceId) ?? SCHEMASTORE);
  const entries = useQuery({
    queryKey: ["catalog", source.id, source.url],
    queryFn: () => loadEntries(source),
    staleTime: Infinity,
  });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string>();
  const [version, setVersion] = useState<string>("latest");
  const [mode, setMode] = useState<"copy" | "ref">("copy");
  const [adding, setAdding] = useState(false);

  const results = useMemo(
    () => searchCatalog(entries.data ?? [], query, 80),
    [entries.data, query],
  );
  const current = results.find((e) => e.url === picked) ?? results[0];
  const versions = current?.versions ?? {};
  const url = version !== "latest" && versions[version] ? versions[version] : current?.url;

  const preview = useQuery({
    queryKey: ["schema-preview", url],
    queryFn: () => fetchSchema(url as string),
    enabled: !!url,
    staleTime: Infinity,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!current || !url) throw new Error("Pick a schema first");
      if (mode === "copy") {
        const schema = preview.data ?? (await fetchSchema(url));
        return createSchema({
          title: current.name,
          format: "json",
          text: `${JSON.stringify(schema, null, 2)}\n`,
          sourceUrl: url,
          sourceVersion: version,
        });
      }
      const ext = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: `${current.name} (extended)`,
        allOf: [{ $ref: url }],
      };
      return createSchema({
        format: "json",
        text: `${JSON.stringify(ext, null, 2)}\n`,
        sourceUrl: url,
        sourceVersion: version,
      });
    },
    onSuccess: (id) => navigate(`/schemas/${id}`),
  });

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader current="catalog" />
      <div className="flex flex-1 flex-wrap items-stretch">
        <nav
          aria-label="Catalog sources"
          className="box-border flex max-w-full flex-[1_1_240px] flex-col gap-1.5 border-r border-line bg-subtle px-3.5 py-5"
        >
          <span className="px-2 pb-1.5 text-xs font-semibold tracking-[0.04em] text-muted uppercase">
            Sources
          </span>
          {[SCHEMASTORE, ...(sources.data ?? [])].map((s) => (
            <SourceButton
              key={s.id}
              source={s}
              current={s.id === source.id}
              onPick={() => {
                setSourceId(s.id);
                setPicked(undefined);
                setVersion("latest");
              }}
            />
          ))}
          {adding ? (
            <AddSource
              onDone={(id) => {
                setAdding(false);
                if (id) setSourceId(id);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-2 min-h-11 rounded-[10px] border border-dashed border-dash bg-surface font-medium text-link"
            >
              + Add catalog or schema URL
            </button>
          )}
          <p className="mx-2 mt-1.5 mb-0 text-xs text-muted">
            Any URL that serves a SchemaStore-format <code className="font-mono">catalog.json</code>
            , or a single schema.
          </p>
        </nav>

        <section
          aria-label="Catalog entries"
          className="box-border flex min-w-0 flex-[2_1_380px] flex-col gap-3 border-r border-line bg-surface p-5"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="catSearch" className="field-label">
              Search {source.name}
            </label>
            <input
              id="catSearch"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or description"
              className="input h-11 rounded-[10px]"
            />
          </div>
          <div role="status" className="flex items-center gap-2 text-xs text-muted">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${entries.isError ? "bg-[#D9473A]" : "bg-[#1F9D5B]"}`}
            />
            {entries.isPending
              ? "Loading catalog…"
              : entries.isError
                ? `Couldn't load: ${(entries.error as Error).message}`
                : `${entries.data.length} schemas · fetched live, cached for 24 h`}
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 overflow-auto p-0">
            {results.map((e) => (
              <li key={e.url}>
                <button
                  type="button"
                  aria-current={e === current}
                  onClick={() => {
                    setPicked(e.url);
                    setVersion("latest");
                  }}
                  className={selectedClass(e === current)}
                >
                  <span className="font-semibold">{e.name}</span>
                  {e.description && <span className="text-[13px] text-muted">{e.description}</span>}
                  {!!e.fileMatch?.length && (
                    <span className="font-mono text-[11.5px] text-muted">
                      {e.fileMatch.join("  ·  ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label="Selected schema"
          className="box-border flex min-w-0 flex-[3_1_460px] flex-col gap-4.5 p-6"
        >
          {current ? (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted">{source.name}</span>
                <h1 className="m-0 text-[26px] font-bold tracking-tight">{current.name}</h1>
                {current.description && <p className="m-0 text-ink-2">{current.description}</p>}
              </div>
              <dl className="card m-0 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5 p-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-xs font-semibold text-muted">Schema URL</dt>
                  <dd className="m-0 font-mono text-[12.5px] [overflow-wrap:anywhere]">
                    <a href={url} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                  </dd>
                </div>
                {!!current.fileMatch?.length && (
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs font-semibold text-muted">Matches files</dt>
                    <dd className="m-0 flex flex-wrap gap-1.5">
                      {current.fileMatch.map((f) => (
                        <code key={f} className="rounded bg-chip px-1.5 py-0.5 font-mono text-xs">
                          {f}
                        </code>
                      ))}
                    </dd>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <dt>
                    <label htmlFor="catVersion" className="text-xs font-semibold text-muted">
                      Version
                    </label>
                  </dt>
                  <dd className="m-0">
                    <select
                      id="catVersion"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      className="input w-full"
                    >
                      <option value="latest">latest</option>
                      {Object.keys(versions).map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </dd>
                </div>
              </dl>

              <div className="flex flex-col gap-2">
                <span className="field-label">Preview · fetched on selection, not stored</span>
                <pre className="m-0 max-h-[220px] overflow-auto rounded-[10px] bg-code p-4 font-mono text-[12.5px] leading-[1.6] whitespace-pre text-code-ink">
                  {preview.isPending
                    ? "Loading…"
                    : preview.isError
                      ? (preview.error as Error).message
                      : previewText(preview.data)}
                </pre>
              </div>

              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="field-label mb-2 p-0">How do you want to use it?</legend>
                {(
                  [
                    [
                      "copy",
                      "Copy into my schemas",
                      "An editable, versioned copy you own, with its own examples. Records the source URL and version it came from.",
                    ],
                    [
                      "ref",
                      "Extend it",
                      "A new schema that $refs this one by URL and adds your own constraints on top.",
                    ],
                  ] as const
                ).map(([id, title, desc]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={mode === id}
                    onClick={() => setMode(id)}
                    className={`${selectedClass(mode === id)} px-3.5 py-3`}
                  >
                    <span className="font-semibold">{title}</span>
                    <span className="text-[13px] text-muted">{desc}</span>
                  </button>
                ))}
              </fieldset>
              <ErrorText error={create.error} />
              <div className="flex flex-wrap justify-end gap-2">
                <a href="/" className="btn h-11 rounded-[10px] px-4">
                  Cancel
                </a>
                <button
                  type="button"
                  className="btn-primary h-11 rounded-[10px]"
                  disabled={create.isPending || (mode === "copy" && !preview.data)}
                  onClick={() => create.mutate()}
                >
                  {mode === "copy" ? "Create my copy" : "Create extension"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-muted">{entries.isPending ? "Loading…" : "No schema selected."}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function SourceButton({
  source,
  current,
  onPick,
}: {
  source: CatalogSource | typeof SCHEMASTORE;
  current: boolean;
  onPick: () => void;
}) {
  const remove = useMutation({
    mutationFn: () => api(`/api/catalog/sources/${source.id}`, { method: "DELETE", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["catalog-sources"] }),
  });
  return (
    <div
      className={`flex items-start rounded-[10px] ${current ? "border border-accent bg-surface" : "border border-transparent"}`}
    >
      <button
        type="button"
        onClick={onPick}
        aria-current={current}
        className="flex min-w-0 flex-1 flex-col items-start gap-px p-2.5 text-left text-ink"
      >
        <span className="font-semibold">{source.name}</span>
        <span className="text-xs text-muted [overflow-wrap:anywhere]">
          {source.url.replace(/^https:\/\//, "")}
        </span>
        <span className="text-xs text-muted">
          {source.id === 0 ? "Default · cached at the edge" : `Added by you · ${source.kind}`}
        </span>
      </button>
      {source.id !== 0 && (
        <button
          type="button"
          aria-label={`Remove ${source.name}`}
          onClick={() => remove.mutate()}
          className="m-1 size-8 rounded-md text-muted hover:bg-chip"
        >
          ×
        </button>
      )}
    </div>
  );
}

function AddSource({ onDone }: { onDone: (id?: number) => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"catalog" | "schema">("catalog");
  const add = useMutation({
    mutationFn: () => api<{ id: number }>("/api/catalog/sources", { body: { url, name, kind } }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["catalog-sources"] });
      onDone(r.id);
    },
  });
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <label className="field-label flex flex-col gap-1">
        URL
        <input
          required
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/catalog.json"
          className="input font-normal"
        />
      </label>
      <label className="field-label flex flex-col gap-1">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional"
          className="input font-normal"
        />
      </label>
      <label className="field-label flex flex-col gap-1">
        It is a
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="input font-normal"
        >
          <option value="catalog">Catalog (catalog.json format)</option>
          <option value="schema">Single schema</option>
        </select>
      </label>
      <ErrorText error={add.error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={add.isPending}>
          Add
        </button>
        <button type="button" className="btn h-10" onClick={() => onDone()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
