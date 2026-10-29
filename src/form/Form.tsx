import { useMemo, useRef, useState } from "react";
import { generateSample } from "../builder/sample";
import { isObj, type SchemaObject, summary, typeList } from "../builder/tree";
import { type Format, parseText } from "../format";
import type { ActiveSchema } from "../schemas/useActiveSchema";
import type { Problem } from "../validation/ajv";
import { applyEdit, type FormPath } from "./edit";
import { emptyValue, inferType, mergeSchemas, pickBranch, resolve } from "./resolve";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const MAX_DEPTH = 30;

const fieldId = (path: FormPath) => `field:${path.join("/")}`;

export function focusField(path: string[]) {
  for (let p = path; ; p = p.slice(0, -1)) {
    const el = document.getElementById(fieldId(p));
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
      return;
    }
    if (!p.length) return;
  }
}

type Ctx = {
  root: unknown;
  errors: Map<string, string[]>;
  edit: (path: FormPath, value: unknown) => void;
};

export function FormView({
  active,
  problems,
  docText,
  format,
  onChange,
  onShowCode,
}: {
  active: ActiveSchema | null;
  problems?: Problem[];
  docText: string;
  format: Format;
  onChange: (text: string) => void;
  onShowCode: () => void;
}) {
  // Several edits can land before the next render (e.g. blur then click); chain them on the latest text.
  const latest = useRef(docText);
  latest.current = docText;

  const parsed = useMemo(() => {
    if (!docText.trim()) return { value: undefined as unknown };
    try {
      return { value: parseText(docText, format) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [docText, format]);

  const errors = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of problems ?? []) {
      const key = p.path.join("/");
      map.set(key, [...(map.get(key) ?? []), p.message]);
    }
    return map;
  }, [problems]);

  if (!active) {
    return (
      <p className="p-6 text-sm text-zinc-500">
        Pick a schema (⌘K) to fill in the document with a form.
      </p>
    );
  }
  if ("error" in parsed) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-red-600">
          The document isn't valid {format.toUpperCase()}: {parsed.error}
        </p>
        <button type="button" className="btn" onClick={onShowCode}>
          Fix it in Code view
        </button>
      </div>
    );
  }

  const ctx: Ctx = {
    root: active.schema,
    errors,
    edit: (path, value) => {
      latest.current = applyEdit(latest.current, format, path, value);
      onChange(latest.current);
    },
  };
  const rootSchema = resolve(active.schema, active.schema);

  return (
    <div className="h-full overflow-auto">
      <form
        className="mx-auto flex max-w-3xl flex-col gap-4 p-6"
        data-testid="form"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          ctx={ctx}
          schema={active.schema}
          value={parsed.value}
          path={[]}
          name={typeof rootSchema.title === "string" ? rootSchema.title : "Document"}
          required
          depth={0}
        />
      </form>
    </div>
  );
}

type FieldProps = {
  ctx: Ctx;
  schema: unknown;
  value: unknown;
  path: FormPath;
  name: string;
  required: boolean;
  depth: number;
  onRemove?: () => void;
  bare?: boolean;
};

