import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { SchemaDetail } from "../../shared/api";
import { type Format, serialize } from "../../shared/patch";
import { api } from "../api";
import { isObj } from "../builder/tree";
import { loadCatalog } from "../schemas/catalog";
import { Dialog, ErrorText, Segmented } from "../ui/ui";
import { detectDraft, validateSchema } from "../validation/ajv";
import { createSchema, useSchemaList } from "./Home";

type Parsed =
  | { ok: true; format: Format; value: unknown }
  | { ok: false; format: Format; message: string; line?: number; trailingComma: boolean };

function parseInput(text: string, mode: "auto" | Format): Parsed {
  const looksJson = /^\s*[{[]/.test(text);
  const format: Format = mode === "auto" ? (looksJson ? "json" : "yaml") : mode;
  if (format === "json") {
    try {
      return { ok: true, format, value: JSON.parse(text) };
    } catch (e) {
      const message = (e as Error).message;
      const pos = Number(message.match(/position (\d+)/)?.[1]);
      const line =
        Number(message.match(/line (\d+)/)?.[1]) ||
        (Number.isFinite(pos) ? text.slice(0, pos).split("\n").length : undefined);
      return { ok: false, format, message, line, trailingComma: /,(\s*[}\]])/.test(text) };
    }
  }
  try {
    return { ok: true, format, value: parseYaml(text) };
  } catch (e) {
    const line = e instanceof YAMLParseError ? e.linePos?.[0].line : undefined;
    return {
      ok: false,
      format,
      message: (e as Error).message.split("\n")[0],
      line,
      trailingComma: false,
    };
  }
}

