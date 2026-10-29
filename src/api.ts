import { QueryClient, useQuery } from "@tanstack/react-query";
import type { SchemaDetail, User } from "../shared/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const message = typeof data === "object" && data?.error ? String(data.error) : String(data);
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<User>("/api/me").catch((e) =>
        e instanceof ApiError && e.status === 401 ? null : Promise.reject(e),
      ),
    staleTime: 60_000,
  });
}

export const useSchema = (id: number) =>
  useQuery({ queryKey: ["schema", id], queryFn: () => api<SchemaDetail>(`/api/schemas/${id}`) });

export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${Math.max(s, 1)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86400) return "Yesterday";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
