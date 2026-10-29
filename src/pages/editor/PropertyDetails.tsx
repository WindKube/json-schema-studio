import { children, getAt, isObj, type Path, summary, typeList } from "../../builder/tree";

const FACTS = [
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "const",
  "default",
  "$ref",
  "additionalProperties",
];

export const TYPE_COLORS: Record<string, string> = {
  object: "#5B3FD0",
  string: "#11603A",
  number: "#9A3412",
  integer: "#9A3412",
  boolean: "#1D4ED8",
  array: "#86198F",
  null: "#5B6270",
};

export function isRequired(root: unknown, path: Path): boolean {
  if (path.length < 2 || path[path.length - 2] !== "properties") return false;
  const owner = getAt(root, path.slice(0, -2));
  return (
    isObj(owner) && Array.isArray(owner.required) && owner.required.includes(path[path.length - 1])
  );
}

export function PropertyDetails({
  root,
  path,
  onSelect,
}: {
  root: unknown;
  path: Path;
  onSelect: (p: Path) => void;
}) {
  const node = getAt(root, path);
  const s = isObj(node) ? node : {};
  const type = summary(node);
  const req = isRequired(root, path);
  const name = path.length
    ? path[path.length - 1]
    : typeof s.title === "string"
      ? s.title
      : "(root)";
  const facts = FACTS.filter(
    (k) => k in s && (typeof s[k] !== "object" || s[k] === null || k === "additionalProperties"),
  );
  const kids = children(node).filter((c) => c.kind === "property");

  return (
    <>
      <section aria-label="Property details" className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 font-mono text-xl font-semibold">{name}</h2>
          <span
            className="rounded-md bg-[#F1F3F6] px-2 py-0.5 text-xs font-semibold"
            style={{ color: TYPE_COLORS[typeList(node)[0]] ?? "#3D4350" }}
          >
            {type}
          </span>
          {path.length > 0 && (
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${req ? "bg-err-bg text-err" : "bg-chip text-ink-2"}`}
            >
              {req ? "Required" : "Optional"}
            </span>
          )}
        </div>
        <p className="m-0 text-ink-2">
          {typeof s.description === "string" ? s.description : "No description."}
        </p>
        {!!facts.length && (
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            {facts.map((k) => (
              <div key={k} className="flex flex-col gap-0.5 rounded-lg bg-page px-3 py-2.5">
                <dt className="text-xs font-semibold text-muted">{k}</dt>
                <dd className="m-0 font-mono text-[13px] break-all">{JSON.stringify(s[k])}</dd>
              </div>
            ))}
          </dl>
        )}
        {Array.isArray(s.enum) && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted">Allowed values</span>
            <div className="flex flex-wrap gap-2">
              {s.enum.map((v) => (
                <span
                  key={JSON.stringify(v)}
                  className="inline-flex h-[34px] items-center rounded-lg bg-chip px-3 font-mono text-[13px]"
                >
                  {JSON.stringify(v)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
      {!!kids.length && (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-3.5 py-2.5 font-semibold">Property</th>
                <th className="px-3.5 py-2.5 font-semibold">Type</th>
                <th className="px-3.5 py-2.5 font-semibold">Required</th>
              </tr>
            </thead>
            <tbody>
              {kids.map((k) => {
                const p = [...path, ...k.rel];
                return (
                  <tr key={k.label} className="border-t border-line-soft">
                    <td className="px-3.5 py-2.5 font-mono">
                      <button
                        type="button"
                        className="text-link hover:underline"
                        onClick={() => onSelect(p)}
                      >
                        {k.label}
                      </button>
                    </td>
                    <td className="px-3.5 py-2.5">{summary(k.schema)}</td>
                    <td className="px-3.5 py-2.5">{isRequired(root, p) ? "Yes" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
