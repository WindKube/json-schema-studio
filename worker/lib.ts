import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { atLeast, type Role, type User } from "../shared/api";

export type Env = {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOW_DEV_LOGIN?: string;
};

export type App = { Bindings: Env; Variables: { user: User | null } };
export type Ctx = Context<App>;

export const now = () => Date.now();

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function user(c: Ctx): User {
  const u = c.get("user");
  if (!u) throw new HTTPException(401, { message: "Sign in required" });
  return u;
}

export const requireUser = createMiddleware<App>(async (c, next) => {
  user(c);
  await next();
});

export async function roleOf(
  db: D1Database,
  schemaId: number,
  userId: number,
): Promise<Role | null> {
  const row = await db
    .prepare("SELECT role FROM members WHERE schema_id = ? AND user_id = ?")
    .bind(schemaId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

export async function requireRole(
  c: Ctx,
  min: Role,
): Promise<{ schemaId: number; userId: number; role: Role }> {
  const u = user(c);
  const schemaId = Number(c.req.param("id"));
  const role = await roleOf(c.env.DB, schemaId, u.id);
  if (!role) throw new HTTPException(404, { message: "Schema not found" });
  if (!atLeast(role, min)) throw new HTTPException(403, { message: `Needs ${min} access` });
  return { schemaId, userId: u.id, role };
}

export async function notify(db: D1Database, userIds: number[], kind: string, payload: object) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const stmt = db.prepare(
    "INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
  );
  await db.batch(unique.map((id) => stmt.bind(id, kind, JSON.stringify(payload), now())));
}

export async function deciders(db: D1Database, schemaId: number): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT user_id FROM members WHERE schema_id = ? AND role IN ('editor', 'owner')")
    .bind(schemaId)
    .all<{ user_id: number }>();
  return results.map((r) => r.user_id);
}

export async function body<T>(c: Ctx): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new HTTPException(400, { message: "Expected a JSON body" });
  }
}

export const MAX_TEXT = 1024 * 1024;

export function checkText(text: unknown): string {
  if (typeof text !== "string") throw new HTTPException(400, { message: "text is required" });
  if (text.length > MAX_TEXT) throw new HTTPException(413, { message: "Larger than 1 MB" });
  return text;
}
