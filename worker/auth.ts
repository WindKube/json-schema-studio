import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { User } from "../shared/api";
import { type App, type Ctx, now, randomToken, sha256 } from "./lib";

const SESSION_COOKIE = "sid";
const STATE_COOKIE = "oauth_state";
const SESSION_DAYS = 30;

type GitHubUser = { id: number; login: string; name: string | null; avatar_url: string };

export const session = createMiddleware<App>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  let found: User | null = null;
  if (token) {
    found = await c.env.DB.prepare(
      `SELECT u.id, u.login, u.name, u.avatar_url AS avatarUrl FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
      .bind(await sha256(token), now())
      .first<User>();
  }
  c.set("user", found);
  await next();
});

// Pages are same-origin and send JSON; a cross-site form post can do neither.
export const csrf = createMiddleware<App>(async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.text("Cross-origin request", 403);
    if (!c.req.header("content-type")?.startsWith("application/json")) {
      return c.text("Expected application/json", 415);
    }
  }
  await next();
});

async function upsertUser(c: Ctx, gh: GitHubUser): Promise<number> {
  const row = await c.env.DB.prepare(
    `INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET login = excluded.login, name = excluded.name,
       avatar_url = excluded.avatar_url
     RETURNING id`,
  )
    .bind(gh.id, gh.login, gh.name, gh.avatar_url, now())
    .first<{ id: number }>();
  const userId = (row as { id: number }).id;
  // Invites sent before the person had an account were keyed by GitHub login; bind them to the id now.
  await c.env.DB.prepare(
    "UPDATE invites SET github_id = ? WHERE github_id IS NULL AND lower(github_login) = lower(?) AND used_at IS NULL",
  )
    .bind(gh.id, gh.login)
    .run();
  return userId;
}

async function startSession(c: Ctx, userId: number) {
  const token = randomToken();
  const expires = now() + SESSION_DAYS * 86400_000;
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, expires)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

const safeNext = (next: string | undefined) =>
  next?.startsWith("/") && !next.startsWith("//") ? next : "/";

export const auth = new Hono<App>();

auth.get("/github", (c) => {
  const state = randomToken();
  const next = safeNext(c.req.query("next"));
  setCookie(c, STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", new URL("/auth/github/callback", c.req.url).toString());
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

auth.get("/github/callback", async (c) => {
  const [expected, next] = (getCookie(c, STATE_COOKIE) ?? "").split("|");
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  const code = c.req.query("code");
  if (!code || !expected || c.req.query("state") !== expected) {
    return c.redirect("/login?error=state");
  }
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const { access_token } = await tokenRes.json<{ access_token?: string }>();
  if (!access_token) return c.redirect("/login?error=github");
  const ghRes = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "json-schema-studio",
    },
  });
  if (!ghRes.ok) return c.redirect("/login?error=github");
  const userId = await upsertUser(c, await ghRes.json<GitHubUser>());
  await startSession(c, userId);
  return c.redirect(safeNext(next));
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Local development and e2e only: never set ALLOW_DEV_LOGIN outside .dev.vars.
async function devLogin(c: Ctx) {
  const login = c.req.query("login")?.trim() || "dev";
  const fakeId = -Number.parseInt((await sha256(login)).slice(0, 12), 16);
  await startSession(c, await upsertUser(c, { id: fakeId, login, name: login, avatar_url: "" }));
}

auth.post("/dev-login", async (c) => {
  if (c.env.ALLOW_DEV_LOGIN !== "1") return c.notFound();
  await devLogin(c);
  return c.json({ ok: true });
});

auth.get("/dev-login", async (c) => {
  if (c.env.ALLOW_DEV_LOGIN !== "1") return c.notFound();
  await devLogin(c);
  return c.redirect(safeNext(c.req.query("next")));
});
