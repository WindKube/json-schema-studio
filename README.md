# JSON Schema Studio

Write, review and publish JSON Schemas with your team.

Sign in with GitHub, start from a blank schema, a pasted or imported file, or anything in the
[SchemaStore](https://www.schemastore.org) catalog. Edit visually or in the source (YAML comments are kept),
keep example documents as contract tests, take suggestions from collaborators and review them like pull
requests, then publish immutable semver versions with stable URLs. Breaking changes are detected and a
major bump is suggested. Validation runs in your browser.

The anonymous single-file editor is still available at `/playground`.

Runs entirely on the Cloudflare free tier: one Worker serves the SPA and the API, data lives in D1.

## Development

Everything runs in Docker:

```sh
cp .dev.vars.example .dev.vars              # first time, then fill in the GitHub OAuth app (optional)
task run                                    # install deps, migrate local D1, dev server on http://localhost:5173
task migrate                                # apply new migrations to the local D1
docker compose run --rm app pnpm test       # unit tests
docker compose run --rm app pnpm lint
docker compose run --rm e2e                 # Playwright tests
```

Without GitHub credentials you can sign in locally with `ALLOW_DEV_LOGIN=1` (set in `.dev.vars`):
`curl -X POST -H 'content-type: application/json' localhost:5173/auth/dev-login?login=alice` or the same
request from the browser devtools. Never set it in production.

For real GitHub login locally, create a separate
[OAuth app](https://github.com/settings/applications/new) with callback
`http://localhost:5173/auth/github/callback` and put its id and secret in `.dev.vars`.

## Deployment

Runs in Docker like everything else. One-time setup:

```sh
task wrangler:login                       # prints a code to confirm in the browser; kept in a Docker volume
task wrangler:create:db                   # put the printed database_id on the DB binding in wrangler.jsonc
task wrangler:secret:github_client_id
task wrangler:secret:github_client_secret
```

The GitHub OAuth app for production needs the callback `https://<your-domain>/auth/github/callback`
and only asks for `read:user user:email`.

Then `task deploy` builds, applies D1 migrations remotely and deploys the Worker.
