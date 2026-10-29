import { useMutation, useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { stringify } from "yaml";
import type { Comment, Example, SchemaDetail, Suggestion } from "../../../shared/api";
import { appliesCleanly, type Format, type Operation } from "../../../shared/patch";
import { ago, api, queryClient } from "../../api";
import { type Finding, hints, owningNode } from "../../builder/SidePanel";
import { generateSample } from "../../builder/sample";
import type { Path } from "../../builder/tree";
import { type Matrix, meets } from "../../compat/contract";
import type { Change } from "../../compat/diff";
import { formatFromFileName } from "../../format";
import { ErrorText, srOnly } from "../../ui/ui";
import { validateSchema } from "../../validation/ajv";
import { pointerToPath } from "../../validation/location";

const Editor = lazy(() => import("../../editor/Editor"));

export const toPointer = (path: Path) =>
  `#/${path.map((s) => s.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
export const fromPointer = (pointer: string) => pointerToPath(pointer.replace(/^#/, ""));

export function SourcePanel({
  text,
  format,
  label,
  readOnly,
  onChange,
}: {
  text: string;
  format: Format;
  label: string;
  readOnly: boolean;
  onChange: (t: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-center justify-between text-xs text-code-muted">
        <span>
          {label}
          {readOnly ? " · read-only" : ""}
        </span>
        <button
          type="button"
          className="btn-code"
          onClick={() => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="min-h-[480px] flex-1 overflow-hidden rounded-[10px] border border-code-line">
        <Suspense fallback={<p className="p-3 text-code-muted">Loading editor…</p>}>
          <Editor
            fileName={`schema.${format}`}
            language={format}
            value={text}
            onChange={onChange}
            dark
            schema={null}
            readOnly={readOnly}
          />
        </Suspense>
      </div>
    </div>
  );
}

const chip = (ok: boolean | undefined) =>
  `inline-flex h-6 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-bold ${ok === undefined ? "bg-code-line text-code-muted" : ok ? "bg-[#12301F] text-ok-dark" : "bg-[#3A1512] text-err-dark"}`;

export function ExamplesPanel({
  detail,
  matrix,
  latest,
  root,
  canEdit,
}: {
  detail: SchemaDetail;
  matrix: Matrix | undefined;
  latest: string | null;
  root: unknown;
  canEdit: boolean;
}) {
  const [, navigate] = useLocation();
  const id = detail.schema.id;
  const fileInput = useRef<HTMLInputElement>(null);
  const create = useMutation({
    mutationFn: (ex: Partial<Example>) =>
      api<{ id: number }>(`/api/schemas/${id}/examples`, { body: ex }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["schema", id] });
      navigate(`/schemas/${id}/examples/${r.id}`);
    },
  });
  const n = detail.examples.length + 1;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <p className="m-0 text-[13px] text-[#C3CAD7]">
        Examples show how the schema is used and act as contract tests: each is re-validated against
        the draft and every published version.
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex h-[34px] items-center rounded-md bg-[#E6E9EF] px-3 text-[13px] font-semibold text-code"
            onClick={() =>
              create.mutate({
                name: `example-${n}.yaml`,
                format: "yaml",
                text: "",
                expect: "valid",
              })
            }
          >
            + New example
          </button>
          <button
            type="button"
            className="btn-code h-[34px] text-[13px]"
            onClick={() =>
              create.mutate({
                name: `generated-${n}.yaml`,
                format: "yaml",
                text: stringify(generateSample(root)),
                expect: "valid",
              })
            }
          >
            Generate from schema
          </button>
          <button
            type="button"
            className="btn-code h-[34px] text-[13px]"
            onClick={() => fileInput.current?.click()}
          >
            Import JSON / YAML
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".json,.yaml,.yml"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                create.mutate({
                  name: file.name,
                  format: formatFromFileName(file.name),
                  text: await file.text(),
                  expect: "valid",
                });
            }}
          />
        </div>
      )}
      <ErrorText error={create.error} />
      <div className="flex justify-between px-3 text-[11px] font-semibold tracking-[0.04em] text-code-muted uppercase">
        <span>Example</span>
        <span>{latest ? `v${latest} · draft` : "draft"}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {detail.examples.map((x) => {
          const pub = latest ? matrix?.[x.id]?.[latest] : undefined;
          const draft = matrix?.[x.id]?.draft;
          const breaks = meets(pub) && draft && !meets(draft);
          const problem =
            draft && "problems" in draft && !draft.meets ? draft.problems[0] : undefined;
          return (
            <li key={x.id}>
              <Link
                href={`/schemas/${id}/examples/${x.id}`}
                className={`flex items-center justify-between gap-2.5 rounded-[10px] border bg-code-2 px-3 py-2.5 no-underline ${draft && !meets(draft) ? "border-[#5A2420]" : "border-code-line"}`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-[13px] text-[#E6E9EF]">{x.name}</span>
                  <span className="text-xs text-code-muted">
                    {x.expect === "valid" ? "Should be valid" : "Should be rejected (negative)"}
                  </span>
                  {breaks && (
                    <span className="text-xs text-err-dark">
                      Breaks:{" "}
                      {problem
                        ? `${problem.message} at /${problem.path.join("/")}`
                        : "no longer meets expectation"}
                    </span>
                  )}
                  {draft && "error" in draft && (
                    <span className="text-xs text-err-dark">{draft.error}</span>
                  )}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {latest && (
                    <span className={chip(pub ? meets(pub) : undefined)} title={`v${latest}`}>
                      <span className={srOnly}>
                        v{latest}: {meets(pub) ? "meets" : "does not meet"} expectation
                      </span>
                      <span aria-hidden="true">{pub ? (meets(pub) ? "✓" : "✗") : "…"}</span>
                    </span>
                  )}
                  <span className={chip(draft ? meets(draft) : undefined)} title="Draft">
                    <span className={srOnly}>
                      Draft: {meets(draft) ? "meets" : "does not meet"} expectation
                    </span>
                    <span aria-hidden="true">{draft ? (meets(draft) ? "✓" : "✗") : "…"}</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {!detail.examples.length && <li className="px-3 text-code-muted">No examples yet.</li>}
      </ul>
    </div>
  );
}

export const useComments = (schemaId: number) =>
  useQuery({
    queryKey: ["comments", schemaId],
    queryFn: () => api<Comment[]>(`/api/schemas/${schemaId}/comments`),
  });

export function CommentsPanel({
  schemaId,
  pointer,
  canComment,
  me,
  canResolveAll,
  onSelectPointer,
}: {
  schemaId: number;
  pointer: string;
  canComment: boolean;
  me: string;
  canResolveAll: boolean;
  onSelectPointer: (pointer: string) => void;
}) {
  const comments = useComments(schemaId);
  const [showResolved, setShowResolved] = useState(false);
  const all = (comments.data ?? []).filter((c) => c.suggestionId === null);
  const threads = all.filter((c) => c.parentId === null && (showResolved || !c.resolvedAt));
  const resolvedCount = all.filter((c) => c.parentId === null && c.resolvedAt).length;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      {threads.map((t) => (
        <Thread
          key={t.id}
          thread={t}
          replies={all.filter((c) => c.parentId === t.id)}
          schemaId={schemaId}
          canReply={canComment}
          canResolve={canResolveAll || t.author === me}
          onSelectPointer={onSelectPointer}
        />
      ))}
      {!threads.length && <p className="m-0 text-code-muted">No open comments.</p>}
      {!!resolvedCount && (
        <button
          type="button"
          className="self-start text-xs text-code-link"
          onClick={() => setShowResolved(!showResolved)}
        >
          {showResolved ? "Hide" : "Show"} {resolvedCount} resolved
        </button>
      )}
      {canComment && <NewComment schemaId={schemaId} pointer={pointer} />}
    </div>
  );
}

function Thread({
  thread,
  replies,
  schemaId,
  canReply,
  canResolve,
  onSelectPointer,
}: {
  thread: Comment;
  replies: Comment[];
  schemaId: number;
  canReply: boolean;
  canResolve: boolean;
  onSelectPointer: (p: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const resolve = useMutation({
    mutationFn: () =>
      api(`/api/schemas/${schemaId}/comments/${thread.id}/resolve`, {
        body: { resolved: !thread.resolvedAt },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["comments", schemaId] }),
  });
  return (
    <article
      className={`flex flex-col gap-2 rounded-[10px] border border-code-line bg-code-2 p-3 ${thread.resolvedAt ? "opacity-60" : ""}`}
    >
      <div className="flex justify-between gap-2 text-xs">
        <button
          type="button"
          className="font-mono text-code-link [overflow-wrap:anywhere]"
          onClick={() => onSelectPointer(thread.pointer)}
        >
          {thread.pointer.replace(/^#/, "") || "/"}
        </button>
        <span className="shrink-0 text-code-muted">
          {replies.length ? `${replies.length} repl${replies.length > 1 ? "ies" : "y"} · ` : ""}
          {ago(thread.createdAt)}
        </span>
      </div>
      <p className="m-0 whitespace-pre-wrap text-[#E6E9EF]">
        <strong>@{thread.author}</strong> {thread.body}
      </p>
      {replies.map((r) => (
        <p key={r.id} className="m-0 whitespace-pre-wrap text-[#C3CAD7]">
          <strong className="text-[#E6E9EF]">@{r.author}</strong> {r.body}
        </p>
      ))}
      {replying && (
        <NewComment
          schemaId={schemaId}
          pointer={thread.pointer}
          parentId={thread.id}
          onDone={() => setReplying(false)}
        />
      )}
      <div className="flex gap-2">
        {canReply && !replying && (
          <button type="button" className="btn-code" onClick={() => setReplying(true)}>
            Reply
          </button>
        )}
        {canResolve && (
          <button type="button" className="btn-code" onClick={() => resolve.mutate()}>
            {thread.resolvedAt ? "Reopen" : "Resolve"}
          </button>
        )}
      </div>
    </article>
  );
}

export function NewComment({
  schemaId,
  pointer,
  parentId,
  suggestionId,
  onDone,
  light,
}: {
  schemaId: number;
  pointer: string;
  parentId?: number;
  suggestionId?: number;
  onDone?: () => void;
  light?: boolean;
}) {
  const [body, setBody] = useState("");
  const post = useMutation({
    mutationFn: () =>
      api(`/api/schemas/${schemaId}/comments`, { body: { pointer, body, parentId, suggestionId } }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["comments", schemaId] });
      onDone?.();
    },
  });
  const id = `comment-${parentId ?? suggestionId ?? "new"}`;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) post.mutate();
      }}
    >
      {!parentId && !suggestionId && (
        <label htmlFor={id} className="text-xs text-code-muted">
          New comment on{" "}
          <span className="font-mono text-code-link">{pointer.replace(/^#/, "") || "/"}</span>
        </label>
      )}
      <textarea
        id={id}
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label={parentId ? "Reply" : suggestionId ? "Comment" : undefined}
        placeholder={parentId ? "Write a reply." : "Write a comment. @mention to notify."}
        className={
          light
            ? "resize-y rounded-[10px] border border-line-strong bg-surface px-3 py-2.5"
            : "resize-y rounded-lg border border-code-border bg-code-2 px-3 py-2.5 text-[#E6E9EF]"
        }
      />
      <ErrorText error={post.error} />
      <div className="flex gap-2">
        <button
          type="submit"
          className={light ? "btn h-10" : "btn-code"}
          disabled={!body.trim() || post.isPending}
        >
          {parentId ? "Reply" : "Comment"}
        </button>
        {onDone && (
          <button type="button" className={light ? "btn h-10" : "btn-code"} onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export const useSuggestions = (schemaId: number) =>
  useQuery({
    queryKey: ["suggestions", schemaId],
    queryFn: () => api<Suggestion[]>(`/api/schemas/${schemaId}/suggestions`),
  });

export function patchLines(patch: Operation[]) {
  return patch.map((op) => {
    const value = "value" in op ? `: ${JSON.stringify(op.value)}` : "";
    return {
      sign: op.op === "remove" ? "-" : op.op === "add" ? "+" : "~",
      text: `${op.op === "remove" ? "- " : op.op === "add" ? "+ " : "~ "}${op.path}${value}`,
    };
  });
}

export function SuggestionsPanel({
  schemaId,
  text,
  format,
}: {
  schemaId: number;
  text: string;
  format: Format;
}) {
  const list = useSuggestions(schemaId);
  const [showClosed, setShowClosed] = useState(false);
  const visible = (list.data ?? []).filter(
    (s) => showClosed || s.status === "open" || s.status === "changes_requested",
  );
  return (
    <ul className="m-0 flex list-none flex-col gap-3 px-4 py-3.5">
      {visible.map((s) => {
        const clean = appliesCleanly(text, format, s.patch);
        return (
          <li
            key={s.id}
            className="flex flex-col gap-2 rounded-[10px] border border-code-line bg-code-2 p-3"
          >
            <div className="flex justify-between gap-2 text-xs text-code-muted">
              <span>
                #{s.number} · @{s.author} · {s.patch.length} change{s.patch.length > 1 ? "s" : ""}
              </span>
              {s.status === "open" || s.status === "changes_requested" ? (
                <span className={clean ? "text-ok-dark" : "text-warn-dark"}>
                  {clean ? "Applies cleanly" : "Conflicts with draft"}
                </span>
              ) : (
                <span className="capitalize">{s.status.replace("_", " ")}</span>
              )}
            </div>
            <strong className="text-[#E6E9EF]">{s.title}</strong>
            <code className="block overflow-x-auto rounded-md bg-code p-2 font-mono text-xs whitespace-pre">
              {patchLines(s.patch)
                .slice(0, 6)
                .map((l) => (
                  <span
                    key={l.text}
                    className={`block ${l.sign === "-" ? "text-err-dark" : l.sign === "+" ? "text-ok-dark" : "text-code-ink"}`}
                  >
                    {l.text}
                  </span>
                ))}
            </code>
            <Link
              href={`/schemas/${schemaId}/suggestions/${s.number}`}
              className="inline-flex h-[34px] items-center self-start rounded-md bg-[#E6E9EF] px-3 text-[13px] font-semibold text-code no-underline"
            >
              Review
            </Link>
          </li>
        );
      })}
      {!visible.length && <li className="text-code-muted">No open suggestions.</li>}
      {(list.data ?? []).length > visible.length || showClosed ? (
        <li>
          <button
            type="button"
            className="text-xs text-code-link"
            onClick={() => setShowClosed(!showClosed)}
          >
            {showClosed ? "Hide closed" : "Show closed"}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

export function ProblemsPanel({
  root,
  breaking,
  broken,
  latest,
  schemaId,
  onSelect,
}: {
  root: unknown;
  breaking: Change[];
  broken: Example[];
  latest: string | null;
  schemaId: number;
  onSelect: (p: Path) => void;
}) {
  const findings = useMemo<Finding[]>(
    () => [
      ...validateSchema(root).map((p) => ({ ...p, severity: "error" as const })),
      ...hints(root),
    ],
    [root],
  );
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 px-4 py-3.5">
      {breaking.map((c) => (
        <li key={`b${c.path}${c.text}`}>
          <button
            type="button"
            onClick={() => onSelect(owningNode(root, pointerToPath(c.path)))}
            className="flex w-full flex-col gap-1 rounded-[10px] border border-[#4A3415] bg-[#241A0C] p-3 text-left"
          >
            <span className="text-xs font-bold text-warn-dark">
              Breaking change since v{latest}
            </span>
            <span className="font-mono text-[12.5px] text-[#E6E9EF]">{c.path}</span>
            <span className="text-[13px] text-[#C3CAD7]">{c.text}</span>
          </button>
        </li>
      ))}
      {broken.map((x) => (
        <li
          key={`x${x.id}`}
          className="flex flex-col gap-1 rounded-[10px] border border-[#5A2420] bg-[#2A1210] p-3"
        >
          <span className="text-xs font-bold text-err-dark">Contract broken by draft</span>
          <Link
            href={`/schemas/${schemaId}/examples/${x.id}`}
            className="font-mono text-[12.5px] text-code-link"
          >
            {x.name}
          </Link>
          <span className="text-[13px] text-[#C3CAD7]">
            Meets its expectation in v{latest}, not in the draft.
          </span>
        </li>
      ))}
      {findings.slice(0, 200).map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: findings have no stable identity
        <li key={i}>
          <button
            type="button"
            onClick={() => onSelect(owningNode(root, f.path))}
            className={`flex w-full flex-col gap-1 rounded-[10px] border p-3 text-left ${f.severity === "error" ? "border-[#5A2420] bg-[#2A1210]" : "border-code-line bg-code-2"}`}
          >
            <span
              className={`text-xs font-bold ${f.severity === "error" ? "text-err-dark" : "text-code-muted"}`}
            >
              {f.severity === "error" ? "Meta-schema error" : "Hint"}
            </span>
            <span className="font-mono text-[12.5px] text-[#E6E9EF] [overflow-wrap:anywhere]">
              #/{f.path.join("/")}
            </span>
            <span className="text-[13px] text-[#C3CAD7]">{f.message}</span>
          </button>
        </li>
      ))}
      {!breaking.length && !broken.length && !findings.length && (
        <li className="text-ok-dark">No problems.</li>
      )}
    </ul>
  );
}
