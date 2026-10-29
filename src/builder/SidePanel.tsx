import { useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { useStore } from "../store";
import { type Problem, validateDocument, validateSchema } from "../validation/ajv";
import { generateSample } from "./sample";
import { children, getAt, isObj, NAMED_GROUPS, type Path, typeList } from "./tree";

type Tab = "json" | "test" | "problems";

const SUBSCHEMA_LISTS = ["allOf", "anyOf", "oneOf", "prefixItems", "items"];
const SUBSCHEMA_SLOTS = ["additionalProperties", "items", "not", "if", "then", "else"];
export type Finding = Problem & { severity: "error" | "hint" };

export function hints(root: unknown): Finding[] {
  const out: Finding[] = [];
  const walk = (schema: unknown, path: Path) => {
    for (const c of children(schema)) {
      const p = [...path, ...c.rel];
      if (c.kind === "property" && isObj(c.schema)) {
        if (!c.schema.description && !c.schema.$ref) {
          out.push({ severity: "hint", path: p, message: "Missing description." });
        }
        if (
          /(url|uri|link|href)$/i.test(c.label) &&
          typeList(c.schema).includes("string") &&
          !c.schema.format
        ) {
          out.push({
            severity: "hint",
            path: p,
            message: 'Looks like a link but has no format. Consider "uri".',
          });
        }
      }
      walk(c.schema, p);
    }
  };
  walk(root, []);
  return out;
}

// Meta-schema errors point at keywords (e.g. .../minLength); select the schema node that owns them.
export function owningNode(root: unknown, path: Path): Path {
  for (let p = path; p.length; p = p.slice(0, -1)) {
    const v = getAt(root, p);
    if (!isObj(v) && typeof v !== "boolean") continue;
    const parentKey = p[p.length - 2];
    if (
      NAMED_GROUPS.includes(parentKey) ||
      SUBSCHEMA_LISTS.includes(parentKey) ||
      SUBSCHEMA_SLOTS.includes(p[p.length - 1])
    ) {
      return p;
    }
  }
  return [];
}

export function SidePanel({
  root,
  selected,
  onSelect,
}: {
  root: unknown;
  selected: Path;
  onSelect: (p: Path) => void;
}) {
  const [tab, setTab] = useState<Tab>("json");
  const findings = useMemo<Finding[]>(
    () => [
      ...validateSchema(root).map((p) => ({ ...p, severity: "error" as const })),
      ...hints(root),
    ],
    [root],
  );
  const errors = findings.filter((f) => f.severity === "error").length;
  const tabs: [Tab, string][] = [
    ["json", "Node JSON"],
    ["test", "Test instance"],
    ["problems", `Problems · ${errors ? `${errors} errors` : findings.length}`],
  ];

  return (
    <aside
      aria-label="Source and validation"
      className="flex min-h-0 flex-col border-zinc-200 bg-zinc-50 md:w-[26rem] md:border-l dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div
        role="tablist"
        className="flex gap-1 border-b border-zinc-200 px-2 pt-2 dark:border-zinc-800"
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-t-md px-3 py-2 text-sm ${tab === id ? "bg-white font-semibold shadow-[inset_0_-2px_0] shadow-blue-600 dark:bg-zinc-950" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"} ${id === "problems" && errors ? "text-red-600" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "json" && <NodeJson node={getAt(root, selected)} />}
        {tab === "test" && <TestInstance root={root} />}
        {tab === "problems" && <Findings findings={findings} root={root} onSelect={onSelect} />}
      </div>
    </aside>
  );
}

function NodeJson({ node }: { node: unknown }) {
  const setSchemaView = useStore((s) => s.setSchemaView);
  const text = JSON.stringify(node, null, 2);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(text)}>
          Copy
        </button>
        <button type="button" className="btn" onClick={() => setSchemaView("source")}>
          Open full source
        </button>
      </div>
      <pre
        data-testid="node-json"
        className="overflow-auto rounded-md whitespace-pre-wrap break-all border border-zinc-200 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-950"
      >
        {text}
      </pre>
    </div>
  );
}

function TestInstance({ root }: { root: unknown }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ problems?: Problem[]; error?: string }>({});

  useEffect(() => {
    if (!text.trim() || !isObj(root)) return setResult({});
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const problems = await validateDocument(root, parse(text));
        if (!stale) setResult({ problems });
      } catch (e) {
        if (!stale) setResult({ error: (e as Error).message });
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [root, text]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="test-instance" className="field-label">
        Instance (JSON or YAML) to validate against this schema
      </label>
      <textarea
        id="test-instance"
        rows={14}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="rounded-md border border-zinc-300 bg-white p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button
        type="button"
        className="btn"
        onClick={() => setText(`${JSON.stringify(generateSample(root), null, 2)}\n`)}
      >
        Generate sample from schema
      </button>
      {result.error && <p className="text-sm text-red-600">{result.error}</p>}
      {result.problems && !result.problems.length && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          ✓ Instance is valid
        </p>
      )}
      {!!result.problems?.length && (
        <ul className="flex flex-col gap-1 text-sm" data-testid="instance-problems">
          {result.problems.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: problems have no stable identity
            <li key={i}>
              <code className="text-xs text-zinc-500">/{p.path.join("/")}</code>{" "}
              <span className="text-red-600 dark:text-red-400">{p.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Findings({
  findings,
  root,
  onSelect,
}: {
  findings: Finding[];
  root: unknown;
  onSelect: (p: Path) => void;
}) {
  if (!findings.length) return <p className="text-sm text-emerald-600">No problems.</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="schema-problems">
      {findings.slice(0, 300).map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: findings have no stable identity
        <li key={i}>
          <button
            type="button"
            onClick={() => onSelect(owningNode(root, f.path))}
            className={`flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-sm ${f.severity === "error" ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40" : "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"}`}
          >
            <span
              className={`text-xs font-bold ${f.severity === "error" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}
            >
              {f.severity === "error" ? "Error" : "Hint"}
            </span>
            <code className="text-xs break-all">#/{f.path.join("/")}</code>
            <span>{f.message}</span>
          </button>
        </li>
      ))}
      {findings.length > 300 && (
        <li className="text-xs text-zinc-500">…and {findings.length - 300} more.</li>
      )}
    </ul>
  );
}
