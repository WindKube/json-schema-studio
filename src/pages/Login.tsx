import { Redirect, useSearchParams } from "wouter";
import { useMe } from "../api";
import { Logo } from "../ui/ui";

const ERRORS: Record<string, string> = {
  state: "The sign-in took too long or was started in another tab. Try again.",
  github: "GitHub didn't let us in. Try again.",
};

const POINTS = [
  ["JSON or YAML", ", edited visually or as source. Versioned on every publish."],
  [
    "Comments and suggestions",
    " that owners approve or reject, like a pull request for your schema.",
  ],
  ["Any standard from SchemaStore", ", fetched live, plus documents validated as you type."],
];

export function Login() {
  const me = useMe();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  if (me.data) return <Redirect to={next} />;
  const error = ERRORS[params.get("error") ?? ""];

  return (
    <div className="flex min-h-full flex-wrap items-stretch">
      <section className="box-border flex flex-[1_1_480px] flex-col justify-center gap-7 bg-code px-14 py-16 text-[#e6e9ef]">
        <div className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="text-lg font-bold">JSON Schema Studio</span>
        </div>
        <h1 className="m-0 max-w-[520px] text-[40px] leading-[1.1] font-bold tracking-tight">
          Design JSON Schemas together. Validate everything against them.
        </h1>
        <ul className="m-0 flex max-w-[520px] list-none flex-col gap-3.5 p-0">
          {POINTS.map(([strong, rest]) => (
            <li key={strong} className="flex gap-3">
              <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-code-link" />
              <span>
                <strong className="text-white">{strong}</strong>
                {rest}
              </span>
            </li>
          ))}
        </ul>
        <a href="/playground" className="text-code-link">
          Or try the playground without signing in →
        </a>
      </section>

      <section className="box-border flex flex-[1_1_480px] items-center justify-center px-6 py-12">
        <div className="box-border flex w-full max-w-[400px] flex-col gap-5 rounded-2xl border border-line bg-surface p-9">
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="m-0 text-muted">Use your GitHub account. No separate password.</p>
          </div>
          {error && (
            <p role="alert" className="m-0 rounded-lg bg-err-bg px-3 py-2 text-err">
              {error}
            </p>
          )}
          <a
            href={`/auth/github?next=${encodeURIComponent(next)}`}
            className="flex h-[52px] items-center justify-center gap-2.5 rounded-[10px] bg-ink text-[15px] font-semibold text-white no-underline"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
            </svg>
            Continue with GitHub
          </a>
          {import.meta.env.DEV && (
            <form
              action="/auth/dev-login"
              className="flex items-end gap-2 border-t border-line pt-4"
            >
              <input type="hidden" name="next" value={next} />
              <label className="flex flex-1 flex-col gap-1">
                <span className="field-label">Dev sign-in as</span>
                <input name="login" className="input" placeholder="alice" required />
              </label>
              <button type="submit" className="btn">
                Sign in
              </button>
            </form>
          )}
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-page p-3.5 text-[13px] text-ink-2">
            <span className="font-semibold text-ink">What we ask GitHub for</span>
            <span>
              Your username, avatar and primary email (
              <code className="font-mono text-xs">read:user</code>,{" "}
              <code className="font-mono text-xs">user:email</code>). No access to your
              repositories.
            </span>
          </div>
          <p className="m-0 text-[13px] text-muted">
            Have an invite link? Sign in and the shared schema opens automatically.
          </p>
        </div>
      </section>
    </div>
  );
}
