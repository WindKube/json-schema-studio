import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { parseSource, serialize } from "../shared/patch";
import { auth, csrf, session } from "./auth";
import { catalog } from "./catalog";
import { collab } from "./collab";
import type { App } from "./lib";
import { schemas } from "./schemas";
import { sharing } from "./sharing";

const app = new Hono<App>();

app.use(session);
app.use("/api/*", csrf);
app.use("/auth/*", csrf);

app.route("/auth", auth);
app.get("/api/me", (c) => {
  const me = c.get("user");
  return me ? c.json(me) : c.json({ error: "Sign in required" }, 401);
});
app.route("/api", catalog);
app.route("/api/schemas", schemas);
app.route("/api/schemas", collab);
app.route("/api", sharing);

// Stable URL of a published version, e.g. /s/mira/order-event/1.2.0.json or /s/mira/order-event/latest.yaml
app.get("/s/:owner/:slug/:file{.+\\.(json|yaml)}", async (c) => {
  const file = c.req.param("file");
  const format = file.endsWith(".yaml") ? "yaml" : "json";
  const ver = file.replace(/\.(json|yaml)$/, "").replace(/^v/, "");
  const s = await c.env.DB.prepare(
    `SELECT s.id, s.public_versions FROM schemas s JOIN users u ON u.id = s.owner_id
     WHERE lower(u.login) = lower(?) AND s.slug = ?`,
  )
    .bind(c.req.param("owner"), c.req.param("slug"))
    .first<{ id: number; public_versions: number }>();
  const me = c.get("user");
  const member =
    s &&
    me &&
    (await c.env.DB.prepare("SELECT 1 FROM members WHERE schema_id = ? AND user_id = ?")
      .bind(s.id, me.id)
      .first());
  if (!s || (!s.public_versions && !member)) return c.text("Not found", 404);
  const v = await c.env.DB.prepare(
    ver === "latest"
      ? "SELECT text FROM versions WHERE schema_id = ? ORDER BY published_at DESC LIMIT 1"
      : "SELECT text FROM versions WHERE schema_id = ? AND semver = ?",
  )
    .bind(...(ver === "latest" ? [s.id] : [s.id, ver]))
    .first<{ text: string }>();
  if (!v) return c.text("Not found", 404);
  const src = await c.env.DB.prepare("SELECT format FROM schemas WHERE id = ?")
    .bind(s.id)
    .first<{ format: "json" | "yaml" }>();
  const text =
    src?.format === format ? v.text : serialize(parseSource(v.text, src?.format ?? "json"), format);
  return c.body(text, 200, {
    "content-type": format === "json" ? "application/schema+json" : "application/yaml",
    "cache-control": s.public_versions ? "public, max-age=300" : "private, no-store",
    ...(s.public_versions ? { "access-control-allow-origin": "*" } : {}),
  });
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
