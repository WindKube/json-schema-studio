import { useState } from "react";
import { TypeBadge } from "./fields";
import {
  flatten,
  flattenDefs,
  isExpanded,
  type Path,
  pathKey,
  summary,
  type TreeNode,
} from "./tree";

type Props = {
  root: unknown;
  selected: Path;
  open: Map<string, boolean>;
  onToggle: (key: string, open: boolean) => void;
  onSelect: (path: Path) => void;
  onAddProperty?: () => void;
  onAddDefinition?: () => void;
  badges?: Map<string, number>;
  className?: string;
};

export function Outline({
  root,
  selected,
  open,
  onToggle,
  onSelect,
  onAddProperty,
  onAddDefinition,
  badges,
  className = "md:w-72 md:border-r",
}: Props) {
  const [filter, setFilter] = useState("");
  const nodes = flatten(root, open, filter, true);
  const defs = flattenDefs(root, open, filter);
  const selectedKey = pathKey(selected);

  const row = (n: TreeNode) => {
    const expanded = filter ? true : isExpanded(n, open);
    const current = n.key === selectedKey;
    return (
      <li key={n.key} className="flex items-center" style={{ paddingLeft: n.depth * 14 }}>
        {n.hasChildren ? (
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${n.label}`}
            aria-expanded={expanded}
            onClick={() => onToggle(n.key, !expanded)}
            className="flex h-7 w-5 shrink-0 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          aria-current={current}
          onClick={() => onSelect(n.path)}
          className={`flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded px-1.5 text-left ${current ? "bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          <span className="truncate">{n.label}</span>
          {n.required && (
            <span className="font-bold text-red-600" title="required">
              *
            </span>
          )}
          <span className="ml-auto" />
          {!!badges?.get(n.key) && (
            <span
              className="inline-flex size-[18px] items-center justify-center rounded-full bg-warn-bg font-sans text-[11px] font-bold text-[#8A4B08]"
              title="Open comments"
            >
              {badges.get(n.key)}
            </span>
          )}
          <TypeBadge label={summary(n.schema)} />
        </button>
      </li>
    );
  };

  return (
    <aside
      aria-label="Schema outline"
      className={`flex min-h-0 flex-col border-zinc-200 dark:border-zinc-800 ${className}`}
    >
      <div className="flex flex-col gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Outline
          </span>
          {onAddProperty && (
            <button type="button" className="btn" onClick={onAddProperty}>
              + Property
            </button>
          )}
        </div>
        <input
          type="search"
          aria-label="Filter properties"
          placeholder="Filter properties"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ul className="m-0 list-none p-2 font-mono text-[13px]" data-testid="outline">
          {nodes.map(row)}
          {!nodes.length && <li className="p-2 font-sans text-sm text-zinc-500">No matches.</li>}
        </ul>
        {(defs.length > 0 || (onAddDefinition && !filter)) && (
          <section
            aria-label="Definitions"
            className="mt-2 border-t border-zinc-200 dark:border-zinc-800"
          >
            <div className="flex items-center justify-between px-3 pt-3 pb-1">
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Definitions
              </span>
              {onAddDefinition && (
                <button type="button" className="btn" onClick={onAddDefinition}>
                  + Definition
                </button>
              )}
            </div>
            <ul className="m-0 list-none p-2 font-mono text-[13px]" data-testid="definitions">
              {defs.map(row)}
              {!defs.length && (
                <li className="p-2 font-sans text-sm text-zinc-500">
                  Reusable schemas you can $ref from anywhere.
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
