import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link, Redirect, useLocation } from "wouter";
import type { Notification } from "../../shared/api";
import { ago, api, queryClient, useMe } from "../api";
import { Avatar, Logo } from "./ui";

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const [location] = useLocation();
  if (me.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (!me.data) return <Redirect to={`/login?next=${encodeURIComponent(location)}`} />;
  return children;
}

export function AppHeader({ current }: { current?: "schemas" | "catalog" | "playground" }) {
  const me = useMe();
  const tab = (href: string, id: typeof current, label: string) => (
    <Link
      href={href}
      aria-current={current === id ? "page" : undefined}
      className={`rounded-lg px-3 py-2.5 no-underline ${current === id ? "bg-chip font-semibold text-ink" : "font-medium text-ink-2"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-7 py-2.5">
      <div className="flex flex-wrap items-center gap-5">
        <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
          <Logo />
          <span className="text-base font-bold">JSON Schema Studio</span>
        </Link>
        <nav aria-label="Main" className="flex flex-wrap gap-0.5">
          {me.data && tab("/", "schemas", "Schemas")}
          {me.data && tab("/catalog", "catalog", "SchemaStore")}
          {tab("/playground", "playground", "Playground")}
        </nav>
      </div>
      {me.data ? (
        <div className="flex items-center gap-2.5">
          <Bell />
          <AccountMenu login={me.data.login} avatarUrl={me.data.avatarUrl} />
        </div>
      ) : (
        <Link href="/login" className="btn">
          Sign in
        </Link>
      )}
    </header>
  );
}

function Bell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Notification[]>("/api/notifications"),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: () => api("/api/notifications/read", { body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} new` : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && unread) markRead.mutate();
        }}
        className="relative inline-flex size-10 items-center justify-center rounded-lg border border-line bg-surface"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3D4350"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {!!unread && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[#D9473A]"
          />
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <p className="panel-title m-0">Notifications</p>
          <ul className="m-0 max-h-96 list-none overflow-auto p-0">
            {list.data?.map((n) => (
              <li key={n.id} className="border-t border-line-soft">
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-page"
                  onClick={() => {
                    setOpen(false);
                    if (n.payload.href) navigate(n.payload.href);
                  }}
                >
                  <span className={n.readAt ? "text-ink-2" : "font-semibold"}>
                    {n.payload.text}
                  </span>
                  <span className="text-xs text-muted">{ago(n.createdAt)}</span>
                </button>
              </li>
            ))}
            {!list.data?.length && <li className="px-3 pb-3 text-muted">Nothing yet.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function AccountMenu({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const signOut = async () => {
    await api("/auth/logout", { body: {} });
    queryClient.clear();
    location.href = "/login";
  };
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface pr-2.5 pl-1"
      >
        <Avatar login={login} url={avatarUrl} />
        <span className="font-medium">@{login}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-48 rounded-xl border border-line bg-surface p-1 shadow-lg">
          <button
            type="button"
            onClick={signOut}
            className="w-full rounded-lg px-3 py-2 text-left hover:bg-page"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
