import { reveal } from "../editor/reveal";
import type { Problem } from "../validation/ajv";
import { locate } from "../validation/location";

type Props = { problems: Problem[]; text: string; onSelect?: (problem: Problem) => void };

export function ProblemList({ problems, text, onSelect }: Props) {
  if (!problems.length) return <p className="px-3 py-2 text-sm text-emerald-600">No problems.</p>;
  return (
    <ul className="text-sm" data-testid="problems">
      {problems.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: problems have no stable identity
        <li key={i}>
          <button
            type="button"
            onClick={() => (onSelect ? onSelect(p) : reveal(...locate(text, p.path)))}
            className="w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <code className="text-xs text-zinc-500">/{p.path.join("/")}</code>{" "}
            <span className="text-red-600 dark:text-red-400">{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
