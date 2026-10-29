import { type ReactNode, useId, useState } from "react";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

type FieldProps = {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  list?: string[];
  error?: string;
};

// Commits on blur/Enter rather than per keystroke, so every edit is one undo step.
export function TextField({
  label,
  value,
  onCommit,
  placeholder,
  mono,
  multiline,
  list,
  error,
}: FieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  const commit = () => draft !== value && onCommit(draft);
  const props = {
    id,
    value: draft,
    placeholder,
    list: list ? `${id}-list` : undefined,
    className: `${inputClass} ${mono ? "font-mono" : ""}`,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !multiline) {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") setDraft(value);
    },
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      {list && (
        <datalist id={`${id}-list`}>
          {list.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: unknown;
  onCommit: (value: number | undefined) => void;
}) {
  const [error, setError] = useState<string>();
  return (
    <TextField
      label={label}
      value={value === undefined ? "" : String(value)}
      mono
      error={error}
      onCommit={(v) => {
        if (!v.trim()) return onCommit(undefined);
        const n = Number(v);
        if (!Number.isFinite(n)) return setError("Not a number");
        setError(undefined);
        onCommit(n);
      }}
    />
  );
}

export function JsonField({
  label,
  value,
  onCommit,
  placeholder,
  validate,
}: {
  label: string;
  value: unknown;
  onCommit: (value: unknown) => void;
  placeholder?: string;
  validate?: (value: unknown) => string | undefined;
}) {
  const [error, setError] = useState<string>();
  return (
    <TextField
      label={label}
      value={value === undefined ? "" : JSON.stringify(value, null, 2)}
      multiline
      mono
      placeholder={placeholder}
      error={error}
      onCommit={(v) => {
        if (!v.trim()) return onCommit(undefined);
        try {
          const parsed = JSON.parse(v);
          const invalid = validate?.(parsed);
          setError(invalid);
          if (!invalid) onCommit(parsed);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    />
  );
}

export function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className="btn inline-flex items-center gap-2"
    >
      <span
        aria-hidden="true"
        className={`relative h-4 w-7 rounded-full transition-colors ${on ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`}
        />
      </span>
      {label}
    </button>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

const TYPE_COLORS: Record<string, string> = {
  object: "text-violet-700 dark:text-violet-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-orange-700 dark:text-orange-300",
  integer: "text-orange-700 dark:text-orange-300",
  boolean: "text-blue-700 dark:text-blue-300",
  array: "text-fuchsia-700 dark:text-fuchsia-300",
};

export function TypeBadge({ label }: { label: string }) {
  const color = TYPE_COLORS[label.split(" ")[0]] ?? "text-zinc-600 dark:text-zinc-400";
  return (
    <span
      className={`shrink-0 rounded bg-zinc-100 px-1.5 py-px font-sans text-[11px] font-semibold dark:bg-zinc-800 ${color}`}
    >
      {label}
    </span>
  );
}
