import { cachedJson } from "./loader";

export type CatalogEntry = {
  name: string;
  description?: string;
  url: string;
  fileMatch?: string[];
  versions?: Record<string, string>;
};

export const CATALOG_URL = "https://www.schemastore.org/api/json/catalog.json";

let catalog: Promise<CatalogEntry[]> | undefined;

export function loadCatalog(): Promise<CatalogEntry[]> {
  catalog ??= cachedJson<{ schemas: CatalogEntry[] }>(CATALOG_URL).then((c) => c.schemas);
  catalog.catch(() => {
    catalog = undefined;
  });
  return catalog;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// Each word must appear somewhere; spaces and punctuation are ignored, so "cd events" finds
// "CDEvents" and "github-workflow" finds "GitHub Workflow". Name matches rank first.
export function searchCatalog(entries: CatalogEntry[], query: string, limit = 50): CatalogEntry[] {
  const words = query.trim().split(/\s+/).map(squash).filter(Boolean);
  if (!words.length) return entries.slice(0, limit);
  const whole = words.join("");
  const scored: [number, CatalogEntry][] = [];
  for (const e of entries) {
    const name = squash(e.name);
    const rest = squash([e.description, e.url, ...(e.fileMatch ?? [])].join(" "));
    let score: number;
    if (name === whole) score = 0;
    else if (name.startsWith(whole)) score = 1;
    else if (name.includes(whole)) score = 2;
    else if (words.every((w) => name.includes(w))) score = 3;
    else if (words.every((w) => name.includes(w) || rest.includes(w))) score = 4;
    else if (rest.includes(whole)) score = 5;
    else continue;
    scored.push([score, e]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, e]) => e);
}

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}

export function matchFileName(entries: CatalogEntry[], fileName: string): CatalogEntry | undefined {
  const base = fileName.split("/").pop() ?? fileName;
  return entries.find((e) =>
    e.fileMatch?.some((pattern) => {
      if (pattern.startsWith("!")) return false;
      const re = globToRegExp(pattern);
      return re.test(fileName) || re.test(base);
    }),
  );
}
