import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type {
  Example,
  ExampleResult,
  PendingInvite,
  SchemaDetail,
  SchemaRow,
  Version,
} from "../shared/api";
import { type Format, parseSource } from "../shared/patch";
import { type App, body, checkText, now, requireRole, requireUser, user } from "./lib";

export const schemas = new Hono<App>();
schemas.use(requireUser);

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function compareSemver(a: string, b: string): number {
  const pa = a.match(SEMVER)?.slice(1).map(Number) ?? [0, 0, 0];
  const pb = b.match(SEMVER)?.slice(1).map(Number) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function schemaUri(text: string, format: Format): string | null {
  try {
    const data = parseSource(text, format) as { $id?: unknown };
    return typeof data?.$id === "string" ? data.$id : null;
  } catch {
    return null;
  }
}

const checkFormat = (f: unknown): Format => {
  if (f !== "json" && f !== "yaml")
    throw new HTTPException(400, { message: "format must be json or yaml" });
  return f;
};

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "schema";

schemas.get("/", async (c) => {
  const me = user(c);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.title, s.slug, s.format, o.login AS ownerLogin, s.schema_uri AS schemaUri,
       m.role, s.owner_id = ?1 AS mine, lv.semver AS latestVersion,
       d.text != COALESCE(lv.text, '') AS draftChanged,
       (SELECT count(*) FROM members WHERE schema_id = s.id) AS people,
       (SELECT count(*) FROM examples WHERE schema_id = s.id) AS examples,
       d.failing_examples AS failingExamples,
       (SELECT count(*) FROM suggestions WHERE schema_id = s.id AND status = 'open') AS openSuggestions,
       (SELECT count(*) FROM comments WHERE schema_id = s.id AND suggestion_id IS NULL
          AND parent_id IS NULL AND resolved_at IS NULL) AS openComments,
       max(s.updated_at, d.updated_at) AS updatedAt
     FROM members m
     JOIN schemas s ON s.id = m.schema_id
     JOIN users o ON o.id = s.owner_id
     JOIN drafts d ON d.schema_id = s.id
     LEFT JOIN versions lv ON lv.id = (SELECT id FROM versions WHERE schema_id = s.id
       ORDER BY published_at DESC LIMIT 1)
     WHERE m.user_id = ?1
     ORDER BY updatedAt DESC`,
  )
    .bind(me.id)
    .all<SchemaRow & { mine: number }>();
  const rows = results.map(({ mine, ...r }) => ({ ...r, draftChanged: !!r.draftChanged, mine }));
  const invites = await c.env.DB.prepare(
    `SELECT i.id, i.schema_id AS schemaId, s.title AS schemaTitle, i.role, u.login AS invitedBy
     FROM invites i JOIN schemas s ON s.id = i.schema_id JOIN users u ON u.id = i.created_by
     WHERE i.github_id = (SELECT github_id FROM users WHERE id = ?) AND i.used_at IS NULL
       AND i.token_hash IS NULL`,
  )
    .bind(me.id)
    .all<PendingInvite>();
  return c.json({
    mine: rows.filter((r) => r.mine).map(({ mine: _, ...r }) => r),
    shared: rows.filter((r) => !r.mine).map(({ mine: _, ...r }) => r),
    invites: invites.results,
  });
});

schemas.post("/", async (c) => {
  const me = user(c);
  const b = await body<{
    title?: string;
    format?: Format;
    text?: string;
    sourceUrl?: string;
    sourceVersion?: string;
  }>(c);
  const title = (b.title ?? "").trim() || "Untitled schema";
  const format = checkFormat(b.format);
  const text = checkText(b.text);
  const base = slugify(title);
  const { results: taken } = await c.env.DB.prepare(
    "SELECT slug FROM schemas WHERE owner_id = ? AND (slug = ? OR slug LIKE ?)",
  )
    .bind(me.id, base, `${base}-%`)
    .all<{ slug: string }>();
  const used = new Set(taken.map((t) => t.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  const t = now();
  const row = await c.env.DB.prepare(
    `INSERT INTO schemas (owner_id, slug, title, format, schema_uri, source_url, source_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      me.id,
      slug,
      title,
      format,
      schemaUri(text, format),
      b.sourceUrl ?? null,
      b.sourceVersion ?? null,
      t,
      t,
    )
    .first<{ id: number }>();
  const id = (row as { id: number }).id;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO drafts (schema_id, text, updated_by, updated_at) VALUES (?, ?, ?, ?)",
    ).bind(id, text, me.id, t),
    c.env.DB.prepare(
      "INSERT INTO members (schema_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, me.id, t),
  ]);
  return c.json({ id }, 201);
});

