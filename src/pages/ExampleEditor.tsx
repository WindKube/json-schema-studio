import { useMutation } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { atLeast, type Example, type SchemaDetail } from "../../shared/api";
import type { Format } from "../../shared/patch";
import { api, queryClient, useSchema } from "../api";
import { type Cell, meets, parseOrNull, type Target, useContract } from "../compat/contract";
import { FormView, focusField } from "../form/Form";
import { convert } from "../format";
import { useDocumentValidation } from "../panels/useDocumentValidation";
import { Chip, ErrorText, Logo, Segmented } from "../ui/ui";

const Editor = lazy(() => import("../editor/Editor"));

export default function ExampleEditor({ id, exampleId }: { id: number; exampleId: number }) {
  const detail = useSchema(id);
  if (detail.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (detail.isError) return <ErrorText error={detail.error} />;
  const example = detail.data.examples.find((x) => x.id === exampleId);
  if (!example) {
    return (
      <p className="p-6">
        Example not found. <Link href={`/schemas/${id}`}>Back to the schema</Link>
      </p>
    );
  }
  return <Loaded key={exampleId} detail={detail.data} example={example} />;
}

function Loaded({ detail, example }: { detail: SchemaDetail; example: Example }) {
  const [, navigate] = useLocation();
  const { schema, versions } = detail;
  const canEdit = atLeast(schema.role, "editor");
  const [name, setName] = useState(example.name);
  const [description, setDescription] = useState(example.description);
  const [expect, setExpect] = useState(example.expect);
  const [text, setText] = useState(example.text);
  const [format, setFormat] = useState<Format>(example.format);
  const [view, setView] = useState<"form" | Format>("form");
  const [convertError, setConvertError] = useState<string>();

  const dirty =
    name !== example.name ||
    description !== example.description ||
    expect !== example.expect ||
    text !== example.text ||
    format !== example.format;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const draftRoot = useMemo(
    () => parseOrNull(detail.draft.text, schema.format),
    [detail.draft.text, schema.format],
  );
  const active = useMemo(
    () =>
      draftRoot && typeof draftRoot === "object"
        ? { uri: `inmemory://schemas/${schema.slug}.json`, schema: draftRoot }
        : null,
    [draftRoot, schema.slug],
  );
  const validation = useDocumentValidation(active, text, format);

  const targets = useMemo<Target[]>(
    () => [
      { label: "draft", schema: draftRoot },
      ...versions.map((v) => ({ label: v.semver, schema: parseOrNull(v.text, schema.format) })),
    ],
    [draftRoot, versions, schema.format],
  );
  const probe = useMemo(
    () => [{ id: example.id, text, format, expect }],
    [example.id, text, format, expect],
  );
  const matrix = useContract(probe, targets);
  const row = matrix?.[example.id];
  const latest = versions[0];
  const draftMeets = meets(row?.draft);
  const latestMeets = latest ? meets(row?.[latest.semver]) : undefined;
  const broken = !!latest && latestMeets && row?.draft && !draftMeets;
  const draftProblem = row?.draft && "problems" in row.draft ? row.draft.problems[0] : undefined;

  const save = useMutation({
    mutationFn: () =>
      api(`/api/schemas/${schema.id}/examples/${example.id}`, {
        method: "PUT",
        body: { name, description, expect, text, format },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schema", schema.id] }),
  });
  const remove = useMutation({
    mutationFn: () =>
      api(`/api/schemas/${schema.id}/examples/${example.id}`, { method: "DELETE", body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schema", schema.id] });
      navigate(`/schemas/${schema.id}`);
    },
  });

  const switchView = (v: "form" | Format) => {
    setConvertError(undefined);
    if (v !== "form" && v !== format) {
      try {
        setText(convert(text, format, v));
        setFormat(v);
        setName((n) => n.replace(/\.(json|ya?ml)$/i, `.${v}`));
      } catch (e) {
        return setConvertError(`Can't convert: ${(e as Error).message}`);
      }
    }
    setView(v);
  };

  let summary: [string, string];
  if (!row) summary = ["Checking…", "bg-chip text-ink-2"];
  else if (broken) summary = ["Draft breaks the contract for this example", "bg-err-bg text-err"];
  else if (draftMeets)
    summary = [
      `Meets expectation in the draft${latest && latestMeets ? ` and v${latest.semver}` : ""}`,
      "bg-ok-bg text-ok",
    ];
  else summary = ["Does not meet its expectation in the draft", "bg-warn-bg text-warn"];

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link href={`/schemas/${schema.id}`} aria-label="Back to schema" className="inline-flex">
            <Logo size={36} />
          </Link>
          <div className="flex min-w-0 flex-col">
            <nav aria-label="Breadcrumb" className="text-xs text-muted">
              <Link href={`/schemas/${schema.id}`} className="text-muted">
                {schema.title}
              </Link>{" "}
              / Examples
            </nav>
            <input
              aria-label="Example name"
              value={name}
              readOnly={!canEdit}
              onChange={(e) => setName(e.target.value)}
              className="-mx-1 rounded border border-transparent px-1 font-mono text-[15px] font-semibold hover:border-line"
            />
          </div>
          <Segmented
            tone="pill"
            label="Expected outcome"
            value={expect}
            onChange={canEdit ? setExpect : () => {}}
            options={[
              ["valid", "Should be valid"],
              ["invalid", "Should be rejected"],
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Editor mode"
            value={view}
            onChange={switchView}
            options={[
              ["form", "Form"],
              ["yaml", "YAML"],
              ["json", "JSON"],
            ]}
          />
          {canEdit && (
            <>
              <button
                type="button"
                className="btn h-10"
                onClick={() => confirm(`Delete ${example.name}?`) && remove.mutate()}
                disabled={remove.isPending}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : dirty ? "Save example" : "Saved"}
              </button>
            </>
          )}
        </div>
      </header>
      <ErrorText error={save.error ?? remove.error} />

      <div className="flex flex-1 flex-wrap items-stretch">
        <main className="flex min-w-0 flex-[999_1_600px] flex-col gap-4 px-7 py-6">
          <div className="flex max-w-[760px] flex-col gap-1">
            <label htmlFor="exDesc" className="field-label">
              What this example shows
            </label>
            <input
              id="exDesc"
              value={description}
              readOnly={!canEdit}
              onChange={(e) => setDescription(e.target.value)}
              className="input h-11"
            />
          </div>
          {convertError && <ErrorText error={new Error(convertError)} />}
          {view === "form" ? (
            <div className="-mx-6 min-h-[400px] flex-1">
              <FormView
                active={active}
                problems={validation.problems}
                docText={text}
                format={format}
                onChange={canEdit ? setText : () => {}}
                onShowCode={() => setView(format)}
              />
            </div>
          ) : (
            <div className="flex min-h-[480px] flex-1 flex-col gap-2">
              <span className="text-xs text-muted">
                {name} · problems against the draft are underlined
              </span>
              <div className="min-h-[440px] flex-1 overflow-hidden rounded-xl border border-line">
                <Suspense fallback={<p className="p-3 text-muted">Loading editor…</p>}>
                  <Editor
                    fileName={`document.${format}`}
                    language={format}
                    value={text}
                    onChange={setText}
                    dark={false}
                    schema={active}
                    readOnly={!canEdit}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </main>

        <aside
          aria-label="Contract check"
          className="box-border flex max-w-full flex-[1_1_360px] flex-col gap-3.5 border-l border-line bg-surface p-5"
        >
          <h2 className="m-0 text-base font-semibold">Contract check</h2>
          <div role="status" className={`rounded-[10px] px-3.5 py-3 font-semibold ${summary[1]}`}>
            {summary[0]}
          </div>
          <table className="w-full border-collapse text-[13px]">
            <caption className="pb-1.5 text-left text-xs text-muted">
              Expected: {expect === "valid" ? "valid" : "rejected"} · checked against every version
            </caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-1.5 py-2 font-semibold">Version</th>
                <th className="px-1.5 py-2 font-semibold">Result</th>
                <th className="px-1.5 py-2 font-semibold">Meets expectation</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <ContractRow
                  key={t.label}
                  label={t.label === "draft" ? "draft" : `v${t.label}`}
                  cell={row?.[t.label]}
                />
              ))}
            </tbody>
          </table>

          {broken && (
            <div className="flex flex-col gap-2.5 rounded-[10px] border border-err-line bg-[#FDF0EE] p-3.5">
              {draftProblem && (
                <>
                  <code className="font-mono text-[12.5px] text-[#3D2320]">
                    /{draftProblem.path.join("/")}
                  </code>
                  <span className="text-[#3D2320]">
                    {draftProblem.message}. {expect === "valid" ? "Valid" : "Rejected"} in v
                    {latest?.semver}, not in the draft.
                  </span>
                </>
              )}
              <span className="text-[13px] text-ink-2">
                Documents like this one that work today would behave differently after you publish.
                Choose one:
              </span>
              <Link href={`/schemas/${schema.id}`} className="btn-primary">
                Keep the contract: change the schema
              </Link>
              {canEdit && (
                <button
                  type="button"
                  className="btn h-10 border-[#E3A79C] font-semibold text-[#9F1F14]"
                  onClick={() => {
                    setView("form");
                    if (draftProblem) setTimeout(() => focusField(draftProblem.path), 0);
                  }}
                >
                  Accept the break: update this example
                </button>
              )}
            </div>
          )}
          <p className="m-0 text-xs text-muted">
            Runs in your browser on every keystroke and again whenever the draft changes. Published
            versions record which examples they passed.
          </p>
        </aside>
      </div>
    </div>
  );
}

function ContractRow({ label, cell }: { label: string; cell: Cell | undefined }) {
  let result = "…";
  if (cell && "error" in cell) result = cell.error;
  else if (cell) result = cell.valid ? "Valid" : `Invalid · ${cell.problems[0]?.message ?? ""}`;
  return (
    <tr className="border-t border-line-soft">
      <td className="px-1.5 py-2.5 font-mono">{label}</td>
      <td className="px-1.5 py-2.5 text-ink-2">{result}</td>
      <td className="px-1.5 py-2.5">
        {cell && <Chip tone={meets(cell) ? "ok" : "err"}>{meets(cell) ? "Yes" : "No"}</Chip>}
      </td>
    </tr>
  );
}
