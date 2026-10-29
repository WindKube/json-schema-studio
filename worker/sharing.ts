import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { atLeast, type Invite, type Member, ROLES, type Role } from "../shared/api";
import {
  type App,
  body,
  notify,
  now,
  randomToken,
  requireRole,
  requireUser,
  sha256,
  user,
} from "./lib";

export const sharing = new Hono<App>();
sharing.use(requireUser);

const LINK_DAYS = 7;

const checkRole = (r: unknown): Role => {
  if (!ROLES.includes(r as Role)) throw new HTTPException(400, { message: "Unknown role" });
  return r as Role;
};

async function grant(db: D1Database, schemaId: number, userId: number, role: Role) {
  const current = await db
    .prepare("SELECT role FROM members WHERE schema_id = ? AND user_id = ?")
    .bind(schemaId, userId)
    .first<{ role: Role }>();
  if (current && atLeast(current.role, role)) return;
  await db
    .prepare(
      `INSERT INTO members (schema_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (schema_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .bind(schemaId, userId, role, now())
    .run();
}

sharing.get("/schemas/:id/members", async (c) => {
  const { schemaId } = await requireRole(c, "viewer");
  const { results: members } = await c.env.DB.prepare(
    `SELECT m.user_id AS userId, u.login, u.avatar_url AS avatarUrl, m.role, m.created_at AS since
     FROM members m JOIN users u ON u.id = m.user_id WHERE m.schema_id = ? ORDER BY m.created_at`,
  )
    .bind(schemaId)
    .all<Member>();
  const { results: invites } = await c.env.DB.prepare(
    `SELECT id, github_login AS login, avatar_url AS avatarUrl, role, token_hash IS NOT NULL AS link,
       expires_at AS expiresAt
     FROM invites WHERE schema_id = ? AND used_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
  )
    .bind(schemaId, now())
    .all<Invite>();
  return c.json({ members, invites: invites.map((i) => ({ ...i, link: !!i.link })) });
});

sharing.put("/schemas/:id/members/:userId", async (c) => {
  const { schemaId } = await requireRole(c, "owner");
  const role = checkRole((await body<{ role?: Role }>(c)).role);
  const target = Number(c.req.param("userId"));
  await assertKeepsOwner(c.env.DB, schemaId, target, role);
  await c.env.DB.prepare("UPDATE members SET role = ? WHERE schema_id = ? AND user_id = ?")
    .bind(role, schemaId, target)
    .run();
  return c.json({ ok: true });
});

sharing.delete("/schemas/:id/members/:userId", async (c) => {
  const { schemaId } = await requireRole(c, "owner");
  const target = Number(c.req.param("userId"));
  await assertKeepsOwner(c.env.DB, schemaId, target, null);
  await c.env.DB.prepare("DELETE FROM members WHERE schema_id = ? AND user_id = ?")
    .bind(schemaId, target)
    .run();
  return c.json({ ok: true });
});

async function assertKeepsOwner(
  db: D1Database,
  schemaId: number,
  target: number,
  role: Role | null,
) {
  if (role === "owner") return;
  const row = await db
    .prepare(
      "SELECT count(*) AS n FROM members WHERE schema_id = ? AND role = 'owner' AND user_id != ?",
    )
    .bind(schemaId, target)
    .first<{ n: number }>();
  if (!row?.n) throw new HTTPException(400, { message: "A schema needs at least one owner" });
}

sharing.post("/schemas/:id/invites", async (c) => {
  const { schemaId, userId } = await requireRole(c, "owner");
  const b = await body<{ login?: string; role?: Role }>(c);
  const role = checkRole(b.role);
  const login = (b.login ?? "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login))
    throw new HTTPException(400, { message: "Not a GitHub username" });

  let gh: { id: number; login: string; avatar_url: string } | null = null;
  const res = await fetch(`https://api.github.com/users/${login}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "json-schema-studio" },
  });
  if (res.status === 404) throw new HTTPException(404, { message: `No GitHub user @${login}` });
  // Unauthenticated GitHub calls are rate limited; the invite still binds by login at sign-in.
  if (res.ok) gh = await res.json();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE github_id = ? OR (? IS NULL AND lower(login) = lower(?))",
  )
    .bind(gh?.id ?? null, gh?.id ?? null, login)
    .first<{ id: number }>();
  if (existing) {
    const member = await c.env.DB.prepare(
      "SELECT 1 FROM members WHERE schema_id = ? AND user_id = ?",
    )
      .bind(schemaId, existing.id)
      .first();
    if (member) throw new HTTPException(409, { message: `@${login} already has access` });
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO invites (schema_id, role, github_id, github_login, avatar_url, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(schemaId, role, gh?.id ?? null, gh?.login ?? login, gh?.avatar_url ?? null, userId, now())
    .first<{ id: number }>();
  if (existing) {
    const s = await c.env.DB.prepare("SELECT title FROM schemas WHERE id = ?")
      .bind(schemaId)
      .first<{ title: string }>();
    await notify(c.env.DB, [existing.id], "invite", {
      schemaId,
      text: `${user(c).login} invited you to “${s?.title}” as ${role}`,
      href: "/",
    });
  }
  return c.json({ id: row?.id, registered: !!existing }, 201);
});

sharing.delete("/schemas/:id/invites/:inviteId", async (c) => {
  const { schemaId } = await requireRole(c, "owner");
  await c.env.DB.prepare("DELETE FROM invites WHERE id = ? AND schema_id = ? AND used_at IS NULL")
    .bind(Number(c.req.param("inviteId")), schemaId)
    .run();
  return c.json({ ok: true });
});

sharing.post("/schemas/:id/invite-links", async (c) => {
  const { schemaId, userId } = await requireRole(c, "owner");
  const role = checkRole((await body<{ role?: Role }>(c)).role);
  const token = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO invites (schema_id, role, token_hash, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(schemaId, role, await sha256(token), userId, now(), now() + LINK_DAYS * 86400_000)
    .run();
  return c.json({ url: new URL(`/invite/${token}`, c.req.url).toString() }, 201);
});

sharing.post("/invite-links/:token/accept", async (c) => {
  const me = user(c);
  const invite = await c.env.DB.prepare(
    `UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     RETURNING schema_id, role`,
  )
    .bind(now(), await sha256(c.req.param("token")), now())
    .first<{ schema_id: number; role: Role }>();
  if (!invite)
    throw new HTTPException(410, { message: "This invite link was used or has expired" });
  await grant(c.env.DB, invite.schema_id, me.id, invite.role);
  return c.json({ schemaId: invite.schema_id });
});

sharing.post("/invites/:inviteId/:action{accept|decline}", async (c) => {
  const me = user(c);
  const invite = await c.env.DB.prepare(
    `UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL
       AND github_id = (SELECT github_id FROM users WHERE id = ?)
     RETURNING schema_id, role`,
  )
    .bind(now(), Number(c.req.param("inviteId")), me.id)
    .first<{ schema_id: number; role: Role }>();
  if (!invite) throw new HTTPException(404, { message: "Invite not found" });
  if (c.req.param("action") === "accept")
    await grant(c.env.DB, invite.schema_id, me.id, invite.role);
  return c.json({ schemaId: invite.schema_id });
});

sharing.get("/notifications", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, payload, read_at AS readAt, created_at AS createdAt FROM notifications
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(user(c).id)
    .all<{ payload: string }>();
  return c.json(results.map((n) => ({ ...n, payload: JSON.parse(n.payload) })));
});

sharing.post("/notifications/read", async (c) => {
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
  )
    .bind(now(), user(c).id)
    .run();
  return c.json({ ok: true });
});
