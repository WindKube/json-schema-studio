import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { atLeast, type SchemaDetail } from "../../shared/api";
import { parseSource, serialize } from "../../shared/patch";
import { ago, api, download, queryClient, useSchema } from "../api";
import { meets, parseOrNull, type Target, useContract } from "../compat/contract";
import { bumpFor, type Change, classify, type Level, nextVersion } from "../compat/diff";
import { Chip, ErrorText, type Tone } from "../ui/ui";

const LEVEL: Record<Level, [string, Tone]> = {
  breaking: ["Breaking", "err"],
  minor: ["Compatible", "ok"],
  patch: ["Docs", "info"],
};

export function Versions({ id }: { id: number }) {
  const detail = useSchema(id);
  if (detail.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (detail.isError) return <ErrorText error={detail.error} />;
  return <Loaded detail={detail.data} />;
}

function Loaded({ detail }: { detail: SchemaDetail }) {
  const { schema, versions, examples } = detail;
  const latest = versions[0] ?? null;
  const draftRoot = useMemo(
    () => parseOrNull(detail.draft.text, schema.format),
    [detail.draft.text, schema.format],
  );
  const roots = useMemo(
    () => versions.map((v) => parseOrNull(v.text, schema.format)),
    [versions, schema.format],
  );
  const draftChanged = !latest || latest.text !== detail.draft.text;
  const [picked, setPicked] = useState<string | null>(null);
  const sel = picked ?? (draftChanged ? "draft" : (latest?.semver ?? "draft"));

  const targets = useMemo<Target[]>(
    () => [
      { label: "draft", schema: draftRoot },
      ...(latest ? [{ label: latest.semver, schema: roots[0] }] : []),
    ],
    [draftRoot, roots, latest],
  );
  const matrix = useContract(examples, targets);

  const idx = versions.findIndex((v) => v.semver === sel);
  const curRoot = sel === "draft" ? draftRoot : roots[idx];
  const prevRoot = sel === "draft" ? (roots[0] ?? null) : (roots[idx + 1] ?? null);
  const prevLabel =
    sel === "draft"
      ? latest
        ? `v${latest.semver}`
        : "(empty)"
      : versions[idx + 1]
        ? `v${versions[idx + 1].semver}`
        : "(empty)";
  const changes = useMemo(
    () => (curRoot && prevRoot ? classify(prevRoot, curRoot) : []),
    [prevRoot, curRoot],
  );

  const list = [
    ...(draftChanged
      ? [
          {
            key: "draft",
            tag: latest ? "draft" : "unpublished",
            state: "Draft",
            tone: "warn" as Tone,
            summary: "Unpublished changes",
            meta: `edited ${ago(detail.draft.updatedAt)}${detail.draft.updatedBy ? ` by @${detail.draft.updatedBy}` : ""}`,
          },
        ]
      : []),
    ...versions.map((v, i) => ({
      key: v.semver,
      tag: `v${v.semver}`,
      state: i === 0 ? "Latest" : "Published",
      tone: (i === 0 ? "ok" : "neutral") as Tone,
      summary: v.notes.split("\n")[0] || "No release notes",
      meta: `Published by @${v.publishedBy} · ${ago(v.publishedAt)}`,
    })),
  ];

  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <Link href={`/schemas/${schema.id}`} className="btn h-10 px-3 font-medium">
          ← {schema.title}
        </Link>
        <span className="text-muted">Versions</span>
      </header>
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-start gap-6 px-6 pt-7 pb-14">
        <section aria-label="Version list" className="flex flex-[1_1_340px] flex-col gap-2">
          <h1 className="m-0 mb-1.5 text-[22px] font-bold tracking-tight">Versions</h1>
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {list.map((v) => (
              <li key={v.key}>
                <button
                  type="button"
                  aria-current={sel === v.key}
                  onClick={() => setPicked(v.key)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-[10px] bg-surface px-3.5 py-3 text-left ${sel === v.key ? "border-[1.5px] border-accent" : "border border-line"}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="font-mono font-semibold">{v.tag}</span>
                    <Chip tone={v.tone} round>
                      {v.state}
                    </Chip>
                  </span>
                  <span className="text-[13px] text-ink-2">{v.summary}</span>
                  <span className="text-xs text-muted">{v.meta}</span>
                </button>
              </li>
            ))}
            {!list.length && <li className="text-muted">Nothing published yet.</li>}
          </ol>
        </section>

        <main className="flex min-w-0 flex-[999_1_600px] flex-col gap-4">
          {sel === "draft" && schema.role === "owner" && (
            <PublishPanel
              detail={detail}
              matrix={matrix}
              changes={changes}
              onPublished={(v) => setPicked(v)}
            />
          )}
          {sel === "draft" && schema.role !== "owner" && (
            <p className="card m-0 p-4 text-ink-2">
              Only owners can publish. The draft has {changes.length} change
              {changes.length === 1 ? "" : "s"} since {prevLabel}.
            </p>
          )}

          <section aria-labelledby="cmpTitle" className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3">
              <h2 id="cmpTitle" className="m-0 text-sm font-semibold">
                Changes in{" "}
                <span className="font-mono">{sel === "draft" ? "draft" : `v${sel}`}</span> since{" "}
                <span className="font-mono">{prevLabel}</span>
              </h2>
              <span className="text-xs text-muted">
                {changes.length} change{changes.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="m-0 list-none p-0">
              {changes.map((c) => (
                <li
                  key={c.path + c.text}
                  className="flex flex-wrap items-baseline gap-2.5 border-t border-line-soft px-4 py-3 first:border-t-0"
                >
                  <Chip tone={LEVEL[c.level][1]}>{LEVEL[c.level][0]}</Chip>
                  <code className="font-mono text-[13px]">{c.path}</code>
                  <span className="text-ink-2">{c.text}</span>
                </li>
              ))}
              {!changes.length && (
                <li className="px-4 py-3 text-muted">
                  {prevRoot ? "No schema changes." : "First version: nothing to compare against."}
                </li>
              )}
            </ul>
          </section>

          {sel !== "draft" && idx >= 0 && <PublishedActions detail={detail} semver={sel} />}
        </main>
      </div>
    </div>
  );
}

function PublishPanel({
  detail,
  matrix,
  changes,
  onPublished,
}: {
  detail: SchemaDetail;
  matrix: ReturnType<typeof useContract>;
  changes: Change[];
  onPublished: (semver: string) => void;
}) {
  const { schema, examples, versions } = detail;
  const latest = versions[0] ?? null;
  const broken = latest
    ? examples.filter(
        (x) => meets(matrix?.[x.id]?.[latest.semver]) && !meets(matrix?.[x.id]?.draft),
      )
    : [];
  const failing = examples.filter((x) => matrix && !meets(matrix[x.id]?.draft));
  const suggested = bumpFor(changes, broken.length);
  const [bump, setBump] = useState<Level | null>(null);
  const level = bump ?? suggested;
  const [notes, setNotes] = useState("");
  const breaking = changes.filter((c) => c.level === "breaking");

  const publish = useMutation({
    mutationFn: () =>
      api<{ semver: string }>(`/api/schemas/${schema.id}/versions`, {
        body: {
          semver: nextVersion(latest?.semver ?? null, level),
          notes,
          exampleResults: examples.map((x) => ({
            exampleId: x.id,
            name: x.name,
            meetsExpectation: meets(matrix?.[x.id]?.draft),
          })),
        },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["schema", schema.id] });
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
      onPublished(r.semver);
    },
  });

  return (
    <section aria-labelledby="pubTitle" className="card flex flex-col gap-3.5 p-5">
      <h2 id="pubTitle" className="m-0 text-lg font-semibold">
        Publish the draft
      </h2>
      {(breaking.length > 0 || broken.length > 0) && latest && (
        <div className="rounded-[10px] bg-warn-bg px-3.5 py-3 text-[13px] text-warn">
          <strong>Breaking change detected:</strong>{" "}
          {breaking.length > 0 &&
            `${breaking
              .map((c) => `${c.path} ${c.text}`)
              .slice(0, 3)
              .join("; ")}. `}
          {broken.length > 0 &&
            `${broken.length} example${broken.length > 1 ? "s" : ""} that passed v${latest.semver} now fail${broken.length > 1 ? "" : "s"}. `}
          Publish as a major version, or update the schema or example first.
        </div>
      )}
      <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3.5">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="font-semibold">Examples against the draft</span>
          <Link href={`/schemas/${schema.id}`} className="text-[13px]">
            Open examples
          </Link>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
          {examples.map((x) => {
            const cell = matrix?.[x.id]?.draft;
            const isBroken = broken.includes(x);
            const [text, tone]: [string, Tone] = !cell
              ? ["Checking", "neutral"]
              : isBroken
                ? ["Breaks", "err"]
                : meets(cell)
                  ? [x.expect === "valid" ? "Pass" : "Rejected as expected", "ok"]
                  : ["Fails", "err"];
            const why = cell && "problems" in cell && !cell.meets ? cell.problems[0] : undefined;
            return (
              <li key={x.id} className="flex flex-wrap items-baseline gap-2">
                <Chip tone={tone}>{text}</Chip>
                <Link href={`/schemas/${schema.id}/examples/${x.id}`} className="font-mono">
                  {x.name}
                </Link>
                {why && (
                  <span className="text-ink-2">
                    {why.message} at /{why.path.join("/")}
                  </span>
                )}
                {cell && "error" in cell && <span className="text-ink-2">{cell.error}</span>}
              </li>
            );
          })}
          {!examples.length && (
            <li className="text-muted">
              No examples. Add some to catch breaking changes before publishing.
            </li>
          )}
        </ul>
        {!!failing.length && (
          <span className="text-xs text-warn">Publishing records which examples passed.</span>
        )}
      </div>
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="field-label mb-2 p-0">Version number</legend>
        {(latest ? (["breaking", "minor", "patch"] as Level[]) : [suggested]).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={level === l}
            onClick={() => setBump(l)}
            className={`flex min-w-[140px] flex-col items-start rounded-[10px] px-3.5 py-2.5 text-left ${level === l ? "border-[1.5px] border-accent bg-accent-soft" : "border border-line bg-surface"}`}
          >
            <span className="font-mono font-semibold">
              v{nextVersion(latest?.semver ?? null, l)}
            </span>
            <span className="text-xs text-muted">
              {{ breaking: "Major", minor: "Minor", patch: "Patch" }[l]}
              {l === suggested ? " · suggested" : ""}
            </span>
          </button>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="relNotes" className="field-label">
          Release notes
        </label>
        <textarea
          id="relNotes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="resize-y rounded-[10px] border border-line-strong px-3 py-2.5"
        />
      </div>
      <ErrorText error={publish.error} />
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[13px] text-muted">
          Published versions are immutable and served at a stable URL.
        </span>
        <button
          type="button"
          className="btn-primary h-11 rounded-[10px]"
          disabled={publish.isPending || !matrix}
          onClick={() => publish.mutate()}
        >
          Publish v{nextVersion(latest?.semver ?? null, level)}
        </button>
      </div>
    </section>
  );
}

function PublishedActions({ detail, semver }: { detail: SchemaDetail; semver: string }) {
  const [, navigate] = useLocation();
  const { schema } = detail;
  const v = detail.versions.find((x) => x.semver === semver);
  const url = `${location.origin}/s/${schema.ownerLogin}/${schema.slug}/${semver}.json`;
  const restore = useMutation({
    mutationFn: () => api(`/api/schemas/${schema.id}/versions/${semver}/restore`, { body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schema", schema.id] });
      navigate(`/schemas/${schema.id}`);
    },
  });
  if (!v) return null;
  const save = (format: "json" | "yaml") =>
    download(
      `${schema.slug}-${semver}.${format}`,
      format === schema.format ? v.text : serialize(parseSource(v.text, schema.format), format),
    );

  return (
    <section aria-label="Version actions" className="card flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-muted">
          Stable URL
          {schema.publicVersions ? " · public" : " · members only (make it public in Share)"}
        </span>
        <code className="font-mono text-[13px] [overflow-wrap:anywhere]">
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </code>
      </div>
      {v.notes && <p className="m-0 whitespace-pre-wrap text-ink-2">{v.notes}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn h-10" onClick={() => save("json")}>
          Download JSON
        </button>
        <button type="button" className="btn h-10" onClick={() => save("yaml")}>
          Download YAML
        </button>
        {atLeast(schema.role, "editor") && (
          <button
            type="button"
            className="btn h-10"
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
          >
            Restore as new draft
          </button>
        )}
      </div>
      <ErrorText error={restore.error} />
    </section>
  );
}
