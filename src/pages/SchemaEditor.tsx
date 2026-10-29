import { useMutation } from "@tanstack/react-query";
import { type CSSProperties, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { atLeast, type SchemaDetail } from "../../shared/api";
import {
  applySuggestion,
  diffSources,
  type Format,
  parseSource,
  serialize,
} from "../../shared/patch";
import { ago, api, queryClient, useMe, useSchema } from "../api";
import { Inspector } from "../builder/Inspector";
import { Outline } from "../builder/Outline";
import { addDefinition, addProperty } from "../builder/ops";
import { getAt, isObj, type Path, pathKey, typeList } from "../builder/tree";
import { meets, parseOrNull, type Target, useContract } from "../compat/contract";
import { classify } from "../compat/diff";
import { Splitter, usePanelWidth } from "../ui/Splitter";
import { BackHome, ErrorText, Segmented, srOnly } from "../ui/ui";
import { PropertyDetails } from "./editor/PropertyDetails";
import {
  CommentsPanel,
  ExamplesPanel,
  fromPointer,
  ProblemsPanel,
  SourcePanel,
  SuggestionsPanel,
  toPointer,
  useComments,
  useSuggestions,
} from "./editor/panels";
import { ShareDialog } from "./editor/ShareDialog";
import { useDraft } from "./editor/useDraft";

export default function SchemaEditor({ id, share }: { id: number; share?: boolean }) {
  const detail = useSchema(id);
  if (detail.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (detail.isError) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <ErrorText error={detail.error} />
        <a href="/">Back to my schemas</a>
      </div>
    );
  }
  return <Loaded key={id} detail={detail.data} share={share} />;
}

type Tab = "source" | "examples" | "comments" | "suggestions" | "problems";

const SchemaGraph = lazy(() => import("../graph/SchemaGraph"));