function Field(props: FieldProps) {
  const { ctx, schema, value, path, depth } = props;
  const s = resolve(schema, ctx.root);
  const branches = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : null;
  const control =
    branches && depth < MAX_DEPTH ? (
      <BranchField ctx={ctx} s={s} branches={branches} value={value} path={path} depth={depth} />
    ) : (
      <Control ctx={ctx} s={s} value={value} path={path} depth={depth} />
    );
  if (props.bare) return control;

  const title = typeof s.title === "string" && s.title ? s.title : props.name;
  const group = !branches && ["object", "array"].includes(inferType(s, value) ?? "");
  const errs = ctx.errors.get(path.join("/")) ?? [];
  const Label = group ? "span" : "label";

  return (
    <div
      className={
        group && depth > 0
          ? "flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
          : "flex flex-col gap-1"
      }
    >
      <div className="flex items-center gap-2">
        <Label htmlFor={group ? undefined : fieldId(path)} className="field-label">
          {title}
          {props.required && depth > 0 && (
            <span className="text-red-600" aria-hidden="true">
              {" "}
              *
            </span>
          )}
        </Label>
        {title !== props.name && props.name && (
          <code className="text-xs text-zinc-400">{props.name}</code>
        )}
        {props.onRemove && (
          <button
            type="button"
            aria-label={`Remove ${props.name}`}
            onClick={props.onRemove}
            className="ml-auto h-6 w-6 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        )}
      </div>
      {typeof s.description === "string" && (
        <p className="line-clamp-3 text-xs whitespace-pre-line text-zinc-500" title={s.description}>
          {s.description}
        </p>
      )}
      {control}
      {errs.map((e) => (
        <p key={e} className="text-xs text-red-600 dark:text-red-400">
          {e}
        </p>
      ))}
    </div>
  );
}

type ControlProps = { ctx: Ctx; s: SchemaObject; value: unknown; path: FormPath; depth: number };

function Control({ ctx, s, value, path, depth }: ControlProps) {
  const id = fieldId(path);
  const set = (v: unknown) => ctx.edit(path, v);

  if ("const" in s) {
    return (
      <div id={id} tabIndex={-1} className="flex items-center gap-2">
        <code className="rounded bg-zinc-100 px-2 py-1 text-sm dark:bg-zinc-800">
          {JSON.stringify(s.const)}
        </code>
        {JSON.stringify(value) !== JSON.stringify(s.const) && (
          <button type="button" className="btn" onClick={() => set(s.const)}>
            Set
          </button>
        )}
      </div>
    );
  }

  if (Array.isArray(s.enum)) {
    const options = s.enum;
    const index = options.findIndex((o) => JSON.stringify(o) === JSON.stringify(value));
    return (
      <select
        id={id}
        value={index < 0 ? "" : index}
        onChange={(e) => set(e.target.value === "" ? undefined : options[Number(e.target.value)])}
        className={inputClass}
      >
        <option value="">—</option>
        {options.map((o, i) => (
          <option key={JSON.stringify(o)} value={i}>
            {typeof o === "string" ? o : JSON.stringify(o)}
          </option>
        ))}
      </select>
    );
  }

  const types = typeList(s);
  const type = depth < MAX_DEPTH ? inferType(s, value) : undefined;
  let input: React.ReactNode;
  switch (type) {
    case "object":
      input = <ObjectFields ctx={ctx} s={s} value={value} path={path} depth={depth} />;
      break;
    case "array":
      input = <ArrayItems ctx={ctx} s={s} value={value} path={path} depth={depth} />;
      break;
    case "string":
      input = (
        <DraftInput
          id={id}
          value={value}
          format={typeof s.format === "string" ? s.format : undefined}
          onCommit={set}
        />
      );
      break;
    case "number":
    case "integer":
      input = <DraftInput id={id} value={value} numeric onCommit={set} />;
      break;
    case "boolean":
      input = (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => set(e.target.checked)}
          className="h-4 w-4"
        />
      );
      break;
    case "null":
      input = (
        <code id={id} tabIndex={-1} className="text-sm text-zinc-500">
          null
        </code>
      );
      break;
    default:
      input = <JsonInput id={id} value={value} onCommit={set} />;
  }

  if (types.length < 2) return input;
  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Value type"
        value={type}
        onChange={(e) => set(emptyValue({ ...s, type: e.target.value }, ctx.root))}
        className={`${inputClass} w-fit`}
      >
        {types.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      {input}
    </div>
  );
}

function BranchField({
  ctx,
  s,
  branches,
  value,
  path,
  depth,
}: ControlProps & { branches: unknown[] }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const index = chosen ?? pickBranch(branches, value, ctx.root);
  const { oneOf, anyOf, ...rest } = s;
  const variant = (i: number) => mergeSchemas(rest, resolve(branches[i], ctx.root));
  const label = (b: unknown, i: number) => {
    const r = resolve(b, ctx.root);
    if (typeof r.title === "string" && r.title) return r.title;
    if (isObj(b) && typeof b.$ref === "string") return b.$ref.split("/").pop();
    return `${summary(r)} (option ${i + 1})`;
  };

  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Variant"
        value={index}
        onChange={(e) => {
          const i = Number(e.target.value);
          setChosen(i);
          ctx.edit(path, generateSample(variant(i), ctx.root));
        }}
        className={`${inputClass} w-fit`}
      >
        {branches.map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: branches are positional
          <option key={i} value={i}>
            {label(b, i)}
          </option>
        ))}
      </select>
      <Field
        ctx={ctx}
        schema={variant(index)}
        value={value}
        path={path}
        name=""
        required={false}
        depth={depth + 1}
        bare
      />
    </div>
  );
}