async function loadVersions(db: D1Database, schemaId: number): Promise<Version[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.semver, v.text, v.notes, v.example_results AS exampleResults,
         u.login AS publishedBy, v.published_at AS publishedAt
       FROM versions v JOIN users u ON u.id = v.published_by WHERE v.schema_id = ?`,
    )
    .bind(schemaId)
    .all<Omit<Version, "exampleResults"> & { exampleResults: string }>();
  return results
    .map((v) => ({ ...v, exampleResults: JSON.parse(v.exampleResults) as ExampleResult[] }))
    .sort((a, b) => compareSemver(b.semver, a.semver));
}

schemas.get("/:id", async (c) => {
  const { schemaId, role } = await requireRole(c, "viewer");
  const db = c.env.DB;
  const schema = await db
    .prepare(
      `SELECT s.id, s.title, s.slug, s.format, o.login AS ownerLogin, s.public_versions AS publicVersions,
         s.source_url AS sourceUrl, s.source_version AS sourceVersion
       FROM schemas s JOIN users o ON o.id = s.owner_id WHERE s.id = ?`,
    )
    .bind(schemaId)
    .first<SchemaDetail["schema"]>();
  const draft = await db
    .prepare(
      `SELECT d.text, d.revision, d.updated_at AS updatedAt, u.login AS updatedBy
       FROM drafts d LEFT JOIN users u ON u.id = d.updated_by WHERE d.schema_id = ?`,
    )
    .bind(schemaId)
    .first<SchemaDetail["draft"]>();
  const { results: examples } = await db
    .prepare(
      `SELECT id, name, format, text, description, expect, updated_at AS updatedAt
       FROM examples WHERE schema_id = ? ORDER BY name`,
    )
    .bind(schemaId)
    .all<Example>();
  const detail: SchemaDetail = {
    schema: {
      ...(schema as SchemaDetail["schema"]),
      publicVersions: !!schema?.publicVersions,
      role,
    },
    draft: draft as SchemaDetail["draft"],
    versions: await loadVersions(db, schemaId),
    examples,
  };
  return c.json(detail);
});

schemas.patch("/:id", async (c) => {
  const b = await body<{ title?: string; publicVersions?: boolean }>(c);
  const { schemaId } = await requireRole(c, b.publicVersions === undefined ? "editor" : "owner");
  if (b.title !== undefined) {
    await c.env.DB.prepare("UPDATE schemas SET title = ?, updated_at = ? WHERE id = ?")
      .bind(b.title.trim() || "Untitled schema", now(), schemaId)
      .run();
  }
  if (b.publicVersions !== undefined) {
    await c.env.DB.prepare("UPDATE schemas SET public_versions = ? WHERE id = ?")
      .bind(b.publicVersions ? 1 : 0, schemaId)
      .run();
  }
  return c.json({ ok: true });
});

schemas.delete("/:id", async (c) => {
  const { schemaId } = await requireRole(c, "owner");
  await c.env.DB.prepare("DELETE FROM schemas WHERE id = ?").bind(schemaId).run();
  return c.json({ ok: true });
});

schemas.put("/:id/draft", async (c) => {
  const { schemaId, userId } = await requireRole(c, "editor");
  const b = await body<{ text?: string; revision?: number; format?: Format }>(c);
  const text = checkText(b.text);
  const s = await c.env.DB.prepare("SELECT format FROM schemas WHERE id = ?")
    .bind(schemaId)
    .first<{ format: Format }>();
  const format = b.format ? checkFormat(b.format) : (s as { format: Format }).format;
  const t = now();
  const updated = await c.env.DB.prepare(
    `UPDATE drafts SET text = ?, revision = revision + 1, updated_by = ?, updated_at = ?
     WHERE schema_id = ? AND revision = ? RETURNING revision`,
  )
    .bind(text, userId, t, schemaId, b.revision ?? -1)
    .first<{ revision: number }>();
  if (!updated) {
    const cur = await c.env.DB.prepare(
      `SELECT d.revision, d.text, u.login AS updatedBy FROM drafts d
       LEFT JOIN users u ON u.id = d.updated_by WHERE d.schema_id = ?`,
    )
      .bind(schemaId)
      .first();
    return c.json({ error: "conflict", ...cur }, 409);
  }
  await c.env.DB.prepare(
    "UPDATE schemas SET format = ?, schema_uri = ?, updated_at = ? WHERE id = ?",
  )
    .bind(format, schemaUri(text, format), t, schemaId)
    .run();
  return c.json({ revision: updated.revision, updatedAt: t });
});

schemas.post("/:id/draft/check", async (c) => {
  const { schemaId } = await requireRole(c, "viewer");
  const { failing } = await body<{ failing?: number }>(c);
  await c.env.DB.prepare("UPDATE drafts SET failing_examples = ? WHERE schema_id = ?")
    .bind(Math.max(0, Number(failing) || 0), schemaId)
    .run();
  return c.json({ ok: true });
});

schemas.post("/:id/versions", async (c) => {
  const { schemaId, userId } = await requireRole(c, "owner");
  const b = await body<{ semver?: string; notes?: string; exampleResults?: ExampleResult[] }>(c);
  const semver = (b.semver ?? "").replace(/^v/, "");
  if (!SEMVER.test(semver))
    throw new HTTPException(400, { message: "Version must look like 1.2.3" });
  const latest = (await loadVersions(c.env.DB, schemaId))[0];
  if (latest && compareSemver(semver, latest.semver) <= 0) {
    throw new HTTPException(400, { message: `Version must be greater than ${latest.semver}` });
  }
  const t = now();
  const row = await c.env.DB.prepare(
    `INSERT INTO versions (schema_id, semver, text, notes, example_results, published_by, published_at)
     SELECT schema_id, ?, text, ?, ?, ?, ? FROM drafts WHERE schema_id = ? RETURNING id`,
  )
    .bind(semver, b.notes ?? "", JSON.stringify(b.exampleResults ?? []), userId, t, schemaId)
    .first<{ id: number }>();
  await c.env.DB.prepare("UPDATE drafts SET base_version_id = ? WHERE schema_id = ?")
    .bind(row?.id, schemaId)
    .run();
  await c.env.DB.prepare("UPDATE schemas SET updated_at = ? WHERE id = ?").bind(t, schemaId).run();
  return c.json({ id: row?.id, semver }, 201);
});

schemas.post("/:id/versions/:semver/restore", async (c) => {
  const { schemaId, userId } = await requireRole(c, "editor");
  const res = await c.env.DB.prepare(
    `UPDATE drafts SET text = (SELECT text FROM versions WHERE schema_id = ?1 AND semver = ?2),
       revision = revision + 1, updated_by = ?3, updated_at = ?4
     WHERE schema_id = ?1 AND EXISTS (SELECT 1 FROM versions WHERE schema_id = ?1 AND semver = ?2)
     RETURNING revision`,
  )
    .bind(schemaId, c.req.param("semver"), userId, now())
    .first<{ revision: number }>();
  if (!res) throw new HTTPException(404, { message: "Version not found" });
  return c.json(res);
});

type ExampleInput = Partial<Pick<Example, "name" | "format" | "text" | "description" | "expect">>;

function checkExample(b: ExampleInput) {
  if (b.expect !== undefined && b.expect !== "valid" && b.expect !== "invalid") {
    throw new HTTPException(400, { message: "expect must be valid or invalid" });
  }
  if (b.format !== undefined) checkFormat(b.format);
  if (b.text !== undefined) checkText(b.text);
}

schemas.post("/:id/examples", async (c) => {
  const { schemaId } = await requireRole(c, "editor");
  const b = await body<ExampleInput>(c);
  checkExample(b);
  const row = await c.env.DB.prepare(
    `INSERT INTO examples (schema_id, name, format, text, description, expect, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      schemaId,
      b.name?.trim() || "example",
      b.format ?? "yaml",
      b.text ?? "",
      b.description ?? "",
      b.expect ?? "valid",
      now(),
    )
    .first<{ id: number }>();
  return c.json(row, 201);
});

schemas.put("/:id/examples/:exampleId", async (c) => {
  const { schemaId } = await requireRole(c, "editor");
  const b = await body<ExampleInput>(c);
  checkExample(b);
  const res = await c.env.DB.prepare(
    `UPDATE examples SET name = coalesce(?, name), format = coalesce(?, format), text = coalesce(?, text),
       description = coalesce(?, description), expect = coalesce(?, expect), updated_at = ?
     WHERE id = ? AND schema_id = ?`,
  )
    .bind(
      b.name?.trim() || null,
      b.format ?? null,
      b.text ?? null,
      b.description ?? null,
      b.expect ?? null,
      now(),
      Number(c.req.param("exampleId")),
      schemaId,
    )
    .run();
  if (!res.meta.changes) throw new HTTPException(404, { message: "Example not found" });
  return c.json({ ok: true });
});

schemas.delete("/:id/examples/:exampleId", async (c) => {
  const { schemaId } = await requireRole(c, "editor");
  await c.env.DB.prepare("DELETE FROM examples WHERE id = ? AND schema_id = ?")
    .bind(Number(c.req.param("exampleId")), schemaId)
    .run();
  return c.json({ ok: true });
});
