import { useState } from "react";
import { pointerToPath } from "../validation/location";
import { JsonField, NumberField, Section, TextField, Toggle, TypeBadge } from "./fields";
import {
  addDefinition,
  addPatternProperty,
  addProperty,
  appendSubschema,
  canMove,
  moveNode,
  removeNode,
  renameNode,
  replaceNode,
  setKeys,
  setRequired,
  setSlot,
  setType,
} from "./ops";
import {
  COMBINATORS,
  getAt,
  isObj,
  NAMED_GROUPS,
  type Path,
  type SchemaObject,
  summary,
  typeList,
} from "./tree";

type Change = (root: unknown, select?: Path) => void;
type Props = { root: unknown; path: Path; onChange: Change; onSelect: (path: Path) => void };

const TYPES = ["object", "string", "number", "integer", "boolean", "array", "null"];
const FORMATS = [
  "date-time",
  "date",
  "time",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "uri",
  "uri-reference",
  "uri-template",
  "uuid",
  "regex",
  "json-pointer",
];
const DRAFTS = [
  "https://json-schema.org/draft/2020-12/schema",
  "https://json-schema.org/draft/2019-09/schema",
  "http://json-schema.org/draft-07/schema#",
  "http://json-schema.org/draft-06/schema#",
  "http://json-schema.org/draft-04/schema#",
];
const HANDLED = new Set([
  "$schema",
  "$id",
  "$ref",
  "type",
  "title",
  "description",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "minProperties",
  "maxProperties",
  "enum",
  "const",
  "default",
  "examples",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "$defs",
  "definitions",
]);

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function Inspector({ root, path, onChange, onSelect }: Props) {
  const node = getAt(root, path);
  const set = (patch: Record<string, unknown>) => onChange(setKeys(root, path, patch));
  const go = (r: { root: unknown; path: Path }) => onChange(r.root, r.path);
  const ctx = { root, path, onChange, onSelect };

  if (typeof node === "boolean") {
    return (
      <Shell {...ctx}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Boolean schema: {node ? "accepts any value" : "rejects every value"}.
        </p>
        <button
          type="button"
          className="btn w-fit"
          onClick={() => onChange(replaceNode(root, path, {}))}
        >
          Convert to an object schema
        </button>
      </Shell>
    );
  }
  if (!isObj(node)) {
    return (
      <Shell {...ctx}>
        <p className="text-sm text-red-600">This value isn't a schema.</p>
      </Shell>
    );
  }

  const s = node;
  const types = typeList(s);
  const has = (t: string) => types.includes(t);
  const isObject = has("object") || (!types.length && isObj(s.properties));
  const isArray =
    has("array") || (!types.length && (isObj(s.items) || Array.isArray(s.prefixItems)));
  const other = Object.fromEntries(Object.entries(s).filter(([k]) => !HANDLED.has(k)));
  const defs = localDefinitions(root);
  const refTarget = str(s.$ref).startsWith("#") ? pointerToPath(str(s.$ref).slice(1)) : null;

  return (
    <Shell {...ctx}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="field-label mb-1.5">Type</legend>
        <div className="flex w-fit flex-wrap overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {["any", ...TYPES].map((t) => {
            const on = t === "any" ? !types.length : has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={(e) => {
                  const multi = e.metaKey || e.ctrlKey || e.shiftKey;
                  const next =
                    t === "any"
                      ? []
                      : multi
                        ? on
                          ? types.filter((x) => x !== t)
                          : [...types, t]
                        : [t];
                  onChange(setType(root, path, next));
                }}
                className={`border-zinc-300 px-3 py-1.5 text-sm not-first:border-l dark:border-zinc-700 ${on ? "bg-zinc-900 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                {t}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-zinc-500">⌘/Ctrl/Shift-click to allow several types.</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Title"
          value={str(s.title)}
          onCommit={(v) => set({ title: v || undefined })}
        />
        {!path.length && (
          <TextField
            label="$id"
            value={str(s.$id)}
            mono
            onCommit={(v) => set({ $id: v || undefined })}
          />
        )}
        {!path.length && (
          <TextField
            label="$schema (dialect)"
            value={str(s.$schema)}
            list={DRAFTS}
            mono
            onCommit={(v) => set({ $schema: v || undefined })}
          />
        )}
      </div>
      <TextField
        label="Description"
        value={str(s.description)}
        multiline
        onCommit={(v) => set({ description: v || undefined })}
      />

      <Section title="Reference">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField
              label="$ref"
              value={str(s.$ref)}
              list={defs}
              mono
              placeholder="#/$defs/Name or a URL"
              onCommit={(v) => set({ $ref: v.trim() || undefined })}
            />
          </div>
          {refTarget && getAt(root, refTarget) !== undefined && (
            <button type="button" className="btn" onClick={() => onSelect(refTarget)}>
              Go to definition
            </button>
          )}
        </div>
      </Section>

      {has("string") && (
        <Section title="String">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Format"
              value={str(s.format)}
              list={FORMATS}
              onCommit={(v) => set({ format: v || undefined })}
            />
            <TextField
              label="Pattern (regex)"
              value={str(s.pattern)}
              mono
              placeholder="^[a-z]+$"
              onCommit={(v) => set({ pattern: v || undefined })}
            />
            <NumberField
              label="minLength"
              value={s.minLength}
              onCommit={(v) => set({ minLength: v })}
            />
            <NumberField
              label="maxLength"
              value={s.maxLength}
              onCommit={(v) => set({ maxLength: v })}
            />
          </div>
        </Section>
      )}

      {(has("number") || has("integer")) && (
        <Section title="Number">
          <div className="grid gap-3 sm:grid-cols-3">
            {["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"].map(
              (k) => (
                <NumberField key={k} label={k} value={s[k]} onCommit={(v) => set({ [k]: v })} />
              ),
            )}
          </div>
        </Section>
      )}

      {isArray && (
        <Section title="Array">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              label="minItems"
              value={s.minItems}
              onCommit={(v) => set({ minItems: v })}
            />
            <NumberField
              label="maxItems"
              value={s.maxItems}
              onCommit={(v) => set({ maxItems: v })}
            />
            <div className="flex items-end">
              <Toggle
                label="Unique items"
                on={s.uniqueItems === true}
                onChange={(on) => set({ uniqueItems: on || undefined })}
              />
            </div>
          </div>
          {!Array.isArray(s.items) && (
            <Slot {...ctx} keyword="items" initial={{ type: "string" }} />
          )}
          <SubschemaList {...ctx} keyword="prefixItems" addLabel="+ Tuple item" />
        </Section>
      )}

      {isObject && (
        <Section title="Object">
          <PropertiesTable {...ctx} schema={s} />
          <button type="button" className="btn w-fit" onClick={() => go(addProperty(root, path))}>
            + Property
          </button>
          <div className="grid gap-3 sm:grid-cols-3">
            <AdditionalProperties {...ctx} value={s.additionalProperties} />
            <NumberField
              label="minProperties"
              value={s.minProperties}
              onCommit={(v) => set({ minProperties: v })}
            />
            <NumberField
              label="maxProperties"
              value={s.maxProperties}
              onCommit={(v) => set({ maxProperties: v })}
            />
          </div>
          <NamedList
            {...ctx}
            group="patternProperties"
            title="Pattern properties"
            addLabel="+ Pattern"
            onAdd={() => go(addPatternProperty(root, path))}
          />
        </Section>
      )}

      <Section title="Values">
        <EnumEditor
          values={Array.isArray(s.enum) ? s.enum : []}
          stringOnly={types.length === 1 && has("string")}
          onChange={(v) => set({ enum: v.length ? v : undefined })}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <JsonField label="const" value={s.const} onCommit={(v) => set({ const: v })} />
          <JsonField label="default" value={s.default} onCommit={(v) => set({ default: v })} />
          <JsonField
            label="examples"
            value={s.examples}
            placeholder='["example"]'
            validate={(v) => (Array.isArray(v) ? undefined : "examples must be an array")}
            onCommit={(v) => set({ examples: v })}
          />
        </div>
      </Section>

      <Section title="Composition">
        {COMBINATORS.map((c) => (
          <SubschemaList key={c} {...ctx} keyword={c} addLabel="+ Branch" />
        ))}
        <Slot {...ctx} keyword="not" />
      </Section>

      <Section title="Conditional">
        {["if", "then", "else"].map((k) => (
          <Slot key={k} {...ctx} keyword={k} />
        ))}
      </Section>

      {(!path.length || isObj(s.$defs) || isObj(s.definitions)) && (
        <Section title="Definitions">
          {["$defs", "definitions"].map((g) => (
            <NamedList key={g} {...ctx} group={g} title={g} />
          ))}
          <button type="button" className="btn w-fit" onClick={() => go(addDefinition(root, path))}>
            + Definition
          </button>
        </Section>
      )}

      <Section title="Other keywords">
        <JsonField
          label="Keywords without a form field (kept as-is)"
          value={Object.keys(other).length ? other : undefined}
          placeholder='{ "unevaluatedProperties": false }'
          validate={(v) => (isObj(v) ? undefined : "Must be a JSON object")}
          onCommit={(v) => {
            const patch: Record<string, unknown> = Object.fromEntries(
              Object.keys(other).map((k) => [k, undefined]),
            );
            set(Object.assign(patch, v ?? {}));
          }}
        />
      </Section>
    </Shell>
  );
}

function localDefinitions(root: unknown): string[] {
  if (!isObj(root)) return [];
  return ["$defs", "definitions"].flatMap((g) =>
    isObj(root[g])
      ? Object.keys(root[g]).map(
          (name) => `#/${g}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`,
        )
      : [],
  );
}