function ObjectFields({ ctx, s, value, path, depth }: ControlProps) {
  const [newKey, setNewKey] = useState("");
  const obj = isObj(value) ? value : {};
  const props = isObj(s.properties) ? s.properties : {};
  const required = Array.isArray(s.required) ? s.required.filter((k) => typeof k === "string") : [];
  const declared = Object.keys(props);
  const shown = declared.filter((k) => required.includes(k) || k in obj);
  const missing = declared.filter((k) => !shown.includes(k));
  const extras = Object.keys(obj).filter((k) => !(k in props));
  const canAddKeys =
    isObj(s.patternProperties) ||
    isObj(s.additionalProperties) ||
    (s.additionalProperties === undefined && !declared.length);

  const extraSchema = (key: string): unknown => {
    if (isObj(s.patternProperties)) {
      for (const [pattern, schema] of Object.entries(s.patternProperties)) {
        try {
          if (new RegExp(pattern, "u").test(key)) return schema;
        } catch {}
      }
    }
    return isObj(s.additionalProperties) ? s.additionalProperties : {};
  };
  const remove = (k: string) => () => ctx.edit([...path, k], undefined);

  return (
    <div id={fieldId(path)} tabIndex={-1} className="flex flex-col gap-3 outline-none">
      {shown.map((k) => (
        <Field
          key={k}
          ctx={ctx}
          schema={props[k]}
          value={obj[k]}
          path={[...path, k]}
          name={k}
          required={required.includes(k)}
          depth={depth + 1}
          onRemove={required.includes(k) ? undefined : remove(k)}
        />
      ))}
      {extras.map((k) => (
        <Field
          key={k}
          ctx={ctx}
          schema={extraSchema(k)}
          value={obj[k]}
          path={[...path, k]}
          name={k}
          required={false}
          depth={depth + 1}
          onRemove={remove(k)}
        />
      ))}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500">Optional:</span>
          {missing.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => ctx.edit([...path, k], emptyValue(props[k], ctx.root))}
              className="rounded-full border border-dashed border-zinc-400 px-2.5 py-0.5 font-mono text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              + {k}
            </button>
          ))}
        </div>
      )}
      {canAddKeys && (
        <div className="flex gap-2">
          <input
            aria-label="New key"
            placeholder="new key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className={`${inputClass} max-w-60 font-mono`}
          />
          <button
            type="button"
            className="btn"
            disabled={!newKey || newKey in obj}
            onClick={() => {
              ctx.edit([...path, newKey], emptyValue(extraSchema(newKey), ctx.root));
              setNewKey("");
            }}
          >
            + Key
          </button>
        </div>
      )}
    </div>
  );
}

function ArrayItems({ ctx, s, value, path, depth }: ControlProps) {
  const items = Array.isArray(value) ? value : [];
  const itemSchema = (i: number): unknown => {
    if (Array.isArray(s.prefixItems) && i < s.prefixItems.length) return s.prefixItems[i];
    if (Array.isArray(s.items)) return s.items[i] ?? {};
    return isObj(s.items) ? s.items : {};
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    ctx.edit(path, next);
  };

  return (
    <div id={fieldId(path)} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are positional
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Field
              ctx={ctx}
              schema={itemSchema(i)}
              value={item}
              path={[...path, i]}
              name={`#${i + 1}`}
              required={false}
              depth={depth + 1}
            />
          </div>
          <div className="flex gap-1 pt-5">
            <button
              type="button"
              className="btn"
              aria-label={`Move item ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`Move item ${i + 1} down`}
              disabled={i === items.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`Remove item ${i + 1}`}
              onClick={() => ctx.edit([...path, i], undefined)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn w-fit"
        onClick={() =>
          ctx.edit([...path, items.length], emptyValue(itemSchema(items.length), ctx.root))
        }
      >
        + Add item
      </button>
    </div>
  );
}

// Commits on blur/Enter so a half-typed number like "1." isn't rewritten mid-edit.
function DraftInput({
  id,
  value,
  numeric,
  format,
  onCommit,
}: {
  id: string;
  value: unknown;
  numeric?: boolean;
  format?: string;
  onCommit: (value: unknown) => void;
}) {
  const text = value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(text);
  const [synced, setSynced] = useState(text);
  if (text !== synced) {
    setSynced(text);
    setDraft(text);
  }
  const commit = () => {
    if (draft === text) return;
    if (!numeric) return onCommit(draft);
    if (!draft.trim()) return onCommit(undefined);
    const n = Number(draft);
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(text);
  };
  return (
    <input
      id={id}
      type={format === "date" ? "date" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      placeholder={format}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className={`${inputClass} ${numeric ? "font-mono" : ""}`}
    />
  );
}

function JsonInput({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: unknown;
  onCommit: (value: unknown) => void;
}) {
  const text = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(text);
  const [synced, setSynced] = useState(text);
  const [error, setError] = useState(false);
  if (text !== synced) {
    setSynced(text);
    setDraft(text);
  }
  return (
    <textarea
      id={id}
      rows={Math.min(8, Math.max(2, draft.split("\n").length))}
      value={draft}
      placeholder="Any JSON value"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === text) return;
        if (!draft.trim()) return onCommit(undefined);
        try {
          onCommit(JSON.parse(draft));
          setError(false);
        } catch {
          setError(true);
        }
      }}
      className={`${inputClass} font-mono ${error ? "border-red-500" : ""}`}
    />
  );
}
