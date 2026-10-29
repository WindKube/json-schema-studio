import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { CatalogSource } from "../shared/api";
import { type App, body, type Ctx, MAX_TEXT, now, user } from "./lib";

const SCHEMASTORE_CATALOG = "https://www.schemastore.org/api/json/catalog.json";
const CACHE = { cacheTtl: 86400, cacheEverything: true };

export const catalog = new Hono<App>();

async function catalogUrls(url: string): Promise<string[]> {
  const res = await fetch(url, { cf: CACHE });
  if (!res.ok) return [];
  const data = await res.json<{ schemas?: { url: string; versions?: Record<string, string> }[] }>();
  return (data.schemas ?? []).flatMap((s) => [s.url, ...Object.values(s.versions ?? {})]);
}

async function allowed(c: Ctx, target: string) {
  if (target === SCHEMASTORE_CATALOG || (await catalogUrls(SCHEMASTORE_CATALOG)).includes(target)) {
    return true;
  }
  const me = c.get("user");
  if (!me) return false;
  const { results } = await c.env.DB.prepare(
    "SELECT url, kind FROM catalog_sources WHERE user_id = ?",
  )
    .bind(me.id)
    .all<{ url: string; kind: CatalogSource["kind"] }>();
  if (results.some((s) => s.url === target)) return true;
  for (const s of results.filter((s) => s.kind === "catalog")) {
    if ((await catalogUrls(s.url)).includes(target)) return true;
  }
  return false;
}

// Proxies schemas whose hosts don't send CORS headers. Only catalog-listed URLs, so it isn't an open proxy.
catalog.get("/schema", async (c) => {
  const target = c.req.query("url") ?? "";
  if (!/^https:\/\//.test(target) || !(await allowed(c, target))) {
    return c.text("URL is not in a known catalog", 403);
  }
  const upstream = await fetch(target, { cf: CACHE });
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_TEXT) return c.text("Schema is larger than 1 MB", 413);
  return new Response(buf, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
});

catalog.get("/catalog/sources", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, url, kind FROM catalog_sources WHERE user_id = ? ORDER BY created_at",
  )
    .bind(user(c).id)
    .all<CatalogSource>();
  return c.json(results);
});

catalog.post("/catalog/sources", async (c) => {
  const me = user(c);
  const b = await body<Partial<CatalogSource>>(c);
  if (!b.url || !/^https:\/\//.test(b.url))
    throw new HTTPException(400, { message: "Needs an https URL" });
  if (b.kind !== "catalog" && b.kind !== "schema") {
    throw new HTTPException(400, { message: "kind must be catalog or schema" });
  }
  const row = await c.env.DB.prepare(
    "INSERT INTO catalog_sources (user_id, name, url, kind, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(me.id, b.name?.trim() || new URL(b.url).hostname, b.url, b.kind, now())
    .first<{ id: number }>();
  return c.json(row, 201);
});

catalog.delete("/catalog/sources/:sourceId", async (c) => {
  await c.env.DB.prepare("DELETE FROM catalog_sources WHERE id = ? AND user_id = ?")
    .bind(Number(c.req.param("sourceId")), user(c).id)
    .run();
  return c.json({ ok: true });
});
