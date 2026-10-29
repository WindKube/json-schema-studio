import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { atLeast, type Comment, type Suggestion } from "../shared/api";
import { applySuggestion, type Format, type Operation } from "../shared/patch";
import { type App, body, deciders, notify, now, requireRole, requireUser } from "./lib";

export const collab = new Hono<App>();
collab.use(requireUser);

const MENTION = /@([A-Za-z0-9-]{1,39})/g;

async function title(db: D1Database, schemaId: number) {
  const row = await db
    .prepare("SELECT title FROM schemas WHERE id = ?")
    .bind(schemaId)
    .first<{ title: string }>();
  return row?.title ?? "a schema";
}

collab.get("/:id/comments", async (c) => {
  const { schemaId } = await requireRole(c, "viewer");
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.suggestion_id AS suggestionId, c.pointer, c.parent_id AS parentId, u.login AS author,
       c.body, c.resolved_at AS resolvedAt, c.created_at AS createdAt
     FROM comments c JOIN users u ON u.id = c.author_id WHERE c.schema_id = ? ORDER BY c.created_at`,
  )
    .bind(schemaId)
    .all<Comment>();
  return c.json(results);
});

collab.post("/:id/comments", async (c) => {
  const { schemaId, userId } = await requireRole(c, "commenter");
  const b = await body<{
    pointer?: string;
    body?: string;
    parentId?: number;
    suggestionId?: number;
  }>(c);
  const text = (b.body ?? "").trim();
  if (!text) throw new HTTPException(400, { message: "Comment is empty" });
  const row = await c.env.DB.prepare(
    `INSERT INTO comments (schema_id, suggestion_id, pointer, parent_id, author_id, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      schemaId,
      b.suggestionId ?? null,
      b.pointer ?? "#",
      b.parentId ?? null,
      userId,
      text,
      now(),
    )
    .first<{ id: number }>();

  const mentioned = [...text.matchAll(MENTION)].map((m) => m[1].toLowerCase());
  const recipients: number[] = [];
  if (mentioned.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT m.user_id FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.schema_id = ? AND lower(u.login) IN (${mentioned.map(() => "?").join(",")})`,
    )
      .bind(schemaId, ...mentioned)
      .all<{ user_id: number }>();
    recipients.push(...results.map((r) => r.user_id));
  }
  if (b.parentId) {
    const parent = await c.env.DB.prepare("SELECT author_id FROM comments WHERE id = ?")
      .bind(b.parentId)
      .first<{ author_id: number }>();
    if (parent) recipients.push(parent.author_id);
  }
  await notify(
    c.env.DB,
    recipients.filter((id) => id !== userId),
    "comment",
    {
      schemaId,
      text: `${c.get("user")?.login} commented on “${await title(c.env.DB, schemaId)}”: ${text.slice(0, 120)}`,
      href: `/schemas/${schemaId}`,
    },
  );
  return c.json(row, 201);
});

collab.post("/:id/comments/:commentId/resolve", async (c) => {
  const { schemaId, userId, role } = await requireRole(c, "commenter");
  const commentId = Number(c.req.param("commentId"));
  const { resolved } = await body<{ resolved?: boolean }>(c);
  const res = await c.env.DB.prepare(
    `UPDATE comments SET resolved_at = ? WHERE id = ? AND schema_id = ? AND (author_id = ? OR ?)`,
  )
    .bind(
      resolved === false ? null : now(),
      commentId,
      schemaId,
      userId,
      atLeast(role, "editor") ? 1 : 0,
    )
    .run();
  if (!res.meta.changes)
    throw new HTTPException(403, { message: "Only the author or an editor can resolve" });
  return c.json({ ok: true });
});

const SUGGESTION_COLUMNS = `s.id, s.number, s.title, s.body, a.login AS author, s.base_revision AS baseRevision,
  s.patch, s.status, d.login AS decidedBy, s.decision_note AS decisionNote, s.created_at AS createdAt`;
const SUGGESTION_FROM = `FROM suggestions s JOIN users a ON a.id = s.author_id
  LEFT JOIN users d ON d.id = s.decided_by`;

type SuggestionRow = Omit<Suggestion, "patch"> & { patch: string };
const toSuggestion = (r: SuggestionRow): Suggestion => ({ ...r, patch: JSON.parse(r.patch) });

collab.get("/:id/suggestions", async (c) => {
  const { schemaId } = await requireRole(c, "viewer");
  const { results } = await c.env.DB.prepare(
    `SELECT ${SUGGESTION_COLUMNS} ${SUGGESTION_FROM} WHERE s.schema_id = ? ORDER BY s.number DESC`,
  )
    .bind(schemaId)
    .all<SuggestionRow>();
  return c.json(results.map(toSuggestion));
});

collab.get("/:id/suggestions/:number", async (c) => {
  const { schemaId } = await requireRole(c, "viewer");
  const row = await c.env.DB.prepare(
    `SELECT ${SUGGESTION_COLUMNS} ${SUGGESTION_FROM} WHERE s.schema_id = ? AND s.number = ?`,
  )
    .bind(schemaId, Number(c.req.param("number")))
    .first<SuggestionRow>();
  if (!row) throw new HTTPException(404, { message: "Suggestion not found" });
  return c.json(toSuggestion(row));
});

collab.post("/:id/suggestions", async (c) => {
  const { schemaId, userId } = await requireRole(c, "commenter");
  const b = await body<{
    title?: string;
    body?: string;
    patch?: Operation[];
    baseRevision?: number;
  }>(c);
  if (!Array.isArray(b.patch) || !b.patch.length) {
    throw new HTTPException(400, { message: "A suggestion needs at least one change" });
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO suggestions (schema_id, number, title, body, author_id, base_revision, patch, created_at)
     VALUES (?1, (SELECT coalesce(max(number), 0) + 1 FROM suggestions WHERE schema_id = ?1), ?2, ?3, ?4, ?5, ?6, ?7)
     RETURNING number`,
  )
    .bind(
      schemaId,
      (b.title ?? "").trim() || "Untitled suggestion",
      b.body ?? "",
      userId,
      b.baseRevision ?? 0,
      JSON.stringify(b.patch),
      now(),
    )
    .first<{ number: number }>();
  const number = (row as { number: number }).number;
  await notify(
    c.env.DB,
    (await deciders(c.env.DB, schemaId)).filter((id) => id !== userId),
    "suggestion",
    {
      schemaId,
      text: `${c.get("user")?.login} suggested “${b.title}” on “${await title(c.env.DB, schemaId)}”`,
      href: `/schemas/${schemaId}/suggestions/${number}`,
    },
  );
  return c.json({ number }, 201);
});