type Ctx = { root: unknown; path: Path; onChange: Change; onSelect: (path: Path) => void };

function Shell({ root, path, onChange, children }: Ctx & { children: React.ReactNode }) {
  const [renameError, setRenameError] = useState<string>();
  const group = path[path.length - 2];
  const name = path[path.length - 1] ?? "";
  const named = path.length >= 2 && NAMED_GROUPS.includes(group);
  const isProperty = group === "properties";
  const parent = getAt(root, path.slice(0, -2));
  const required =
    isProperty && isObj(parent) && Array.isArray(parent.required) && parent.required.includes(name);
  const nameLabel =
    group === "properties"
      ? "Property name"
      : group === "patternProperties"
        ? "Pattern"
        : "Definition name";

  return (
    <div className="flex flex-col gap-5 p-6" data-testid="inspector">
      <nav aria-label="Breadcrumb" className="font-mono text-xs break-all text-zinc-500">
        #/{path.join("/")}
      </nav>
      <div className="flex flex-wrap items-end gap-2">
        {named ? (
          <div className="min-w-48 flex-1">
            <TextField
              label={nameLabel}
              value={name}
              mono
              error={renameError}
              onCommit={(v) => {
                const r = renameNode(root, path, v.trim());
                if (typeof r === "string") return setRenameError(r);
                setRenameError(undefined);
                onChange(r.root, r.path);
              }}
            />
          </div>
        ) : (
          <h2 className="flex-1 font-mono text-lg font-semibold">
            {path.length ? name : "Root schema"}
          </h2>
        )}
        {isProperty && (
          <Toggle
            label="Required"
            on={required}
            onChange={(on) => onChange(setRequired(root, path, on))}
          />
        )}
        {canMove(path) && (
          <>
            <button
              type="button"
              className="btn"
              aria-label="Move up"
              onClick={() => {
                const r = moveNode(root, path, -1);
                onChange(r.root, r.path);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Move down"
              onClick={() => {
                const r = moveNode(root, path, 1);
                onChange(r.root, r.path);
              }}
            >
              ↓
            </button>
          </>
        )}
        {path.length > 0 && (
          <button
            type="button"
            className="btn text-red-600 dark:text-red-400"
            onClick={() => onChange(removeNode(root, path))}
          >
            Delete
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function PropertiesTable({
  root,
  path,
  onChange,
  onSelect,
  schema,
}: Ctx & { schema: SchemaObject }) {
  const props = isObj(schema.properties) ? Object.entries(schema.properties) : [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!props.length) return <p className="text-sm text-zinc-500">No properties yet.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Required</th>
          </tr>
        </thead>
        <tbody>
          {props.map(([k, v]) => (
            <tr key={k} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  className="font-mono hover:underline"
                  onClick={() => onSelect([...path, "properties", k])}
                >
                  {k}
                </button>
              </td>
              <td className="px-3 py-1.5">
                <TypeBadge label={summary(v)} />
              </td>
              <td className="px-3 py-1.5">
                <input
                  type="checkbox"
                  aria-label={`${k} is required`}
                  checked={required.includes(k)}
                  onChange={(e) =>
                    onChange(setRequired(root, [...path, "properties", k], e.target.checked))
                  }
                  className="h-4 w-4"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdditionalProperties({ root, path, onChange, onSelect, value }: Ctx & { value: unknown }) {
  const mode = value === false ? "forbid" : isObj(value) ? "schema" : "allow";
  return (
    <div className="flex flex-col gap-1">
      <label className="field-label" htmlFor="additionalProperties">
        Additional properties
      </label>
      <div className="flex gap-2">
        <select
          id="additionalProperties"
          value={mode}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "allow") onChange(setKeys(root, path, { additionalProperties: undefined }));
            if (v === "forbid") onChange(setKeys(root, path, { additionalProperties: false }));
            if (v === "schema") {
              const r = setSlot(root, path, "additionalProperties", { type: "string" });
              onChange(r.root, r.path);
            }
          }}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="allow">Allowed</option>
          <option value="forbid">Forbidden</option>
          <option value="schema">Must match a schema</option>
        </select>
        {mode === "schema" && (
          <button
            type="button"
            className="btn"
            onClick={() => onSelect([...path, "additionalProperties"])}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

function NamedList({
  root,
  path,
  onSelect,
  group,
  title,
  addLabel,
  onAdd,
}: Ctx & { group: string; title: string; addLabel?: string; onAdd?: () => void }) {
  const map = getAt(root, [...path, group]);
  const entries = isObj(map) ? Object.entries(map) : [];
  if (!entries.length && !onAdd) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{title}</span>
        {onAdd && (
          <button type="button" className="btn" onClick={onAdd}>
            {addLabel}
          </button>
        )}
      </div>
      {entries.map(([name, v]) => (
        <button
          key={name}
          type="button"
          onClick={() => onSelect([...path, group, name])}
          className="flex items-center gap-2 rounded px-3 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <span className="truncate font-mono text-sm">{name}</span>
          <span className="ml-auto" />
          <TypeBadge label={summary(v)} />
        </button>
      ))}
    </div>
  );
}

function SubschemaList({
  root,
  path,
  onChange,
  onSelect,
  keyword,
  addLabel,
}: Ctx & { keyword: string; addLabel: string }) {
  const list = getAt(root, [...path, keyword]);
  const items = Array.isArray(list) ? list : [];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{keyword}</span>
        <button
          type="button"
          className="btn"
          aria-label={`Add to ${keyword}`}
          onClick={() => {
            const r = appendSubschema(root, path, keyword);
            onChange(r.root, r.path);
          }}
        >
          {addLabel}
        </button>
      </div>
      {items.map((item, i) => {
        const itemPath = [...path, keyword, String(i)];
        return (
          <div key={itemPath.join("/")} className="flex items-center gap-1 pl-3">
            <button
              type="button"
              onClick={() => onSelect(itemPath)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="font-mono text-sm">[{i}]</span>
              <TypeBadge label={summary(item)} />
              {isObj(item) && typeof item.title === "string" && (
                <span className="truncate text-xs text-zinc-500">{item.title}</span>
              )}
            </button>
            <button
              type="button"
              aria-label={`Remove ${keyword}[${i}]`}
              onClick={() => onChange(removeNode(root, itemPath))}
              className="h-7 w-7 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Slot({
  root,
  path,
  onChange,
  onSelect,
  keyword,
  initial = {},
}: Ctx & { keyword: string; initial?: object }) {
  const value = getAt(root, [...path, keyword]);
  const present = isObj(value) || typeof value === "boolean";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 font-mono text-sm">{keyword}</span>
      {present ? (
        <>
          <button
            type="button"
            className="btn inline-flex items-center gap-2"
            onClick={() => onSelect([...path, keyword])}
          >
            Edit <TypeBadge label={summary(value)} />
          </button>
          <button
            type="button"
            className="btn"
            aria-label={`Remove ${keyword}`}
            onClick={() => onChange(setKeys(root, path, { [keyword]: undefined }))}
          >
            Remove
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn"
          aria-label={`Add ${keyword}`}
          onClick={() => {
            const r = setSlot(root, path, keyword, initial);
            onChange(r.root, r.path);
          }}
        >
          + Add
        </button>
      )}
    </div>
  );
}

function EnumEditor({
  values,
  stringOnly,
  onChange,
}: {
  values: unknown[];
  stringOnly: boolean;
  onChange: (values: unknown[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    let value: unknown = raw;
    if (!stringOnly) {
      try {
        value = JSON.parse(raw);
      } catch {}
    }
    onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="field-label">Allowed values (enum)</span>
      <div className="flex flex-wrap items-center gap-2">
        {values.map((v, i) => {
          const label = typeof v === "string" ? v : JSON.stringify(v);
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: enum values may repeat
              key={`${i}:${label}`}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 py-1 pr-1 pl-2.5 font-mono text-sm dark:bg-zinc-800"
            >
              {label}
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="h-6 w-6 rounded text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          aria-label="Add allowed value"
          placeholder="Add value, press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="w-52 rounded-md border border-dashed border-zinc-400 bg-transparent px-2.5 py-1 font-mono text-sm dark:border-zinc-600"
        />
      </div>
    </div>
  );
}