export function PasteDialog({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"auto" | Format>("auto");
  const [target, setTarget] = useState<"new" | number>("new");
  const [keepFormat, setKeepFormat] = useState(true);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useSchemaList();
  const catalog = useQuery({
    queryKey: ["catalog", "schemastore"],
    queryFn: loadCatalog,
    staleTime: Infinity,
  });

  const parsed = useMemo(() => (text.trim() ? parseInput(text, mode) : null), [text, mode]);
  const summary = useMemo(() => {
    if (!parsed?.ok) return null;
    const v = parsed.value;
    const problems = validateSchema(v);
    const props = isObj(v) && isObj(v.properties) ? Object.keys(v.properties).length : 0;
    const req = isObj(v) && Array.isArray(v.required) ? v.required.length : 0;
    const id = isObj(v) && typeof v.$id === "string" ? v.$id : null;
    const like =
      id && catalog.data?.find((c) => c.url === id || id.endsWith(new URL(c.url).pathname));
    return {
      problems,
      chips: [
        `Dialect: ${detectDraft(v)}`,
        `Root type: ${isObj(v) && typeof v.type === "string" ? v.type : "any"}`,
        `${props} properties · ${req} required`,
        ...(like ? [`Looks like: ${like.name}`] : []),
      ],
    };
  }, [parsed, catalog.data]);

  const editable = [...(list.data?.mine ?? []), ...(list.data?.shared ?? [])].filter(
    (r) => r.role === "owner" || r.role === "editor",
  );
  const lines = Math.max(14, text.split("\n").length);

  const jumpTo = (line: number) => {
    const el = area.current;
    if (!el) return;
    const start =
      text
        .split("\n")
        .slice(0, line - 1)
        .join("\n").length + (line > 1 ? 1 : 0);
    el.focus();
    el.setSelectionRange(start, start + (text.split("\n")[line - 1]?.length ?? 0));
  };

  const open = async () => {
    if (!parsed?.ok) return;
    setBusy(true);
    setError(undefined);
    try {
      const format = keepFormat ? parsed.format : parsed.format === "json" ? "yaml" : "json";
      const body = keepFormat ? text : serialize(parsed.value, format);
      if (target === "new") {
        navigate(`/schemas/${await createSchema({ format, text: body })}`, { replace: true });
      } else {
        const detail = await api<SchemaDetail>(`/api/schemas/${target}`);
        await api(`/api/schemas/${target}/draft`, {
          method: "PUT",
          body: { text: body, format, revision: detail.draft.revision },
        });
        navigate(`/schemas/${target}`, { replace: true });
      }
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const ok = !!parsed?.ok;
  const detected = (parsed?.format ?? "json").toUpperCase();

  return (
    <Dialog
      title="Paste a schema"
      subtitle="JSON or YAML, detected automatically. Checked as you type."
      onClose={onClose}
      footer={
        <>
          <a href="/catalog">Or start from a template</a>
          <div className="flex gap-2">
            <button type="button" className="btn h-11 rounded-[10px] px-4" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary h-11 rounded-[10px]"
              disabled={!ok || busy}
              onClick={open}
            >
              Open in editor
            </button>
          </div>
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <label htmlFor="pasteArea" className="field-label">
          Schema source
        </label>
        <Segmented
          label="Source format"
          value={mode}
          onChange={setMode}
          options={[
            ["auto", `Auto · ${detected}`],
            ["json", "JSON"],
            ["yaml", "YAML"],
          ]}
        />
      </div>
      <div
        className={`flex overflow-hidden rounded-[10px] border bg-code ${parsed && !ok ? "border-[#D9473A]" : "border-line-strong"}`}
      >
        <pre
          aria-hidden="true"
          className="m-0 bg-code-2 px-2.5 py-3 text-right font-mono text-[12.5px] leading-[1.6] text-[#6B7385] select-none"
        >
          {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
        </pre>
        <textarea
          id="pasteArea"
          ref={area}
          rows={14}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "$schema": "https://json-schema.org/draft/2020-12/schema", … }'
          className="min-w-0 flex-1 resize-y border-0 bg-code p-3 font-mono text-[12.5px] leading-[1.6] whitespace-pre text-code-ink"
        />
      </div>

      {parsed?.ok && summary && (
        <div
          role="status"
          className={`flex flex-col gap-2.5 rounded-[10px] border px-4 py-3.5 ${summary.problems.length ? "border-[#F4D9AE] bg-warn-bg" : "border-[#BFE3CD] bg-[#EEF8F2]"}`}
        >
          <span className={`font-semibold ${summary.problems.length ? "text-warn" : "text-ok"}`}>
            {summary.problems.length
              ? `Valid ${detected}, but ${summary.problems.length} meta-schema problem${summary.problems.length > 1 ? "s" : ""}: ${summary.problems[0].message} at /${summary.problems[0].path.join("/")}`
              : `✓ Valid ${detected} · valid JSON Schema`}
          </span>
          <div className="flex flex-wrap gap-2">
            {summary.chips.map((c) => (
              <span
                key={c}
                className="rounded-md border border-[#D5E9DC] bg-surface px-2 py-0.5 text-xs text-[#2A3A30]"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {parsed && !parsed.ok && (
        <div
          role="alert"
          className="flex flex-col gap-2.5 rounded-[10px] border border-err-line bg-[#FDF0EE] px-4 py-3.5"
        >
          <span className="font-semibold text-[#9F1F14]">
            {parsed.line ? `Line ${parsed.line} — ` : ""}
            {parsed.message}
          </span>
          <div className="flex flex-wrap gap-2">
            {parsed.trailingComma && (
              <button
                type="button"
                className="btn border-[#E3A79C] font-semibold text-[#9F1F14]"
                onClick={() => setText(text.replace(/,(\s*[}\]])/g, "$1"))}
              >
                Remove trailing comma
              </button>
            )}
            {parsed.line && (
              <button type="button" className="btn" onClick={() => jumpTo(parsed.line as number)}>
                Jump to line
              </button>
            )}
          </div>
        </div>
      )}

      <fieldset className="m-0 flex flex-wrap gap-x-5 gap-y-2 border-0 p-0">
        <legend className="field-label mb-1.5 p-0">Open as</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name="openAs"
            checked={target === "new"}
            onChange={() => setTarget("new")}
            className="size-[18px]"
          />{" "}
          New private schema
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name="openAs"
            checked={target !== "new"}
            disabled={!editable.length}
            onChange={() => setTarget(editable[0].id)}
            className="size-[18px]"
          />{" "}
          Draft of an existing schema
        </label>
        {target !== "new" && (
          <select
            aria-label="Existing schema"
            className="input"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          >
            {editable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        )}
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={keepFormat}
            onChange={(e) => setKeepFormat(e.target.checked)}
            className="size-[18px]"
          />{" "}
          Keep source format ({detected})
        </label>
      </fieldset>
      <ErrorText error={error} />
    </Dialog>
  );
}
