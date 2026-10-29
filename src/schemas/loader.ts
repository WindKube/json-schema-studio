import { get, set } from "idb-keyval";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function cachedJson<T>(url: string): Promise<T> {
  const key = `json:${url}`;
  const cached = await get<{ at: number; data: T }>(key);
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.data;
  try {
    const data = await fetchJson<T>(url);
    await set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (cached) return cached.data;
    throw e;
  }
}

export const fetchSchema = (url: string) => cachedJson<object>(url);

async function fetchJson<T>(url: string): Promise<T> {
  try {
    return await (await fetch(url)).json();
  } catch {
    // Some catalog hosts don't send CORS headers; the Pages Function proxies those.
    const res = await fetch(`/api/schema?url=${encodeURIComponent(url)}`);
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
      throw new Error(
        `Could not load ${url}. The host likely blocks cross-origin requests — paste the schema in Schema mode instead.`,
      );
    }
    return res.json();
  }
}