function Loaded({ detail, share }: { detail: SchemaDetail; share?: boolean }) {
  const [, navigate] = useLocation();
  const me = useMe();
  const { schema } = detail;
  const role = schema.role;
  const canEdit = atLeast(role, "editor");
  const canSuggest = atLeast(role, "commenter");
  const draft = useDraft(detail);
  const latest = detail.versions[0] ?? null;

  const [view, setView] = useState<"draft" | string>("draft");
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"edit" | "suggest">(canEdit ? "edit" : "suggest");
  const [suggestText, setSuggestText] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("source");
  const [selected, setSelected] = useState<Path>([]);
  const [open, setOpen] = useState(new Map<string, boolean>());
  const [centre, setCentre] = useState<"details" | "graph">("details");
  const panel = usePanelWidth("studio-side-panel", 460, 320, 640);
  const history = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });

  const version = view === "draft" ? null : detail.versions.find((v) => v.semver === view);
  const suggesting = editing && mode === "suggest";
  const working = version ? version.text : suggesting ? (suggestText ?? draft.text) : draft.text;
  const format: Format = version ? schema.format : draft.format;
  const writable = !version && editing && (suggesting || canEdit);

  const parsed = useMemo(() => {
    try {
      return { root: parseSource(working, format) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [working, format]);
  const root = "root" in parsed ? parsed.root : null;

  const setWorking = (next: string, nextFormat?: Format) => {
    history.current.past = [...history.current.past, working].slice(-100);
    history.current.future = [];
    if (suggesting) setSuggestText(next);
    else draft.setText(next, nextFormat);
  };

  const commit = (next: unknown, select?: Path) => {
    let text: string;
    try {
      // Patch the source instead of re-serializing so YAML comments survive visual edits.
      text = applySuggestion(working, format, diffSources(root, next));
    } catch {
      text = serialize(next, format);
    }
    setWorking(text);
    if (select) selectPath(select);
  };

  const undoRedo = (redo: boolean) => {
    const h = history.current;
    const from = redo ? h.future : h.past;
    if (!from.length) return;
    const text = redo ? from[0] : from[from.length - 1];
    if (redo) {
      h.future = h.future.slice(1);
      h.past = [...h.past, working];
    } else {
      h.past = h.past.slice(0, -1);
      h.future = [working, ...h.future];
    }
    if (suggesting) setSuggestText(text);
    else draft.setText(text);
  };

  useEffect(() => {
    if (!writable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if ((e.target as HTMLElement).closest("input, textarea, select, .monaco-editor")) return;
      e.preventDefault();
      undoRedo(e.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectPath = (path: Path) => {
    setSelected(path);
    setOpen((m) => {
      const next = new Map(m);
      for (let i = 0; i < path.length; i++) next.set(pathKey(path.slice(0, i)), true);
      return next;
    });
  };

  let sel = selected;
  while (
    root !== null &&
    sel.length &&
    !isObj(getAt(root, sel)) &&
    typeof getAt(root, sel) !== "boolean"
  )
    sel = sel.slice(0, -1);
  const pointer = toPointer(sel);

  const switchFormat = (to: Format) => {
    if (to === format) return;
    try {
      const value = parseSource(draft.text, format);
      draft.setText(serialize(value, to), to);
      if (suggestText !== null) setSuggestText(serialize(parseSource(suggestText, format), to));
    } catch (e) {
      alert(`Can't convert: ${(e as Error).message}`);
    }
  };

  const draftRoot = useMemo(
    () => parseOrNull(draft.text, draft.format),
    [draft.text, draft.format],
  );
  const latestRoot = useMemo(
    () => (latest ? parseOrNull(latest.text, schema.format) : null),
    [latest, schema.format],
  );
  const targets = useMemo<Target[]>(
    () => [
      { label: "draft", schema: draftRoot },
      ...(latest ? [{ label: latest.semver, schema: latestRoot }] : []),
    ],
    [draftRoot, latestRoot, latest],
  );
  const matrix = useContract(detail.examples, targets);
  const breaking = useMemo(
    () =>
      latestRoot && draftRoot
        ? classify(latestRoot, draftRoot).filter((c) => c.level === "breaking")
        : [],
    [latestRoot, draftRoot],
  );
  const broken = latest
    ? detail.examples.filter(
        (x) => meets(matrix?.[x.id]?.[latest.semver]) && !meets(matrix?.[x.id]?.draft),
      )
    : [];
  const failing = matrix ? detail.examples.filter((x) => !meets(matrix[x.id]?.draft)).length : null;

  const reported = useRef<number | null>(null);
  useEffect(() => {
    if (failing === null || failing === reported.current || !canEdit) return;
    reported.current = failing;
    api(`/api/schemas/${schema.id}/draft/check`, { body: { failing } }).then(() =>
      queryClient.invalidateQueries({ queryKey: ["schemas"] }),
    );
  }, [failing, canEdit, schema.id]);

  const comments = useComments(schema.id);
  const suggestions = useSuggestions(schema.id);
  const openThreads = (comments.data ?? []).filter(
    (c) => !c.suggestionId && !c.parentId && !c.resolvedAt,
  );
  const badges = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of openThreads) {
      const key = pathKey(fromPointer(c.pointer));
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [openThreads]);
  const openSuggestions = (suggestions.data ?? []).filter((s) => s.status === "open").length;
  const problemCount = breaking.length + broken.length;

  const tabs: [Tab, string][] = [
    ["source", "Source"],
    ["examples", `Examples · ${detail.examples.length}`],
    ["comments", `Comments · ${openThreads.length}`],
    ["suggestions", `Suggestions · ${openSuggestions}`],
    ["problems", `Problems${problemCount ? ` · ${problemCount}` : ""}`],
  ];

  const startEdit = () => {
    setEditing(true);
    if (!canEdit) setMode("suggest");
  };
  const enterMode = (m: "edit" | "suggest") => {
    setMode(m);
    history.current = { past: [], future: [] };
  };
  useEffect(() => {
    if (suggesting && suggestText === null) setSuggestText(draft.text);
  }, [suggesting, suggestText, draft.text]);

  const addDefinitionToRoot = () => {
    if (root === null) return;
    const r = addDefinition(root, []);
    commit(r.root, r.path);
  };

  const addPropertyToSelection = () => {
    if (root === null) return;
    const node = getAt(root, sel);
    const types = typeList(node);
    const target = isObj(node) && (!types.length || types.includes("object")) ? sel : [];
    const r = addProperty(root, target);
    commit(r.root, r.path);
  };

  const saveLabel = {
    saved: `saved ${ago(draft.savedAt)}`,
    dirty: "unsaved changes",
    saving: "saving…",
    error: "not saved",
  }[draft.status];

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <BackHome />
          <div className="flex min-w-0 flex-col">
            <TitleField id={schema.id} title={schema.title} editable={canEdit} />
            <span className="text-xs text-muted">
              {me.data?.login === schema.ownerLogin
                ? "My schemas"
                : `Shared by @${schema.ownerLogin}`}
              {canEdit && ` · ${saveLabel}`}
            </span>
          </div>
          <label htmlFor="verSel" className={srOnly}>
            Version
          </label>
          <select
            id="verSel"
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              setEditing(false);
            }}
            className="h-9 rounded-lg border border-line bg-surface px-2 font-mono text-[12.5px]"
          >
            <option value="draft">{latest ? "draft" : "draft · unpublished"}</option>
            {detail.versions.map((v, i) => (
              <option key={v.semver} value={v.semver}>
                v{v.semver}
                {i === 0 ? " · latest" : ""}
              </option>
            ))}
          </select>
          {!version && canEdit && !suggesting && (
            <Segmented
              label="Source format"
              value={format}
              onChange={switchFormat}
              options={[
                ["yaml", "YAML"],
                ["json", "JSON"],
              ]}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!version && canSuggest && !editing && (
            <button type="button" className="btn-dark" onClick={startEdit}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              {canEdit ? "Edit" : "Suggest changes"}
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                className="btn h-10"
                aria-label="Undo"
                title="Undo (⌘Z)"
                onClick={() => undoRedo(false)}
              >
                ↶
              </button>
              <button
                type="button"
                className="btn h-10"
                aria-label="Redo"
                title="Redo (⇧⌘Z)"
                onClick={() => undoRedo(true)}
              >
                ↷
              </button>
              {canEdit && (
                <Segmented
                  tone="pill"
                  label="Edit mode"
                  value={mode}
                  onChange={enterMode}
                  options={[
                    ["edit", "Editing"],
                    ["suggest", "Suggesting"],
                  ]}
                />
              )}
              <button type="button" className="btn-dark" onClick={() => setEditing(false)}>
                Done
              </button>
            </>
          )}
          <Link href={`/schemas/${schema.id}/share`} className="btn h-10 px-3.5">
            Share
          </Link>
          <Link href={`/schemas/${schema.id}/versions`} className="btn-primary">
            {role === "owner" ? "Publish version" : "Versions"}
          </Link>
        </div>
      </header>

      {draft.conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-err-line bg-err-bg px-5 py-2 text-[13px] text-err"
        >
          @{draft.conflict.updatedBy ?? "someone"} changed the draft while you were editing.
          <button type="button" className="btn h-8" onClick={() => draft.resolveConflict("theirs")}>
            Load their version
          </button>
          <button type="button" className="btn h-8" onClick={() => draft.resolveConflict("mine")}>
            Keep mine (overwrite)
          </button>
        </div>
      )}
      {!draft.conflict && draft.error && (
        <div
          role="alert"
          className="border-b border-err-line bg-err-bg px-5 py-2 text-[13px] text-err"
        >
          Couldn't save: {draft.error}
        </div>
      )}
      {version && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-line bg-chip px-5 py-2 text-[13px] text-ink-2"
        >
          Viewing v{version.semver}, published by @{version.publishedBy} · read-only.
          <button type="button" className="btn h-8" onClick={() => setView("draft")}>
            Back to draft
          </button>
        </div>
      )}
      {suggesting && (
        <SuggestBar
          schemaId={schema.id}
          draftText={draft.text}
          suggestText={suggestText ?? draft.text}
          format={format}
          baseRevision={draft.revision.current}
          onDone={(n) => {
            setSuggestText(null);
            setEditing(false);
            if (n) navigate(`/schemas/${schema.id}/suggestions/${n}`);
          }}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
        {root !== null ? (
          <Outline
            root={root}
            selected={sel}
            open={open}
            onToggle={(key, isOpen) => setOpen((m) => new Map(m).set(key, isOpen))}
            onSelect={selectPath}
            onAddProperty={writable ? addPropertyToSelection : undefined}
            onAddDefinition={writable ? addDefinitionToRoot : undefined}
            badges={badges}
            className="max-h-[45vh] border-b lg:max-h-none lg:w-72 lg:border-r lg:border-b-0"
          />
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col gap-4.5 px-4 py-5 sm:px-7 sm:py-6 lg:overflow-auto">
          {"error" in parsed ? (
            <div className="flex flex-col gap-2 rounded-xl border border-err-line bg-err-bg p-4 text-err">
              <strong>The schema isn't valid {format.toUpperCase()}.</strong>
              <span>{parsed.error}</span>
              <span className="text-ink-2">Fix it in the Source panel.</span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <nav
                  aria-label="JSON pointer"
                  className="font-mono text-[13px] text-muted [overflow-wrap:anywhere]"
                >
                  {pointer}
                </nav>
                <div className="flex flex-wrap items-center gap-2">
                  {canSuggest && (
                    <button type="button" className="btn" onClick={() => setTab("comments")}>
                      Comment on this property
                    </button>
                  )}
                  <Segmented
                    label="Centre view"
                    tone="pill"
                    value={centre}
                    onChange={setCentre}
                    options={[
                      ["details", "Details"],
                      ["graph", "Graph"],
                    ]}
                  />
                </div>
              </div>
              {centre === "graph" ? (
                <div className="card h-[65vh] min-h-[420px] overflow-hidden lg:h-auto lg:flex-1">
                  <Suspense fallback={<p className="p-4 text-muted">Loading graph…</p>}>
                    <SchemaGraph
                      root={root}
                      selected={sel}
                      onSelect={selectPath}
                      onOpen={(path) => {
                        selectPath(path);
                        setCentre("details");
                      }}
                    />
                  </Suspense>
                </div>
              ) : writable ? (
                <div className="card -mx-1 overflow-hidden">
                  <Inspector
                    key={pathKey(sel)}
                    root={root}
                    path={sel}
                    onChange={commit}
                    onSelect={selectPath}
                  />
                </div>
              ) : (
                <>
                  <PropertyDetails root={root} path={sel} onSelect={selectPath} />
                  {!version && (
                    <p className="m-0 text-[13px] text-muted">
                      Read-only.{" "}
                      {canSuggest ? (
                        <>
                          Select{" "}
                          <strong className="text-ink">
                            {canEdit ? "Edit" : "Suggest changes"}
                          </strong>{" "}
                          to change this schema, or leave a comment.
                        </>
                      ) : (
                        "You have view access."
                      )}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </main>

        <Splitter label="Resize side panel" {...panel} />
        <aside
          aria-label="Source, comments and suggestions"
          style={{ "--panel-w": `${panel.width}px` } as CSSProperties}
          className="flex min-h-[70vh] min-w-0 flex-col bg-code text-[#E6E9EF] lg:min-h-0 lg:w-(--panel-w) lg:shrink-0 lg:overflow-y-auto"
        >
          <div
            role="tablist"
            aria-label="Side panel"
            className="flex flex-wrap gap-0.5 border-b border-code-line px-2 pt-2"
          >
            {tabs.map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-10 rounded-t-lg px-3 text-[13px] ${tab === t ? "bg-code-2 font-semibold text-white shadow-[inset_0_-2px_0_#8DB0FF]" : "text-code-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "source" && (
            <SourcePanel
              text={working}
              format={format}
              label={`${schema.slug}.schema.${format} · ${version ? `v${version.semver}` : suggesting ? "your suggestion" : latest ? "draft" : "unpublished draft"}`}
              readOnly={!writable}
              onChange={(t) => t !== working && setWorking(t)}
            />
          )}
          {tab === "examples" && (
            <ExamplesPanel
              detail={detail}
              matrix={matrix}
              latest={latest?.semver ?? null}
              root={draftRoot}
              canEdit={canEdit}
            />
          )}
          {tab === "comments" && (
            <CommentsPanel
              schemaId={schema.id}
              pointer={pointer}
              canComment={canSuggest}
              canResolveAll={canEdit}
              me={me.data?.login ?? ""}
              onSelectPointer={(p) => selectPath(fromPointer(p))}
            />
          )}
          {tab === "suggestions" && (
            <SuggestionsPanel schemaId={schema.id} text={draft.text} format={draft.format} />
          )}
          {tab === "problems" && root !== null && (
            <ProblemsPanel
              root={root}
              breaking={breaking}
              broken={broken}
              latest={latest?.semver ?? null}
              schemaId={schema.id}
              onSelect={selectPath}
            />
          )}
        </aside>
      </div>
      {share && (
        <ShareDialog
          schemaId={schema.id}
          title={schema.title}
          role={role}
          publicVersions={schema.publicVersions}
          onClose={() => navigate(`/schemas/${schema.id}`)}
        />
      )}
    </div>
  );
}

function TitleField({ id, title, editable }: { id: number; title: string; editable: boolean }) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  const rename = useMutation({
    mutationFn: (t: string) => api(`/api/schemas/${id}`, { method: "PATCH", body: { title: t } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schema", id] });
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
    },
  });
  if (!editable) return <span className="text-[15px] font-semibold">{title}</span>;
  return (
    <input
      aria-label="Schema title"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() && value !== title && rename.mutate(value.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="-mx-1 rounded border border-transparent px-1 text-[15px] font-semibold hover:border-line focus:border-line-strong"
    />
  );
}

function SuggestBar({
  schemaId,
  draftText,
  suggestText,
  format,
  baseRevision,
  onDone,
}: {
  schemaId: number;
  draftText: string;
  suggestText: string;
  format: Format;
  baseRevision: number;
  onDone: (number?: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const patch = useMemo(() => {
    try {
      return diffSources(parseSource(draftText, format), parseSource(suggestText, format));
    } catch {
      return null;
    }
  }, [draftText, suggestText, format]);
  const submit = useMutation({
    mutationFn: () =>
      api<{ number: number }>(`/api/schemas/${schemaId}/suggestions`, {
        body: { title, body, patch, baseRevision },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["suggestions", schemaId] });
      onDone(r.number);
    },
  });
  return (
    <div
      role="status"
      className="flex flex-col gap-2 border-b border-[#F4D9AE] bg-warn-bg px-5 py-2.5 text-[13px] text-warn"
    >
      <span>
        Suggesting: your edits are collected into one suggestion for an owner or editor to approve.
        The schema does not change until then.
        {patch
          ? ` ${patch.length} change${patch.length === 1 ? "" : "s"} so far.`
          : " The suggestion doesn't parse yet."}
      </span>
      {!!patch?.length && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <label className="flex flex-[1_1_240px] flex-col gap-1 font-semibold">
            Title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input font-normal"
              placeholder="What does this change?"
            />
          </label>
          <label className="flex flex-[2_1_320px] flex-col gap-1 font-semibold">
            Why
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="input font-normal"
              placeholder="Optional context for reviewers"
            />
          </label>
          <button type="submit" className="btn-primary" disabled={submit.isPending}>
            Submit suggestion
          </button>
          <button type="button" className="btn h-10" onClick={() => onDone()}>
            Discard
          </button>
          <ErrorText error={submit.error} />
        </form>
      )}
    </div>
  );
}
