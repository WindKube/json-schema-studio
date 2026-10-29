import { useMutation, useQuery } from "@tanstack/react-query";
import { type DragEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import type { SchemaList, SchemaRow } from "../../shared/api";
import { type Format, parseSource } from "../../shared/patch";
import { ago, api, queryClient } from "../api";
import { formatFromFileName } from "../format";
import { AppHeader } from "../ui/AppHeader";
import { ErrorText, srOnly } from "../ui/ui";
import { PasteDialog } from "./Paste";

export const BLANK_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Untitled schema",
  "type": "object",
  "properties": {},
  "required": []
}
`;

const MAX_BYTES = 1024 * 1024;

export async function createSchema(input: {
  title?: string;
  format: Format;
  text: string;
  sourceUrl?: string;
  sourceVersion?: string;
}): Promise<number> {
  let title = input.title;
  if (!title) {
    try {
      const t = (parseSource(input.text, input.format) as { title?: unknown })?.title;
      if (typeof t === "string") title = t;
    } catch {}
  }
  const { id } = await api<{ id: number }>("/api/schemas", { body: { ...input, title } });
  queryClient.invalidateQueries({ queryKey: ["schemas"] });
  return id;
}

export const useSchemaList = () =>
  useQuery({ queryKey: ["schemas"], queryFn: () => api<SchemaList>("/api/schemas") });

export function Home({ paste }: { paste?: boolean }) {
  const [, navigate] = useLocation();
  const list = useSchemaList();
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [query, setQuery] = useState("");
  const [importError, setImportError] = useState<string>();

  const importFile = async (file: File) => {
    setImportError(undefined);
    if (file.size > MAX_BYTES) return setImportError(`${file.name} is larger than 1 MB.`);
    const format = formatFromFileName(file.name);
    const text = await file.text();
    try {
      parseSource(text, format);
    } catch (e) {
      return setImportError(
        `${file.name} isn't valid ${format.toUpperCase()}: ${(e as Error).message}`,
      );
    }
    const title = file.name.replace(/\.(schema\.)?(json|ya?ml)$/i, "");
    navigate(`/schemas/${await createSchema({ format, text, title })}`);
  };

  const blank = useMutation({
    mutationFn: () => createSchema({ format: "json", text: BLANK_SCHEMA }),
    onSuccess: (id) => navigate(`/schemas/${id}`),
  });

  const q = query.trim().toLowerCase();
  const rows = (list.data?.[tab] ?? []).filter(
    (r) => !q || [r.title, r.slug, r.schemaUri ?? ""].some((s) => s.toLowerCase().includes(q)),
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) importFile(file);
  };

  return (
    <div className="min-h-full">
      <AppHeader current="schemas" />
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-start gap-7 px-7 pt-8 pb-14">
        <aside aria-label="Create" className="flex flex-[1_1_280px] flex-col gap-2.5">
          <h2 className="m-0 mb-1 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">
            New schema
          </h2>
          <label
            htmlFor="schemaFile"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-dash bg-surface px-4 py-5 text-center"
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="text-accent"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
              <path d="M12 17v-6" />
              <path d="m9 13 3-3 3 3" />
            </svg>
            <span className="font-semibold">Import file</span>
            <span className="text-[13px] text-muted">
              Drop <code className="font-mono text-xs">.json</code>,{" "}
              <code className="font-mono text-xs">.yaml</code> or{" "}
              <code className="font-mono text-xs">.yml</code> · up to 1 MB
            </span>
            <input
              id="schemaFile"
              type="file"
              accept=".json,.yaml,.yml,application/json,application/yaml"
              className="absolute size-px opacity-0"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importFile(file);
                e.target.value = "";
              }}
            />
          </label>
          {importError && <ErrorText error={new Error(importError)} />}
          <CreateLink
            href="/new/paste"
            title="Paste JSON or YAML"
            hint="Format detected automatically"
            icon="paste"
          />
          <CreateLink
            href="/catalog"
            title="From SchemaStore"
            hint="Fetched live from schemastore.org"
            icon="search"
          />
          <button
            type="button"
            onClick={() => blank.mutate()}
            disabled={blank.isPending}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left text-ink"
          >
            <Icon name="plus" />
            <span className="flex flex-col">
              <span className="font-semibold">Blank schema</span>
              <span className="text-xs text-muted">draft 2020-12 object</span>
            </span>
          </button>
          <ErrorText error={blank.error} />
        </aside>

        <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Schema lists"
              className="flex gap-1 rounded-[10px] bg-track p-1"
            >
              {(
                [
                  ["mine", `My schemas · ${list.data?.mine.length ?? 0}`],
                  ["shared", `Shared with me · ${list.data?.shared.length ?? 0}`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`min-h-9 rounded-[7px] px-3.5 ${tab === id ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(15,18,24,0.08)]" : "font-medium text-ink-2"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label htmlFor="schemaSearch" className={srOnly}>
              Search schemas
            </label>
            <input
              id="schemaSearch"
              type="search"
              placeholder="Search by name or $id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input h-10 w-[280px] max-w-full rounded-[10px]"
            />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="text-left text-xs text-muted">
                  {[
                    "Schema",
                    "Latest version",
                    "Your role",
                    "People",
                    "Examples",
                    "Open",
                    "Updated",
                  ].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <SchemaTableRow key={r.id} r={r} />
                ))}
                {!list.isPending && !rows.length && (
                  <tr className="border-t border-line-soft">
                    <td colSpan={7} className="px-4 py-6 text-muted">
                      {q
                        ? "No schemas match."
                        : tab === "mine"
                          ? "No schemas yet. Import, paste or start from SchemaStore."
                          : "Nothing shared with you yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <ErrorText error={list.error} />

          {list.data?.invites.map((inv) => (
            <InviteBanner key={inv.id} invite={inv} />
          ))}
        </main>
      </div>
      {paste && <PasteDialog onClose={() => navigate("/")} />}
    </div>
  );
}

function SchemaTableRow({ r }: { r: SchemaRow }) {
  const open = [
    r.openSuggestions && `${r.openSuggestions} suggestion${r.openSuggestions > 1 ? "s" : ""}`,
    r.openComments && `${r.openComments} comment${r.openComments > 1 ? "s" : ""}`,
  ].filter(Boolean);
  const examples = !r.examples
    ? "None yet"
    : r.failingExamples
      ? `${r.examples} · ${r.failingExamples} break${r.failingExamples > 1 ? "" : "s"} draft`
      : `${r.examples} · all pass`;
  return (
    <tr className="border-t border-line-soft">
      <td className="px-4 py-3.5">
        <Link href={`/schemas/${r.id}`} className="flex flex-col text-ink no-underline">
          <span className="font-semibold">{r.title}</span>
          <span className="font-mono text-xs text-muted">
            {r.slug} · {r.format.toUpperCase()}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3.5">
        <span className="font-mono text-[13px]">
          {r.latestVersion ? `v${r.latestVersion}` : "—"}
        </span>
        {r.draftChanged && (
          <span className="ml-1.5 rounded bg-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-[#8A4B08]">
            {r.latestVersion ? "draft changes" : "unpublished"}
          </span>
        )}
      </td>
      <td className="px-4 py-3.5 text-ink-2 capitalize">{r.role}</td>
      <td className="px-4 py-3.5 text-ink-2">{r.people === 1 ? "Only you" : r.people}</td>
      <td className="px-4 py-3.5">
        <span
          className={
            r.failingExamples
              ? "rounded-md bg-err-bg px-2 py-0.5 text-xs font-semibold text-err"
              : "text-[13px] text-ink-2"
          }
        >
          {examples}
        </span>
      </td>
      <td className="px-4 py-3.5 text-ink-2">{open.length ? open.join(" · ") : "—"}</td>
      <td className="px-4 py-3.5 text-muted">{ago(r.updatedAt)}</td>
    </tr>
  );
}

function InviteBanner({ invite }: { invite: SchemaList["invites"][number] }) {
  const [, navigate] = useLocation();
  const respond = useMutation({
    mutationFn: (action: "accept" | "decline") =>
      api<{ schemaId: number }>(`/api/invites/${invite.id}/${action}`, { body: {} }).then((r) => ({
        ...r,
        action,
      })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
      if (r.action === "accept") navigate(`/schemas/${r.schemaId}`);
    },
  });
  const can = {
    viewer: "You can read every version and validate documents.",
    commenter: "You can read every version, leave comments and propose changes.",
    editor: "You can edit the draft, manage examples and approve suggestions.",
    owner: "You can do everything, including publishing and sharing.",
  }[invite.role];
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-4.5 py-4">
      <div className="flex flex-col">
        <h2 className="m-0 text-[15px] font-semibold">
          @{invite.invitedBy} invited you to “{invite.schemaTitle}” as{" "}
          <span className="capitalize">{invite.role}</span>
        </h2>
        <span className="text-[13px] text-ink-2">{can}</span>
        <ErrorText error={respond.error} />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn h-10"
          onClick={() => respond.mutate("decline")}
          disabled={respond.isPending}
        >
          Decline
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => respond.mutate("accept")}
          disabled={respond.isPending}
        >
          Accept
        </button>
      </div>
    </section>
  );
}

function CreateLink({
  href,
  title,
  hint,
  icon,
}: {
  href: string;
  title: string;
  hint: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-surface px-4 text-ink no-underline"
    >
      <Icon name={icon} />
      <span className="flex flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
    </Link>
  );
}

function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-accent"
    >
      {name === "paste" && (
        <>
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </>
      )}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
    </svg>
  );
}