const DECISIONS = {
  approve: "approved",
  changes: "changes_requested",
  reject: "rejected",
  reopen: "open",
} as const;

collab.post("/:id/suggestions/:number/decision", async (c) => {
  const { schemaId, userId } = await requireRole(c, "editor");
  const b = await body<{ decision?: keyof typeof DECISIONS; note?: string }>(c);
  const status = b.decision && DECISIONS[b.decision];
  if (!status) throw new HTTPException(400, { message: "Unknown decision" });
  if (status === "rejected" && !b.note?.trim()) {
    throw new HTTPException(400, { message: "A note is required to reject" });
  }
  const db = c.env.DB;
  const s = await db
    .prepare(
      "SELECT id, author_id, patch, status, title FROM suggestions WHERE schema_id = ? AND number = ?",
    )
    .bind(schemaId, Number(c.req.param("number")))
    .first<{ id: number; author_id: number; patch: string; status: string; title: string }>();
  if (!s) throw new HTTPException(404, { message: "Suggestion not found" });
  if (s.status === "approved") throw new HTTPException(409, { message: "Already applied" });

  const stmts = [
    db
      .prepare("UPDATE suggestions SET status = ?, decided_by = ?, decision_note = ? WHERE id = ?")
      .bind(status, status === "open" ? null : userId, b.note ?? null, s.id),
  ];
  if (status === "approved") {
    const draft = await db
      .prepare(
        "SELECT d.text, d.revision, s.format FROM drafts d JOIN schemas s ON s.id = d.schema_id WHERE d.schema_id = ?",
      )
      .bind(schemaId)
      .first<{ text: string; revision: number; format: Format }>();
    let text: string;
    try {
      text = applySuggestion(draft?.text ?? "", draft?.format ?? "json", JSON.parse(s.patch));
    } catch (e) {
      throw new HTTPException(409, {
        message: `Doesn't apply to the current draft: ${(e as Error).message}`,
      });
    }
    stmts.push(
      db
        .prepare(
          "UPDATE drafts SET text = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE schema_id = ?",
        )
        .bind(text, userId, now(), schemaId),
    );
  }
  await db.batch(stmts);
  if (s.author_id !== userId && status !== "open") {
    await notify(db, [s.author_id], "decision", {
      schemaId,
      text: `${c.get("user")?.login} ${status.replace("_", " ")} your suggestion “${s.title}”`,
      href: `/schemas/${schemaId}/suggestions/${c.req.param("number")}`,
    });
  }
  return c.json({ status });
});
