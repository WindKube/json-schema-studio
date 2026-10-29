import { useMutation, useQuery } from "@tanstack/react-query";
import { applyPatch, deepClone } from "fast-json-patch";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { stringify } from "yaml";
import { atLeast, type Suggestion, type SuggestionStatus } from "../../shared/api";
import { parseSource } from "../../shared/patch";
import { ago, api, queryClient, useSchema } from "../api";
import { getAt } from "../builder/tree";
import { bumpFor, classify } from "../compat/diff";
import { diffLines } from "../compat/lines";
import { Chip, ErrorText, Segmented, type Tone } from "../ui/ui";
import { pointerToPath } from "../validation/location";
import { NewComment, patchLines, useComments } from "./editor/panels";

const STATUS: Record<SuggestionStatus, [string, Tone, string]> = {
  open: ["Open", "info", ""],
  approved: ["Approved", "ok", "Applied to the draft. The author was notified."],
  changes_requested: ["Changes requested", "warn", "Sent back to the author with your note."],
  rejected: ["Rejected", "err", "Closed without changes. The author was notified."],
};

function commonPrefix(paths: string[][]): string[] {
  if (!paths.length) return [];
  let prefix = paths[0].slice(0, -1);
  for (const p of paths.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < p.length - 1 && prefix[i] === p[i]) i++;
    prefix = prefix.slice(0, i);
  }
  // Show the whole array when an item changed, so indices read naturally.
  while (prefix.length && /^\d+$/.test(prefix[prefix.length - 1])) prefix = prefix.slice(0, -1);
  return prefix;
}

export function Review({ id, number }: { id: number; number: number }) {
  const detail = useSchema(id);
  const suggestion = useQuery({
    queryKey: ["suggestion", id, number],
    queryFn: () => api<Suggestion>(`/api/schemas/${id}/suggestions/${number}`),
  });
  const comments = useComments(id);
  const [fmt, setFmt] = useState<"yaml" | "json">("yaml");
  const [note, setNote] = useState("");

  const view = useMemo(() => {
    if (!detail.data || !suggestion.data) return null;
    const s = suggestion.data;
    let root: unknown;
    try {
      root = parseSource(detail.data.draft.text, detail.data.schema.format);
    } catch {
      return { clean: false, prefix: [] as string[], lines: [], level: null };
    }
    const prefix = commonPrefix(s.patch.map((op) => pointerToPath(op.path)));
    try {
      const after = applyPatch(deepClone(root), s.patch, true, false).newDocument;
      const show = (v: unknown) => (fmt === "json" ? JSON.stringify(v, null, 2) : stringify(v));
      return {
        clean: true,
        prefix,
        lines: diffLines(show(getAt(root, prefix) ?? {}), show(getAt(after, prefix) ?? {})),
        level: bumpFor(classify(root, after)),
      };
    } catch {
      return { clean: false, prefix, lines: [], level: null };
    }
  }, [detail.data, suggestion.data, fmt]);

  const decide = useMutation({
    mutationFn: (decision: "approve" | "changes" | "reject" | "reopen") =>
      api(`/api/schemas/${id}/suggestions/${number}/decision`, { body: { decision, note } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suggestion", id, number] });
      queryClient.invalidateQueries({ queryKey: ["suggestions", id] });
      queryClient.invalidateQueries({ queryKey: ["schema", id] });
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
    },
  });

  if (detail.isPending || suggestion.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (detail.isError || suggestion.isError)
    return <ErrorText error={detail.error ?? suggestion.error} />;
  const s = suggestion.data;
  const schema = detail.data.schema;
  const canDecide = atLeast(schema.role, "editor");
  const [label, tone, result] = STATUS[s.status];
  const discussion = (comments.data ?? []).filter((c) => c.suggestionId === s.id);
  const pending = s.status === "open" || s.status === "changes_requested";

  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <Link href={`/schemas/${id}`} className="btn h-10 px-3 font-medium">
          ← {schema.title}
        </Link>
        <span className="text-muted">Suggestions</span>
      </header>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-6 px-6 pt-7 pb-14">
        <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-4.5">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <Chip tone={tone} round>
                {label}
              </Chip>
              <span className="text-muted">
                #{s.number} · proposed by <strong className="text-ink">@{s.author}</strong> ·{" "}
                {ago(s.createdAt)}
              </span>
            </div>
            <h1 className="m-0 text-[28px] font-bold tracking-tight">{s.title}</h1>
            {s.body && <p className="m-0 max-w-[720px] text-ink-2">{s.body}</p>}
          </div>

          <section aria-labelledby="diffTitle" className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3">
              <h2 id="diffTitle" className="m-0 font-mono text-sm">
                #/{view?.prefix.join("/")}
              </h2>
              <Segmented
                label="Diff format"
                value={fmt}
                onChange={setFmt}
                options={[
                  ["yaml", "YAML"],
                  ["json", "JSON"],
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              {view?.clean ? (
                <pre className="m-0 py-3 font-mono text-[13px] leading-[1.7]">
                  {view.lines.map((l, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
                      key={i}
                      className={`block px-4 ${l.sign === "+" ? "bg-ok-bg text-ok" : l.sign === "-" ? "bg-err-bg text-err" : "text-muted"}`}
                    >
                      {l.sign} {l.text}
                    </span>
                  ))}
                </pre>
              ) : (
                <pre className="m-0 py-3 font-mono text-[13px] leading-[1.7]">
                  {patchLines(s.patch).map((l) => (
                    <span key={l.text} className="block px-4">
                      {l.text}
                    </span>
                  ))}
                </pre>
              )}
            </div>
            <div className="flex flex-wrap gap-4 border-t border-line bg-subtle px-4 py-3 text-[13px] text-ink-2">
              <span>
                Stored as JSON Patch:{" "}
                <code className="font-mono">
                  {s.patch
                    .slice(0, 3)
                    .map((op) => `${op.op} ${op.path}`)
                    .join(", ")}
                  {s.patch.length > 3 ? ` +${s.patch.length - 3}` : ""}
                </code>
              </span>
              {pending &&
                (view?.clean ? (
                  <span className="font-semibold text-ok">
                    Applies cleanly to the current draft
                  </span>
                ) : (
                  <span className="font-semibold text-err">Conflicts with the current draft</span>
                ))}
              {view?.level && (
                <span>
                  Compatibility:{" "}
                  <strong>
                    {{ breaking: "major", minor: "minor", patch: "patch" }[view.level]}
                  </strong>
                </span>
              )}
            </div>
          </section>

          <section aria-labelledby="discTitle" className="flex flex-col gap-3">
            <h2 id="discTitle" className="m-0 text-base font-semibold">
              Discussion
            </h2>
            {discussion.map((c) => (
              <article key={c.id} className="card px-4 py-3.5">
                <p className="m-0 mb-1 text-[13px] text-muted">
                  <strong className="text-ink">@{c.author}</strong> · {ago(c.createdAt)}
                </p>
                <p className="m-0 whitespace-pre-wrap">{c.body}</p>
              </article>
            ))}
            {atLeast(schema.role, "commenter") && (
              <NewComment schemaId={id} pointer="#" suggestionId={s.id} light />
            )}
            {s.decisionNote && (
              <article className="card px-4 py-3.5">
                <p className="m-0 mb-1 text-[13px] text-muted">
                  <strong className="text-ink">@{s.decidedBy}</strong> · review note
                </p>
                <p className="m-0 whitespace-pre-wrap">{s.decisionNote}</p>
              </article>
            )}
          </section>
        </main>

        <aside aria-label="Decision" className="flex flex-[1_1_300px] flex-col gap-3">
          <div className="card flex flex-col gap-3 p-4.5">
            <h2 className="m-0 text-base font-semibold">Decision</h2>
            {canDecide && pending ? (
              <>
                <label htmlFor="reviewNote" className="field-label">
                  Your review note (optional, required to reject)
                </label>
                <textarea
                  id="reviewNote"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="resize-y rounded-[10px] border border-line-strong px-3 py-2.5"
                />
                <button
                  type="button"
                  className="btn-primary h-11 rounded-[10px]"
                  disabled={!view?.clean || decide.isPending}
                  onClick={() => decide.mutate("approve")}
                >
                  Approve and apply
                </button>
                <button
                  type="button"
                  className="btn h-11 rounded-[10px]"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate("changes")}
                >
                  Request changes
                </button>
                <button
                  type="button"
                  className="btn h-11 rounded-[10px] border-[#E3A79C] font-semibold text-[#9F1F14]"
                  disabled={decide.isPending || !note.trim()}
                  onClick={() => decide.mutate("reject")}
                >
                  Reject
                </button>
                <p className="m-0 text-[13px] text-muted">
                  Approving applies the patch to the draft and records you as approver. Publish a
                  version to release it.
                </p>
              </>
            ) : (
              <>
                <div
                  role="status"
                  className={`rounded-[10px] p-3 font-semibold ${{ info: "bg-accent-soft text-[#1e3a8a]", ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", err: "bg-err-bg text-err", neutral: "" }[tone]}`}
                >
                  {s.status === "open"
                    ? "Waiting for an owner or editor."
                    : `${result}${s.decidedBy ? ` (@${s.decidedBy})` : ""}`}
                </div>
                {canDecide && s.status === "rejected" && (
                  <button
                    type="button"
                    className="btn h-10"
                    onClick={() => decide.mutate("reopen")}
                  >
                    Reopen
                  </button>
                )}
              </>
            )}
            <ErrorText error={decide.error} />
          </div>
          <div className="card flex flex-col gap-2 p-4.5 text-[13px]">
            <span className="font-semibold">Who can decide</span>
            <span className="text-ink-2">
              Owners and Editors. Commenters can propose and discuss but not approve, including
              their own suggestions.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
